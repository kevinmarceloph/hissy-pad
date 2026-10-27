// What the sync engine (phase 3) and the UI store need from local persistence. Web ships
// an IndexedDB adapter, mobile an expo-sqlite one; tests use the in-memory one below.
// Rows written by the user are "dirty" until the engine has pushed them.
import type { NodeRow } from '../types'

export interface LocalStore {
  getAll(): Promise<NodeRow[]>
  // dirty: true for local edits (to be pushed), false for rows that came from the server.
  upsertMany(rows: readonly NodeRow[], opts: { dirty: boolean }): Promise<void>
  dirtyIds(): Promise<string[]>
  markClean(ids: readonly string[]): Promise<void>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}

export function createMemoryStore(initial: readonly NodeRow[] = []): LocalStore & { rows: Map<string, NodeRow> } {
  const rows = new Map(initial.map((r) => [r.id, r]))
  const dirty = new Set<string>()
  const meta = new Map<string, string>()
  return {
    rows,
    async getAll() {
      return [...rows.values()]
    },
    async upsertMany(list, opts) {
      for (const r of list) {
        rows.set(r.id, r)
        if (opts.dirty) dirty.add(r.id)
      }
    },
    async dirtyIds() {
      return [...dirty]
    },
    async markClean(ids) {
      for (const id of ids) dirty.delete(id)
    },
    async getMeta(key) {
      return meta.get(key) ?? null
    },
    async setMeta(key, value) {
      meta.set(key, value)
    },
  }
}

// Rows whose object identity changed between two states: exactly what an op touched.
export function changedRows(prev: Readonly<Record<string, NodeRow>>, next: Readonly<Record<string, NodeRow>>): NodeRow[] {
  const out: NodeRow[] = []
  for (const id in next) if (next[id] !== prev[id]) out.push(next[id]!)
  return out
}
