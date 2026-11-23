// Offline-first sync, per row, last write wins. HissyPad's engine, over four tables.
//
//   push: every dirty local row is upserted; the server keeps the newer updatedAt
//   pull: everything whose server-side synced_at is past our cursor, merged by updatedAt
//   nudge: a realtime event, a reconnect, a tab focus, a local edit all call requestSync
//
// Categories, flags and recurring plans go before entries both ways, so an hour never arrives
// ahead of the category or the flags it points at. The engine owns no UI state: it reads and writes the local tables and
// says when something from the server landed. Pure TypeScript, no Supabase in here.
import type { Category } from '@hissypad/core/hours';
import type { Entry } from '@hissypad/core/hours';
import type { Flag } from '@hissypad/core/hours';
import type { RecurringPlan } from '@hissypad/core/hours';
import type { SyncLocal, SyncTable } from '@hissypad/core/hours';

export type Pulled<Row> = { row: Row; syncedAt: string }; // syncedAt: server time, ISO

export interface RemoteTable<Row> {
  push(rows: readonly Row[]): Promise<void>;
  // Rows with synced_at > since, oldest first, at most `limit`.
  pull(since: string | null, limit: number): Promise<Pulled<Row>[]>;
}

export interface Remote {
  entries: RemoteTable<Entry>;
  categories: RemoteTable<Category>;
  flags: RemoteTable<Flag>;
  recurring: RemoteTable<RecurringPlan>;
  // Realtime: calls `nudge` whenever the server says something changed. Returns unsubscribe.
  subscribe(nudge: () => void): () => void;
}

export type SyncStatus = {
  state: 'idle' | 'syncing' | 'error';
  pending: number; // dirty rows not yet on the server
  lastSyncAt: number | null; // ms since epoch, device clock
  error: string | null;
};

export type SyncEngineOptions = {
  local: SyncLocal;
  remote: Remote;
  // Rows from the server replaced or added local ones: reload what is on screen.
  onPulled?: () => void;
  onStatus?: (status: SyncStatus) => void;
  now?: () => number;
  pageSize?: number;
  debounceMs?: number;
  intervalMs?: number;
  // The cursor is moved back this much on every pull so a row committed slightly out of
  // order (synced_at stamped before a longer transaction ahead of it finished) is still
  // seen. Duplicates are harmless because the merge compares updatedAt.
  cursorSlackMs?: number;
};

export interface SyncEngine {
  sync(): Promise<void>;
  requestSync(): void;
  start(): void;
  stop(): void;
  status(): SyncStatus;
}

export const cursorKey = (table: string) => `sync.cursor.${table}`;

// Raised when devices may hold rows that differ from the server's without knowing it. A
// device that has not pulled under this number forgets its cursors once and reads every
// row again; the merge takes what is newer or what a clean local row got wrong.
// 2: 2026-11-21, a phone showed four planned hours as blank while the server had the plans.
// 3: 2026-11-24, categories got an icon: a device on the older code pulled them without it.
export const PULL_EPOCH = '3';
const EPOCH_KEY = 'sync.epoch';
const TABLES = ['categories', 'flags', 'recurring', 'entries'];

type Table<Row> = { name: string; local: SyncTable<Row>; remote: RemoteTable<Row> };

