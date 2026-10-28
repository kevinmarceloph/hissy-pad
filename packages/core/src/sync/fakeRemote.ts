// An in-memory stand-in for the Supabase table with the same rules as the migration:
// last write wins on updated_at, synced_at stamped by the server, realtime nudges.
// Used by the engine tests and available to app tests.
import type { NodeRow } from '../types'
import type { PulledRow, Remote } from './engine'

export interface FakeRemote extends Remote {
  rows: Map<string, { row: NodeRow; syncedAt: string }>
  failNextPush: (err: Error) => void
  holdNextPush: () => () => void // returns release()
  pushes: number
}

export function createFakeRemote(): FakeRemote {
  const rows = new Map<string, { row: NodeRow; syncedAt: string }>()
  const listeners = new Set<() => void>()
  let seq = 0
  let fail: Error | null = null
  let hold: Promise<void> | null = null
  const stamp = () => new Date(1_800_000_000_000 + ++seq * 1000).toISOString()

  const remote: FakeRemote = {
    rows,
    pushes: 0,
    failNextPush: (e) => {
      fail = e
    },
    holdNextPush: () => {
      let release!: () => void
      hold = new Promise<void>((res) => (release = res))
      return release
    },
    async push(list) {
      remote.pushes++
      if (fail) {
        const e = fail
        fail = null
        throw e
      }
      if (hold) {
        const h = hold
        hold = null
        await h
      }
      let changed = false
      for (const row of list) {
        const cur = rows.get(row.id)
        if (cur && row.updatedAt <= cur.row.updatedAt) continue
        rows.set(row.id, { row: { ...row }, syncedAt: stamp() })
        changed = true
      }
      if (changed) for (const l of listeners) l()
    },
    async pull(since, limit) {
      const out: PulledRow[] = [...rows.values()]
        .filter((e) => since === null || e.syncedAt > since)
        .sort((a, b) => (a.syncedAt < b.syncedAt ? -1 : 1))
        .slice(0, limit)
        .map((e) => ({ row: { ...e.row }, syncedAt: e.syncedAt }))
      return out
    },
    subscribe(nudge) {
      listeners.add(nudge)
      return () => listeners.delete(nudge)
    },
  }
  return remote
}
