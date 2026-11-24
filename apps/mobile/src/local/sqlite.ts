// LocalStore on expo-sqlite. Same three tables as the web's IndexedDB adapter: rows,
// the dirty set, and meta (the sync cursor). Booleans are stored as 0/1.
import * as SQLite from 'expo-sqlite'
import type { LocalStore, NodeRow } from '@hissypad/core'
import type { HoursBackend, HoursTable } from '@hissypad/core/hours'

interface Row {
  id: string
  parent_id: string | null
  rank: string
  text: string
  done: number
  done_at: string | null
  collapsed: number
  numbered: number
  header: number
  pad: number
  slot: string | null
  category: string | null
  doing: number | null
  pinned: number | null
  updated_at: string
  deleted_at: string | null
}

const toRow = (r: Row): NodeRow => ({
  id: r.id,
  parentId: r.parent_id,
  rank: r.rank,
  text: r.text,
  done: r.done === 1,
  doneAt: r.done === 1 ? r.done_at ?? null : null,
  doing: r.doing === 1 && r.done !== 1,
  pinned: r.pinned === 1,
  collapsed: r.collapsed === 1,
  numbered: r.numbered === 1,
  header: r.header === 1,
  pad: r.pad === 1,
  slot: r.slot ?? null,
  category: r.category ?? null,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
})

export function createSqliteStore(name = 'hissypad.db'): LocalStore & { hours: HoursBackend } {
  let dbp: Promise<SQLite.SQLiteDatabase> | null = null
  const db = () =>
    (dbp ??= (async () => {
      const d = await SQLite.openDatabaseAsync(name)
      await d.execAsync(`
        pragma journal_mode = wal;
        create table if not exists nodes (
          id text primary key, parent_id text, rank text not null, text text not null,
          done integer not null default 0, collapsed integer not null default 0, numbered integer not null default 0,
          header integer not null default 0, done_at text, pad integer not null default 0,
          updated_at text not null, deleted_at text, slot text, category text, doing integer not null default 0, pinned integer not null default 0
        );
        create table if not exists hours_rows (tbl text not null, key text not null, json text not null, dirty integer not null default 0, primary key (tbl, key));
        create table if not exists dirty (id text primary key);
        create table if not exists meta (key text primary key, value text not null);
      `)
      // Columns added after the first build, for databases created before them.
      const cols = await d.getAllAsync<{ name: string }>('pragma table_info(nodes)')
      if (!cols.some((c) => c.name === 'header')) await d.execAsync('alter table nodes add column header integer not null default 0')
      if (!cols.some((c) => c.name === 'done_at')) await d.execAsync('alter table nodes add column done_at text')
      if (!cols.some((c) => c.name === 'pad')) await d.execAsync('alter table nodes add column pad integer not null default 0')
      if (!cols.some((c) => c.name === 'slot')) await d.execAsync('alter table nodes add column slot text')
      if (!cols.some((c) => c.name === 'category')) await d.execAsync('alter table nodes add column category text')
      if (!cols.some((c) => c.name === 'doing')) await d.execAsync('alter table nodes add column doing integer not null default 0')
      if (!cols.some((c) => c.name === 'pinned')) await d.execAsync('alter table nodes add column pinned integer not null default 0')
      return d
    })())

  // The Hours mode's rows (entries, categories, flags, recurring plans) as JSON in one table;
  // its settings and cursors share `meta` under their own prefix.
  // One transaction at a time: they share a connection, and two that overlap (keys typed
  // faster than a write lands) fail or roll each other back, which lost the later text of a
  // line (2026-11-25).
  let chain: Promise<unknown> = Promise.resolve()
  const oneAtATime = <T,>(job: () => Promise<T>): Promise<T> => {
    const run = chain.then(job)
    chain = run.catch(() => {})
    return run
  }

  const hours: HoursBackend = {
    async load() {
      const list = await (await db()).getAllAsync<{ tbl: string; key: string; json: string; dirty: number }>('select * from hours_rows')
      return list.map((r) => ({ table: r.tbl as HoursTable, key: r.key, row: JSON.parse(r.json) as unknown, dirty: r.dirty === 1 }))
    },
    async save(rows) {
      const d = await db()
      await oneAtATime(() => d.withTransactionAsync(async () => {
        for (const r of rows) {
          await d.runAsync(
            'insert into hours_rows (tbl, key, json, dirty) values (?, ?, ?, ?) on conflict (tbl, key) do update set json = excluded.json, dirty = excluded.dirty',
            r.table, r.key, JSON.stringify(r.row), r.dirty ? 1 : 0,
          )
        }
      }))
    },
    async getMeta(key) {
      const r = await (await db()).getFirstAsync<{ value: string }>('select value from meta where key = ?', `hours.${key}`)
      return r?.value ?? null
    },
    async setMeta(key, value) {
      const d = await db()
      if (value === null) await d.runAsync('delete from meta where key = ?', `hours.${key}`)
      else await d.runAsync('insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', `hours.${key}`, value)
    },
  }

  return {
    hours,
    async getAll() {
      const list = await (await db()).getAllAsync<Row>('select * from nodes')
      return list.map(toRow)
    },
    async upsertMany(rows, opts) {
      const d = await db()
      await oneAtATime(() => d.withTransactionAsync(async () => {
        for (const r of rows) {
          await d.runAsync(
            `insert into nodes (id, parent_id, rank, text, done, done_at, collapsed, numbered, header, pad, updated_at, deleted_at, slot, category, doing, pinned)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             on conflict (id) do update set parent_id = excluded.parent_id, rank = excluded.rank, text = excluded.text,
               done = excluded.done, done_at = excluded.done_at, collapsed = excluded.collapsed, numbered = excluded.numbered, header = excluded.header,
               pad = excluded.pad, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, slot = excluded.slot, category = excluded.category, doing = excluded.doing, pinned = excluded.pinned`,
            r.id, r.parentId, r.rank, r.text, r.done ? 1 : 0, r.doneAt ?? null, r.collapsed ? 1 : 0, r.numbered ? 1 : 0, r.header ? 1 : 0, r.pad ? 1 : 0, r.updatedAt, r.deletedAt, r.slot ?? null, r.category ?? null, r.doing ? 1 : 0, r.pinned ? 1 : 0,
          )
          if (opts.dirty) await d.runAsync('insert or ignore into dirty (id) values (?)', r.id)
        }
      }))
    },
    async dirtyIds() {
      const list = await (await db()).getAllAsync<{ id: string }>('select id from dirty')
      return list.map((r) => r.id)
    },
    async markClean(ids) {
      const d = await db()
      await oneAtATime(() => d.withTransactionAsync(async () => {
        for (const id of ids) await d.runAsync('delete from dirty where id = ?', id)
      }))
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
