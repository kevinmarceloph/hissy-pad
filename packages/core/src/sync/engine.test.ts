import { describe, expect, it } from 'vitest'
import { createClock } from '../clock'
import { buildIndex, flatten } from '../tree'
import { insertAt, insertAfter, remove, setText } from '../ops'
import type { NodeRow, OpCtx, Rows } from '../types'
import { changedRows, createMemoryStore } from './store'
import { createSyncEngine, type SyncStatus } from './engine'
import { createFakeRemote } from './fakeRemote'

// A simulated device: its own clock, local store, in-memory rows and engine, sharing one
// fake remote with the others. `edit` runs a core op and persists like the web store does.
function device(name: string, remote: ReturnType<typeof createFakeRemote>, wall: { ms: number }) {
  const clock = createClock(() => wall.ms)
  let n = 0
  const ctx: OpCtx = { now: () => clock.tick(), newId: () => `${name}-${++n}` }
  const local = createMemoryStore()
  let rows: Rows = {}
  const statuses: SyncStatus[] = []
  const engine = createSyncEngine({
    local,
    remote,
    clock,
    getRows: () => rows,
    applyRemote: (incoming) => {
      const next: Record<string, NodeRow> = { ...rows }
      for (const r of incoming) next[r.id] = r
      rows = next
    },
    onStatus: (s) => statuses.push(s),
    pageSize: 3,
    cursorSlackMs: 0,
  })
  async function edit(fn: (rows: Rows, ctx: OpCtx) => Rows) {
    const next = fn(rows, ctx)
    await local.upsertMany(changedRows(rows, next), { dirty: true })
    rows = next
  }
  const texts = () => flatten(buildIndex(rows), false).map((r) => '  '.repeat(r.depth) + rows[r.id]!.text).join('\n')
  return { name, ctx, local, engine, edit, texts, get rows() { return rows }, statuses }
}