export function createSyncEngine(o: SyncEngineOptions): SyncEngine {
  const pageSize = o.pageSize ?? 500;
  const debounceMs = o.debounceMs ?? 800;
  const intervalMs = o.intervalMs ?? 60_000;
  const slack = o.cursorSlackMs ?? 10_000;
  const now = o.now ?? Date.now;

  let status: SyncStatus = { state: 'idle', pending: 0, lastSyncAt: null, error: null };
  let running: Promise<void> | null = null;
  let again = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopped = true;

  const emit = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    o.onStatus?.(status);
  };

  const pending = async () =>
    (await o.local.categories.dirty()).length +
    (await o.local.flags.dirty()).length +
    (await o.local.recurring.dirty()).length +
    (await o.local.entries.dirty()).length;

  async function push<Row>(table: Table<Row>): Promise<void> {
    const rows = await table.local.dirty();
    for (let i = 0; i < rows.length; i += pageSize) {
      const page = rows.slice(i, i + pageSize);
      await table.remote.push(page);
      // Only rows untouched during the push become clean; an edit mid-flight stays dirty.
      await table.local.markClean(page);
    }
  }

  async function pull<Row>(table: Table<Row>): Promise<number> {
    const key = cursorKey(table.name);
    const stored = await o.local.getMeta(key);
    let since = stored === null ? null : new Date(Date.parse(stored) - slack).toISOString();
    let newest = stored;
    let landed = 0;
    for (;;) {
      const page = await table.remote.pull(since, pageSize);
      if (page.length === 0) break;
      landed += await table.local.applyRemote(page.map((p) => p.row));
      for (const { syncedAt } of page) if (newest === null || syncedAt > newest) newest = syncedAt;
      if (newest !== null) await o.local.setMeta(key, newest);
      if (page.length < pageSize) break;
      since = page[page.length - 1]!.syncedAt;
    }
    return landed;
  }

  async function runOnce(): Promise<void> {
    const categories: Table<Category> = { name: 'categories', local: o.local.categories, remote: o.remote.categories };
    const flags: Table<Flag> = { name: 'flags', local: o.local.flags, remote: o.remote.flags };
    const recurring: Table<RecurringPlan> = { name: 'recurring', local: o.local.recurring, remote: o.remote.recurring };
    const entries: Table<Entry> = { name: 'entries', local: o.local.entries, remote: o.remote.entries };
    emit({ state: 'syncing', pending: await pending() });
    try {
      // A push that fails (one row the server will not take is enough) must not keep this
      // device from hearing about the others: every table is still tried and the pull still
      // runs. The first failure is reported once what could be done is done.
      const failures: unknown[] = [];
      const attempt = (work: Promise<void>) => work.catch((cause: unknown) => void failures.push(cause));
      await attempt(push(categories));
      await attempt(push(flags));
      await attempt(push(recurring));
      await attempt(push(entries));
      const repull = (await o.local.getMeta(EPOCH_KEY)) !== PULL_EPOCH;
      if (repull) for (const name of TABLES) await o.local.setMeta(cursorKey(name), null);
      const landed = (await pull(categories)) + (await pull(flags)) + (await pull(recurring)) + (await pull(entries));
      // Only once every table has been read through: a pull that failed half way starts over.
      if (repull) await o.local.setMeta(EPOCH_KEY, PULL_EPOCH);
      if (landed > 0) o.onPulled?.();
      if (failures.length > 0) throw failures[0];
      emit({ state: 'idle', pending: await pending(), lastSyncAt: now(), error: null });
    } catch (cause) {
      emit({
        state: 'error',
        error: reason(cause),
        pending: await pending().catch(() => status.pending),
      });
    }
  }

  // One sync at a time; a request during a run schedules exactly one more.
  function sync(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await runOnce();
      } while (again && !stopped);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function requestSync() {
    if (stopped) return;
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void sync();
    }, debounceMs);
  }

  // A periodic sync as a safety net for a missed realtime event or a long sleep.
  function schedulePeriodic() {
    if (stopped) return;
    interval = setTimeout(() => {
      interval = null;
      void sync().finally(schedulePeriodic);
    }, intervalMs);
  }

  return {
    sync,
    requestSync,
    start() {
      stopped = false;
      unsubscribe?.();
      unsubscribe = o.remote.subscribe(requestSync);
      if (interval !== null) clearTimeout(interval);
      schedulePeriodic();
      void sync();
    },
    stop() {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
      if (debounce !== null) clearTimeout(debounce);
      if (interval !== null) clearTimeout(interval);
      debounce = interval = null;
    },
    status: () => status,
  };
}

// Every runtime words "the request never got there" differently (Failed to fetch, Network
// request failed, fetch failed, Load failed). The screen says one thing for all of them.
function reason(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /failed to fetch|network request failed|fetch failed|load failed/i.test(message)
    ? 'cannot reach the server'
    : message;
}

// The one-line sync status the app prints. `online` is the platform's own reading of the
// network; without one, pass true.
export function syncLine(sync: SyncStatus | null, online = true): string {
  const waiting = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'} waiting.`;
  if (!online) {
    return sync && sync.pending > 0 ? `Offline. ${waiting(sync.pending)}` : 'Offline. Changes will sync when you are back.';
  }
  if (!sync || sync.state === 'syncing') return 'Syncing.';
  if (sync.state === 'error') return `Sync failed: ${sync.error ?? 'unknown error'}.`;
  if (sync.pending > 0) return waiting(sync.pending);
  if (sync.lastSyncAt === null) return 'Synced.';
  return `Synced at ${new Date(sync.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
}
