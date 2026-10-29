// LocalStore on expo-sqlite. Same three tables as the web's IndexedDB adapter: rows,
// the dirty set, and meta (the sync cursor). Booleans are stored as 0/1.
import * as SQLite from 'expo-sqlite'
import type { LocalStore, NodeRow } from '@hissypad/core'

interface Row {
  id: string
  parent_id: string | null
  rank: string
  text: string
  done: number
  collapsed: number
  numbered: number
  header: number
  updated_at: string
  deleted_at: string | null
}

const toRow = (r: Row): NodeRow => ({
  id: r.id,
  parentId: r.parent_id,
  rank: r.rank,
  text: r.text,
  done: r.done === 1,
  collapsed: r.collapsed === 1,
  numbered: r.numbered === 1,
  header: r.header === 1,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
})

export function createSqliteStore(name = 'hissypad.db'): LocalStore {
  let dbp: Promise<SQLite.SQLiteDatabase> | null = null
  const db = () =>
    (dbp ??= (async () => {
      const d = await SQLite.openDatabaseAsync(name)
      await d.execAsync(`
        pragma journal_mode = wal;
        create table if not exists nodes (
          id text primary key, parent_id text, rank text not null, text text not null,
          done integer not null default 0, collapsed integer not null default 0, numbered integer not null default 0,
          header integer not null default 0,
          updated_at text not null, deleted_at text
        );
        create table if not exists dirty (id text primary key);
        create table if not exists meta (key text primary key, value text not null);
      `)
      // Columns added after the first build, for databases created before them.
      const cols = await d.getAllAsync<{ name: string }>('pragma table_info(nodes)')
      if (!cols.some((c) => c.name === 'header')) await d.execAsync('alter table nodes add column header integer not null default 0')
      return d
    })())

  return {
    async getAll() {
      const list = await (await db()).getAllAsync<Row>('select * from nodes')
      return list.map(toRow)
    },
    async upsertMany(rows, opts) {
      const d = await db()
      await d.withTransactionAsync(async () => {
        for (const r of rows) {
          await d.runAsync(
            `insert into nodes (id, parent_id, rank, text, done, collapsed, numbered, header, updated_at, deleted_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             on conflict (id) do update set parent_id = excluded.parent_id, rank = excluded.rank, text = excluded.text,
               done = excluded.done, collapsed = excluded.collapsed, numbered = excluded.numbered, header = excluded.header,
               updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
            r.id, r.parentId, r.rank, r.text, r.done ? 1 : 0, r.collapsed ? 1 : 0, r.numbered ? 1 : 0, r.header ? 1 : 0, r.updatedAt, r.deletedAt,
          )
          if (opts.dirty) await d.runAsync('insert or ignore into dirty (id) values (?)', r.id)
        }
      })
    },
    async dirtyIds() {
      const list = await (await db()).getAllAsync<{ id: string }>('select id from dirty')
      return list.map((r) => r.id)
    },
    async markClean(ids) {
      const d = await db()
      await d.withTransactionAsync(async () => {
        for (const id of ids) await d.runAsync('delete from dirty where id = ?', id)
      })
    },
    async getMeta(key) {
      const r = await (await db()).getFirstAsync<{ value: string }>('select value from meta where key = ?', key)
      return r?.value ?? null
    },
    async setMeta(key, value) {
      await (await db()).runAsync('insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', key, value)
    },
  }
}
