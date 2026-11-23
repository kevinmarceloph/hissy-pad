import type { Category } from './categories';
import type { DayKey } from './day';
import type { Entry } from './entry';
import type { Flag } from './flags';
import type { RecurringPlan } from './recurring';

// The one seam between the app and where rows live. HoursStore below is the only one: it
// keeps every row in memory and writes through to a backend (IndexedDB on web, SQLite on
// the phone, nothing in tests).
export interface EntryStore {
  listDay(day: DayKey): Promise<Entry[]>;
  // A local edit: the row is dirty until sync has pushed it.
  put(entry: Entry): Promise<void>;
}

export interface CategoryStore {
  // Every category, archived ones included, in no particular order.
  listCategories(): Promise<Category[]>;
  putCategory(category: Category): Promise<void>;
}

export interface FlagStore {
  // Every flag, archived ones included, in no particular order.
  listFlags(): Promise<Flag[]>;
  putFlag(flag: Flag): Promise<void>;
}

export interface RecurringStore {
  // Every recurring plan, archived ones included, in no particular order.
  listRecurring(): Promise<RecurringPlan[]>;
  putRecurring(plan: RecurringPlan): Promise<void>;
}

// What sync needs from one local table. `updatedAt` decides everything: a pushed row is
// only clean if it has not been edited since, and a remote row only lands if it is newer.
export interface SyncTable<Row> {
  dirty(): Promise<Row[]>;
  // Clears the flag on the rows whose updatedAt is still the one that was pushed.
  markClean(pushed: readonly Row[]): Promise<void>;
  // Writes the remote rows that are newer than the local copy (or unknown here) as clean
  // rows, and those with the same updatedAt that differ from a local row with no edit
  // waiting. Returns how many landed.
  applyRemote(rows: readonly Row[]): Promise<number>;
  markAllDirty(): Promise<void>;
}

export interface SyncLocal {
  entries: SyncTable<Entry>;
  categories: SyncTable<Category>;
  flags: SyncTable<Flag>;
  recurring: SyncTable<RecurringPlan>;
  getMeta(key: string): Promise<string | null>;
  // null removes the key.
  setMeta(key: string, value: string | null): Promise<void>;
}

type Tracked<Row> = { row: Row; dirty: boolean };

export type HoursTable = 'entries' | 'categories' | 'flags' | 'recurring';

// One stored row as the backend keeps it: which table, its key there, the row as JSON-able
// data and whether sync still has to push it.
export interface StoredRow {
  table: HoursTable;
  key: string;
  row: unknown;
  dirty: boolean;
}

// Where the rows are kept between runs. Two calls, so a platform's adapter stays a few lines.
export interface HoursBackend {
  load(): Promise<StoredRow[]>;
  save(rows: readonly StoredRow[]): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  // null removes the key.
  setMeta(key: string, value: string | null): Promise<void>;
}

export function createMemoryBackend(): HoursBackend {
  const rows = new Map<string, StoredRow>();
  const meta = new Map<string, string>();
  return {
    load: async () => [...rows.values()],
    save: async (list) => {
      for (const r of list) rows.set(`${r.table}:${r.key}`, r);
    },
    getMeta: async (name) => meta.get(name) ?? null,
    setMeta: async (name, value) => {
      if (value === null) meta.delete(name);
      else meta.set(name, value);
    },
  };
}

function syncTable<Row extends { updatedAt: number }>(
  rows: Map<string, Tracked<Row>>,
  keyOf: (row: Row) => string,
  save: (keys: readonly string[]) => Promise<void>,
): SyncTable<Row> {
  return {
    async dirty() {
      return [...rows.values()].filter((t) => t.dirty).map((t) => t.row);
    },
    async markClean(pushed) {
      const keys: string[] = [];
      for (const row of pushed) {
        const local = rows.get(keyOf(row));
        if (local && local.dirty && local.row.updatedAt === row.updatedAt) {
          local.dirty = false;
          keys.push(keyOf(row));
        }
      }
      await save(keys);
    },
    async applyRemote(remote) {
      const keys: string[] = [];
      for (const row of remote) {
        const local = rows.get(keyOf(row));
        // Newer wins. A clean local row with the same updatedAt that differs gives way too:
        // it claims to be the server's row, and the server's is what the other devices have.
        const same = local && row.updatedAt === local.row.updatedAt;
        if (local && (row.updatedAt < local.row.updatedAt || (same && (local.dirty || JSON.stringify(row) === JSON.stringify(local.row))))) continue;
        rows.set(keyOf(row), { row, dirty: false });
        keys.push(keyOf(row));
      }
      await save(keys);
      return keys.length;
    },
    async markAllDirty() {
      for (const tracked of rows.values()) tracked.dirty = true;
      await save([...rows.keys()]);
    },
  };
}