describe('sync engine', () => {
  it('moves rows from one device to another', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    const b = device('b', remote, wall)
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'hello').rows)
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'top').rows)
    await a.engine.sync()
    expect(await a.local.dirtyIds()).toEqual([])
    await b.engine.sync()
    expect(b.texts()).toBe('top\nhello')
    expect(a.engine.status()).toMatchObject({ state: 'idle', pending: 0 })
  })

  it('merges edits to different rows from two offline devices', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    const b = device('b', remote, wall)
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'one').rows)
    await a.edit((r, c) => insertAfter(r, c, 'a-1', 'two').rows)
    await a.engine.sync()
    await b.engine.sync()
    wall.ms += 1000
    await a.edit((r, c) => setText(r, c, 'a-1', 'one (A)'))
    await b.edit((r, c) => setText(r, c, 'a-2', 'two (B)'))
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    expect(a.texts()).toBe('one (A)\ntwo (B)')
    expect(b.texts()).toBe('one (A)\ntwo (B)')
  })

  it('same row edited on both: the later updated_at wins everywhere', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    const b = device('b', remote, wall)
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'x').rows)
    await a.engine.sync()
    await b.engine.sync()
    wall.ms += 1000
    await a.edit((r, c) => setText(r, c, 'a-1', 'from A'))
    wall.ms += 1000
    await b.edit((r, c) => setText(r, c, 'a-1', 'from B, later'))
    // A pushes first, B second; B's is newer so the server keeps B's. Then A pulls it.
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    expect(a.texts()).toBe('from B, later')
    expect(b.texts()).toBe('from B, later')
    expect(remote.rows.get('a-1')!.row.text).toBe('from B, later')
  })

  it('a local edit that is newer than the pulled row is kept and pushed next', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    const b = device('b', remote, wall)
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'x').rows)
    await a.engine.sync()
    await b.engine.sync()
    wall.ms += 1000
    await b.edit((r, c) => setText(r, c, 'a-1', 'B older'))
    await b.engine.sync()
    wall.ms += 1000
    await a.edit((r, c) => setText(r, c, 'a-1', 'A newer'))
    await a.engine.sync() // push A newer, pull B older (skipped: older)
    expect(a.texts()).toBe('A newer')
    await b.engine.sync()
    expect(b.texts()).toBe('A newer')
  })

  it('delete on one device, child added on another: the child survives at the root', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    const b = device('b', remote, wall)
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'parent').rows)
    await a.engine.sync()
    await b.engine.sync()
    wall.ms += 1000
    await b.edit((r, c) => insertAt(r, c, { parentId: 'a-1', afterId: null }, 'child').rows)
    await a.edit((r, c) => remove(r, c, ['a-1']))
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    expect(a.texts()).toBe('child')
    expect(b.texts()).toBe('child')
  })

  it('tombstones travel like any row', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    const b = device('b', remote, wall)
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'gone soon').rows)
    await a.engine.sync()
    await b.engine.sync()
    wall.ms += 1000
    await b.edit((r, c) => remove(r, c, ['a-1']))
    await b.engine.sync()
    await a.engine.sync()
    expect(a.texts()).toBe('')
    expect(a.rows['a-1']!.deletedAt).not.toBeNull()
  })

  it('a failed push keeps rows dirty and reports an error; the next sync recovers', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'x').rows)
    remote.failNextPush(new Error('network down'))
    await a.engine.sync()
    expect(a.engine.status()).toMatchObject({ state: 'error', error: 'network down', pending: 1 })
    expect(await a.local.dirtyIds()).toEqual(['a-1'])
    await a.engine.sync()
    expect(a.engine.status()).toMatchObject({ state: 'idle', pending: 0 })
    expect(remote.rows.has('a-1')).toBe(true)
  })

  it('an edit made while a push is in flight stays dirty', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'v1').rows)
    const release = remote.holdNextPush()
    const p = a.engine.sync()
    await Promise.resolve()
    wall.ms += 1000
    await a.edit((r, c) => setText(r, c, 'a-1', 'v2'))
    release()
    await p
    expect(await a.local.dirtyIds()).toEqual(['a-1'])
    await a.engine.sync()
    expect(remote.rows.get('a-1')!.row.text).toBe('v2')
    expect(await a.local.dirtyIds()).toEqual([])
  })

  it('pulls in pages and advances the cursor', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    const b = device('b', remote, wall)
    for (let i = 0; i < 8; i++) await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, `n${i}`).rows)
    await a.engine.sync()
    await b.engine.sync()
    expect(Object.keys(b.rows)).toHaveLength(8)
    const cursor = await b.local.getMeta('sync.cursor')
    expect(cursor).not.toBeNull()
    // Nothing new: a second pull accepts nothing and keeps the cursor.
    await b.engine.sync()
    expect(await b.local.getMeta('sync.cursor')).toBe(cursor)
  })

  it('a realtime nudge schedules a sync, and overlapping requests run once more at most', async () => {
    const remote = createFakeRemote()
    const wall = { ms: 1_000_000 }
    const a = device('a', remote, wall)
    const b = device('b', remote, wall)
    const timers: (() => void)[] = []
    const engineB = createSyncEngine({
      local: b.local,
      remote,
      clock: createClock(() => wall.ms),
      getRows: () => b.rows,
      applyRemote: () => {},
      setTimeout: (fn) => { timers.push(fn); return timers.length },
      clearTimeout: () => {},
    })
    engineB.start()
    await a.edit((r, c) => insertAt(r, c, { parentId: null, afterId: null }, 'ping').rows)
    await a.engine.sync() // the fake remote nudges subscribers on a real change
    expect(timers.length).toBeGreaterThan(0)
    for (const t of timers.splice(0)) t()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect((await b.local.getAll()).some((r) => r.text === 'ping')).toBe(true)
    engineB.stop()
  })
})

describe('normalizeRow / toWire', () => {
  it('fills columns an older build never wrote', async () => {
    const { normalizeRow } = await import('../types')
    const { toWire } = await import('./wire')
    const old = { id: 'x', parentId: null, rank: 'a0', text: 't', done: false, collapsed: false, updatedAt: '2026-10-28T00:00:00.000Z', deletedAt: null } as unknown as NodeRow
    expect(normalizeRow(old).numbered).toBe(false)
    expect(toWire(old).numbered).toBe(false)
  })
})
