import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryStore, idOf, pad, remove, shape } from '@hissypad/core'
import { apply, clock, configureLocalStore, loadPad, select, undo, usePad } from './store'
import { cmdDeleteSelection, cmdToggleDone } from './commands'
import { cmdRestore, cmdUndone, dayLabel, doneEntries, groupByDay, trashEntries } from './lists'

async function reset(outline: string) {
  const rows = pad(outline)
  const mem = createMemoryStore(Object.values(rows))
  configureLocalStore(mem)
  usePad.setState({ rows: {}, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [] })
  await loadPad()
  return mem
}

const rows = () => usePad.getState().rows
// By text, deleted rows included (core's idOf only sees live ones).
const id = (t: string) => Object.values(rows()).find((r) => r.text === t)?.id ?? idOf(rows(), t)
// Move the shared clock on, so the next delete is its own batch.
const skip = (ms: number) => clock.observe(new Date(Date.parse(clock.last()) + ms).toISOString())
const del = (...texts: string[]) => {
  const ids = texts.map(id)
  select(ids, ids[0]!)
  cmdDeleteSelection()
}

describe('trashEntries', () => {
  beforeEach(() => reset('A\nB\n  B1\n  B2\n    B2a\nC\nD'))

  it('groups one delete into one batch with its top-level rows and a count', () => {
    del('B', 'D')
    const batches = trashEntries()
    expect(batches).toHaveLength(1)
    const [b] = batches
    expect(b!.entries.map((e) => e.text)).toEqual(['B', 'D'])
    expect(b!.entries[0]!.childCount).toBe(3)
    expect(b!.count).toBe(5)
    // Every row of the delete shares the stamp.
    const stamps = new Set(['B', 'B1', 'B2', 'B2a', 'D'].map((t) => rows()[id(t)]!.deletedAt))
    expect(stamps.size).toBe(1)
  })

  it('lists newer batches first and keeps separate deletes apart', () => {
    del('A')
    skip(5000)
    del('C')
    const batches = trashEntries()
    expect(batches.map((b) => b.entries.map((e) => e.text))).toEqual([['C'], ['A']])
  })

  it('drops batches older than 30 days and blank spacers', () => {
    del('A')
    const stale = new Date(Date.now() - 31 * 86_400_000).toISOString()
    usePad.setState((s) => ({ rows: { ...s.rows, [id('A')]: { ...s.rows[id('A')]!, deletedAt: stale } } }))
    expect(trashEntries()).toEqual([])
    // A blank line on its own is not listed; a blank line with children is.
    const d = id('D')
    apply((r, ctx) => ({ ...r, [d]: { ...r[d]!, text: '', updatedAt: ctx.now() } }))
    select([d], d)
    cmdDeleteSelection()
    expect(trashEntries()).toEqual([])
    const b = id('B')
    apply((r, ctx) => ({ ...r, [b]: { ...r[b]!, text: '  ', updatedAt: ctx.now() } }))
    select([b], b)
    cmdDeleteSelection()
    expect(trashEntries()[0]!.entries[0]).toMatchObject({ text: '  ', childCount: 3 })
  })

  it('a child deleted on its own earlier is not part of the parent\'s batch', () => {
    del('B2a')
    skip(5000)
    del('B')
    const [newest, older] = trashEntries()
    expect(newest!.entries[0]).toMatchObject({ text: 'B', childCount: 2 })
    expect(older!.entries[0]).toMatchObject({ text: 'B2a', childCount: 0 })
  })
})

