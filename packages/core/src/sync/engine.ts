// Offline-first sync, per row, last write wins (PLAN.md, "Sync").
//
//   push: every dirty local row is upserted; the server keeps the newer updated_at
//   pull: everything whose server-side synced_at is past our cursor, merged by updated_at
//   nudge: a realtime event, a reconnect, a tab focus, a local edit: all just call requestSync
//
// The engine owns no UI state. It reads and writes the LocalStore, asks the app for the
// rows it holds in memory, and hands back the remote rows that won.
import type { NodeRow, Rows } from '../types'
import type { Clock } from '../clock'
import type { LocalStore } from './store'

export interface PulledRow {
  row: NodeRow
  syncedAt: string // server timestamp; the pull cursor
}

export interface Remote {
  push(rows: readonly NodeRow[]): Promise<void>
  // Rows with synced_at > since, oldest first, at most `limit`.
  pull(since: string | null, limit: number): Promise<PulledRow[]>
  // Realtime: call `nudge` whenever the server says something changed. Returns unsubscribe.
  subscribe(nudge: () => void): () => void
}

export type SyncState = 'idle' | 'syncing' | 'error'

export interface SyncStatus {
  state: SyncState
  pending: number // dirty rows not yet on the server
  lastSyncAt: string | null
  error: string | null
}

export interface SyncEngineOptions {
  local: LocalStore
  remote: Remote
  clock: Clock
  getRows: () => Rows
  // Remote rows that beat the local copy (or were unknown locally). Already persisted.
  applyRemote: (rows: readonly NodeRow[]) => void
  onStatus?: (status: SyncStatus) => void
  pageSize?: number
  debounceMs?: number
  intervalMs?: number
  // The cursor is moved back this much on every pull so a row committed slightly out of
  // order (synced_at stamped before a longer transaction ahead of it finished) is still
  // seen; duplicates are harmless because the merge compares updated_at.
  cursorSlackMs?: number
  // Timer seams (tests pass fakes). Defaults come from the host runtime.
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

// Core has no DOM or Node lib; every host has these two.
const host = globalThis as unknown as {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface SyncEngine {
  sync(): Promise<void>
  requestSync(): void
  start(): void
  stop(): void
  status(): SyncStatus
}

export const CURSOR_KEY = 'sync.cursor'

export function createSyncEngine(o: SyncEngineOptions): SyncEngine {
  const pageSize = o.pageSize ?? 500
  const debounceMs = o.debounceMs ?? 800
  const intervalMs = o.intervalMs ?? 60_000
  const slack = o.cursorSlackMs ?? 10_000
  const setT = o.setTimeout ?? ((fn, ms) => host.setTimeout(fn, ms))
  const clearT = o.clearTimeout ?? ((h) => host.clearTimeout(h))

  let status: SyncStatus = { state: 'idle', pending: 0, lastSyncAt: null, error: null }
  let running: Promise<void> | null = null
  let again = false
  let debounce: unknown = null
  let interval: unknown = null
  let stopped = true

  // A periodic sync as a safety net for a missed realtime event or a long sleep.
  function schedulePeriodic() {
    if (stopped) return
    interval = setT(() => {
      interval = null
      void sync().finally(schedulePeriodic)
    }, intervalMs)
  }
  let unsubscribe: (() => void) | null = null

  function emit(patch: Partial<SyncStatus>) {
    status = { ...status, ...patch }
    o.onStatus?.(status)
  }

  async function pushDirty(): Promise<void> {
    const dirtyIds = await o.local.dirtyIds()
    emit({ pending: dirtyIds.length })
    if (dirtyIds.length === 0) return
    const all = new Map((await o.local.getAll()).map((r) => [r.id, r]))
    const rows = dirtyIds.map((id) => all.get(id)).filter((r): r is NodeRow => r !== undefined)
    const stamped = new Map(rows.map((r) => [r.id, r.updatedAt]))
    for (let i = 0; i < rows.length; i += pageSize) {
      await o.remote.push(rows.slice(i, i + pageSize))
    }
    // Only rows untouched during the push become clean; a keystroke mid-flight stays dirty.
    const after = new Map((await o.local.getAll()).map((r) => [r.id, r]))
    const clean = rows.filter((r) => after.get(r.id)?.updatedAt === stamped.get(r.id)).map((r) => r.id)
    await o.local.markClean(clean)
    emit({ pending: (await o.local.dirtyIds()).length })
  }

  async function pullNew(): Promise<void> {
    const stored = await o.local.getMeta(CURSOR_KEY)
    let since = stored === null ? null : new Date(Date.parse(stored) - slack).toISOString()
    let newest = stored
    for (;;) {
      const page = await o.remote.pull(since, pageSize)
      if (page.length === 0) break
      const mine = o.getRows()
      const dirty = new Set(await o.local.dirtyIds())
      const accepted: NodeRow[] = []
      for (const { row, syncedAt } of page) {
        o.clock.observe(row.updatedAt)
        const local = mine[row.id]
        // Remote wins when it is strictly newer. Equal timestamps are our own echo. A
        // local row that is newer is dirty and will be pushed on the next pass.
        if (!local || row.updatedAt > local.updatedAt) {
          if (local && dirty.has(row.id) && row.updatedAt <= local.updatedAt) continue
          accepted.push(row)
        }
        if (newest === null || syncedAt > newest) newest = syncedAt
      }
      if (accepted.length) {
        await o.local.upsertMany(accepted, { dirty: false })
        o.applyRemote(accepted)
      }
      if (newest !== null) await o.local.setMeta(CURSOR_KEY, newest)
      if (page.length < pageSize) break
      since = page.at(-1)!.syncedAt
    }
  }

  async function runOnce(): Promise<void> {
    emit({ state: 'syncing' })
    try {
      await pushDirty()
      await pullNew()
      emit({ state: 'idle', lastSyncAt: new Date().toISOString(), error: null })
    } catch (e) {
      emit({ state: 'error', error: (e as Error).message, pending: (await o.local.dirtyIds().catch(() => [])).length })
    }
  }

  // One sync at a time; a request during a run schedules exactly one more.
  function sync(): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await runOnce()
      } while (again)
    })().finally(() => {
      running = null
    })
    return running
  }

  function requestSync() {
    if (debounce !== null) clearT(debounce)
    debounce = setT(() => {
      debounce = null
      void sync()
    }, debounceMs)
  }

  return {
    sync,
    requestSync,
    start() {
      stopped = false
      unsubscribe?.()
      unsubscribe = o.remote.subscribe(() => requestSync())
      if (interval !== null) clearT(interval)
      schedulePeriodic()
      void sync()
    },
    stop() {
      stopped = true
      unsubscribe?.()
      unsubscribe = null
      if (debounce !== null) clearT(debounce)
      if (interval !== null) clearT(interval)
      debounce = interval = null
    },
    status: () => status,
  }
}
