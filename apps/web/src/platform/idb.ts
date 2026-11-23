// LocalStore on IndexedDB. One object store for rows, one for the dirty set, one for meta
// (sync cursor and friends). Opened lazily so a browser without IndexedDB (private mode
// in some engines) fails at first use, where the UI can fall back to memory and say so.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LocalStore, NodeRow } from '@hissypad/core'
import type { HoursBackend, StoredRow } from '@hissypad/core/hours'

interface PadDB extends DBSchema {
  nodes: { key: string; value: NodeRow }
  dirty: { key: string; value: { id: string } }
  meta: { key: string; value: { key: string; value: string } }
  // The Hours mode's rows (entries, categories, flags, recurring plans), one store for all
  // four: `id` is 'table:key', and `dirty` rides on the row.
  hours: { key: string; value: StoredRow & { id: string } }
}

export function createIdbStore(name = 'hissypad'): LocalStore & { hours: HoursBackend } {
  let dbp: Promise<IDBPDatabase<PadDB>> | null = null
  const db = () =>
    (dbp ??= openDB<PadDB>(name, 2, {
      upgrade(d, from) {
        if (from < 1) {
          d.createObjectStore('nodes', { keyPath: 'id' })
          d.createObjectStore('dirty', { keyPath: 'id' })
          d.createObjectStore('meta', { keyPath: 'key' })
        }
        if (from < 2) d.createObjectStore('hours', { keyPath: 'id' })
      },
    }))

  // Hours keeps its settings and cursors in the same meta store, under their own prefix.
  const hours: HoursBackend = {
    async load() {
      return (await db()).getAll('hours')
    },
    async save(rows) {
      const tx = (await db()).transaction('hours', 'readwrite')
      for (const r of rows) void tx.store.put({ ...r, id: `${r.table}:${r.key}` })
      await tx.done
    },
    async getMeta(key) {
      return (await (await db()).get('meta', `hours.${key}`))?.value ?? null
    },
    async setMeta(key, value) {
      if (value === null) await (await db()).delete('meta', `hours.${key}`)
      else await (await db()).put('meta', { key: `hours.${key}`, value })
    },
  }

  return {
    hours,
    async getAll() {
      return (await db()).getAll('nodes')
    },
    async upsertMany(rows, opts) {
      const tx = (await db()).transaction(['nodes', 'dirty'], 'readwrite')
      for (const r of rows) {
        void tx.objectStore('nodes').put(r)
        if (opts.dirty) void tx.objectStore('dirty').put({ id: r.id })
      }
      await tx.done
    },
    async dirtyIds() {
      return (await db()).getAllKeys('dirty')
    },
    async markClean(ids) {
      const tx = (await db()).transaction('dirty', 'readwrite')
      for (const id of ids) void tx.store.delete(id)
      await tx.done
    },
    async getMeta(key) {
      return (await (await db()).get('meta', key))?.value ?? null
    },
    async setMeta(key, value) {
      await (await db()).put('meta', { key, value })
    },
  }
}