describe('cmdRestore', () => {
  beforeEach(() => reset('A\nB\n  B1\n  B2\n    B2a\nC'))

  it('brings a subtree back where it was, re-stamped, and selects it; undo re-deletes', async () => {
    const mem = await reset('A\nB\n  B1\n  B2\n    B2a\nC')
    del('B')
    expect(shape(rows())).toBe('A\nC')
    const before = rows()[id('B1')]!.updatedAt
    await mem.markClean([...mem.rows.keys()])
    cmdRestore([id('B')])
    expect(shape(rows())).toBe('A\nB\n  B1\n  B2\n    B2a\nC')
    expect(rows()[id('B1')]!.updatedAt > before).toBe(true)
    expect(usePad.getState().selection).toEqual([id('B')])
    await Promise.resolve()
    expect((await mem.dirtyIds()).sort()).toEqual(['B', 'B1', 'B2', 'B2a'].map(id).sort())
    expect(trashEntries()).toEqual([])
    undo()
    expect(shape(rows())).toBe('A\nC')
  })

  it('a restored child whose parent is still deleted lands at the root', () => {
    del('B2a')
    skip(5000)
    del('B')
    cmdRestore([id('B2a')])
    // At the root (its parent is still gone), placed by its own rank among the root lines.
    expect(shape(rows())).toBe('A\nB2a\nC')
    expect(rows()[id('B')]!.deletedAt).not.toBeNull()
  })

  it('unfolds a collapsed parent so the restored line is on screen', () => {
    del('B1')
    apply((r, ctx) => ({ ...r, [id('B')]: { ...r[id('B')]!, collapsed: true, updatedAt: ctx.now() } }))
    expect(shape(rows(), true)).toBe('A\nB\nC')
    cmdRestore([id('B1')])
    expect(shape(rows(), true)).toBe('A\nB\n  B1\n  B2\n    B2a\nC')
    expect(usePad.getState().selection).toEqual([id('B1')])
  })
})

describe('doneEntries / cmdUndone', () => {
  beforeEach(() => reset('A\nB\n  B1\nC'))

  it('lists live done rows newest first by doneAt, falling back to updatedAt', () => {
    select([id('A')], id('A'))
    cmdToggleDone()
    select([id('B')], id('B'))
    cmdToggleDone()
    expect(rows()[id('A')]!.doneAt).toBe(rows()[id('A')]!.updatedAt)
    expect(doneEntries().map((e) => e.text)).toEqual(['B', 'A'])
    expect(doneEntries()[0]!.childCount).toBe(1)
    // An older row done before the column existed sorts by updatedAt.
    const legacy = new Date(Date.now() + 60_000).toISOString()
    usePad.setState((s) => ({ rows: { ...s.rows, [id('C')]: { ...s.rows[id('C')]!, done: true, doneAt: null, updatedAt: legacy } } }))
    expect(doneEntries().map((e) => e.text)).toEqual(['C', 'B', 'A'])
    expect(doneEntries()[0]!.doneAt).toBe(legacy)
    // Deleted rows are not "done".
    apply((r, ctx) => remove(r, ctx, [id('B')]))
    expect(doneEntries().map((e) => e.text)).toEqual(['C', 'A'])
  })

  it('cmdUndone clears done and doneAt and is undoable', () => {
    select([id('A')], id('A'))
    cmdToggleDone()
    cmdUndone(id('A'))
    expect(rows()[id('A')]).toMatchObject({ done: false, doneAt: null })
    expect(doneEntries()).toEqual([])
    undo()
    expect(rows()[id('A')]!.done).toBe(true)
    expect(rows()[id('A')]!.doneAt).not.toBeNull()
  })
})

describe('day grouping', () => {
  it('labels today, yesterday and older dates, and buckets in order', () => {
    const now = new Date(2026, 10, 2, 15, 0).getTime()
    const at = (daysAgo: number, h = 9) => new Date(2026, 10, 2 - daysAgo, h).toISOString()
    expect(dayLabel(at(0), now)).toBe('Today')
    expect(dayLabel(at(1), now)).toBe('Yesterday')
    expect(dayLabel(at(2), now)).toMatch(/Oct 31/)
    const groups = groupByDay([at(0, 12), at(0, 8), at(1), at(5)], (x) => x, now)
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([['Today', 2], ['Yesterday', 1], [dayLabel(at(5), now), 1]])
  })
})
