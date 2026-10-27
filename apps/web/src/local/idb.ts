// LocalStore on IndexedDB. One object store for rows, one for the dirty set, one for meta
// (sync cursor and friends). Opened lazily so a browser without IndexedDB (private mode
// in some engines) fails at first use, where the UI can fall back to memory and say so.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LocalStore, NodeRow } from '@hissypad/core'

interface PadDB extends DBSchema {
  nodes: { key: string; value: NodeRow }
  dirty: { key: string; value: { id: string } }
  meta: { key: string; value: { key: string; value: string } }
}

export function createIdbStore(name = 'hissypad'): LocalStore {
  let dbp: Promise<IDBPDatabase<PadDB>> | null = null
  const db = () =>
    (dbp ??= openDB<PadDB>(name, 1, {
      upgrade(d) {
        d.createObjectStore('nodes', { keyPath: 'id' })
        d.createObjectStore('dirty', { keyPath: 'id' })
        d.createObjectStore('meta', { keyPath: 'key' })
      },
    }))

  return {
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