const slotKey = (day: DayKey, hour: number) => `${day}T${hour}`;

export class HoursStore implements EntryStore, CategoryStore, FlagStore, RecurringStore {
  private rows = new Map<string, Tracked<Entry>>();
  private categories = new Map<string, Tracked<Category>>();
  private flags = new Map<string, Tracked<Flag>>();
  private recurring = new Map<string, Tracked<RecurringPlan>>();
  private backend: HoursBackend;
  private onLocalChange: () => void;

  readonly sync: SyncLocal;

  // `onLocalChange` runs after every local write: sync hangs its "push soon" on it.
  constructor(backend: HoursBackend = createMemoryBackend(), onLocalChange: () => void = () => {}) {
    this.backend = backend;
    this.onLocalChange = onLocalChange;
    this.sync = {
      entries: syncTable(this.rows, (e) => slotKey(e.day, e.hour), (keys) => this.save('entries', this.rows, keys)),
      categories: syncTable(this.categories, (c) => c.id, (keys) => this.save('categories', this.categories, keys)),
      flags: syncTable(this.flags, (f) => f.id, (keys) => this.save('flags', this.flags, keys)),
      recurring: syncTable(this.recurring, (p) => p.id, (keys) => this.save('recurring', this.recurring, keys)),
      getMeta: (name) => backend.getMeta(name),
      setMeta: (name, value) => backend.setMeta(name, value),
    };
  }

  // Reads everything the backend holds. Call once, before the first read.
  async open(): Promise<void> {
    const maps: Record<HoursTable, Map<string, Tracked<never>>> = {
      entries: this.rows as Map<string, Tracked<never>>,
      categories: this.categories as Map<string, Tracked<never>>,
      flags: this.flags as Map<string, Tracked<never>>,
      recurring: this.recurring as Map<string, Tracked<never>>,
    };
    for (const stored of await this.backend.load()) {
      // A category saved before categories had an icon has none.
      const row = stored.table === 'categories' ? { icon: '', ...(stored.row as object) } : stored.row;
      maps[stored.table]?.set(stored.key, { row: row as never, dirty: stored.dirty });
    }
  }

  private async save<Row>(table: HoursTable, map: Map<string, Tracked<Row>>, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const list: StoredRow[] = [];
    for (const key of keys) {
      const tracked = map.get(key);
      if (tracked) list.push({ table, key, row: tracked.row, dirty: tracked.dirty });
    }
    await this.backend.save(list);
  }

  private async write<Row>(table: HoursTable, map: Map<string, Tracked<Row>>, key: string, row: Row): Promise<void> {
    map.set(key, { row, dirty: true });
    await this.save(table, map, [key]);
    this.onLocalChange();
  }

  async listDay(day: DayKey): Promise<Entry[]> {
    return [...this.rows.values()]
      .map((t) => t.row)
      .filter((e) => e.day === day)
      .sort((a, b) => a.hour - b.hour);
  }

  put(entry: Entry): Promise<void> {
    return this.write('entries', this.rows, slotKey(entry.day, entry.hour), entry);
  }

  async listCategories(): Promise<Category[]> {
    return [...this.categories.values()].map((t) => t.row);
  }

  putCategory(category: Category): Promise<void> {
    return this.write('categories', this.categories, category.id, category);
  }

  async listFlags(): Promise<Flag[]> {
    return [...this.flags.values()].map((t) => t.row);
  }

  putFlag(flag: Flag): Promise<void> {
    return this.write('flags', this.flags, flag.id, flag);
  }

  async listRecurring(): Promise<RecurringPlan[]> {
    return [...this.recurring.values()].map((t) => t.row);
  }

  putRecurring(plan: RecurringPlan): Promise<void> {
    return this.write('recurring', this.recurring, plan.id, plan);
  }
}

// For tests: a store that starts with these rows, all of them waiting to be pushed.
export class MemoryStore extends HoursStore {
  constructor(seed: Entry[] = [], categories: Category[] = [], flags: Flag[] = []) {
    super();
    for (const entry of seed) void this.put(entry);
    for (const category of categories) void this.putCategory(category);
    for (const flag of flags) void this.putFlag(flag);
  }
}
