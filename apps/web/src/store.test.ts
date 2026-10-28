import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryStore, pad, shape, idOf } from '@hissypad/core'
import { apply, clickSelect, configureLocalStore, edit, importOutline, loadPad, redo, select, undo, usePad } from './store'
import { cmdDeleteDone, cmdDeleteSelection, cmdSetText, cmdSplit, cmdToggleDone } from './commands'
import { setText } from '@hissypad/core'

function reset(initialOutline?: string) {
  const rows = initialOutline ? pad(initialOutline) : {}
  const mem = createMemoryStore(Object.values(rows))
  configureLocalStore(mem)
  usePad.setState({ rows: {}, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [] })
  return mem
}

describe('loadPad', () => {
  beforeEach(() => reset())

  it('creates one empty line on an empty store and persists it', async () => {
    const mem = reset()
    await loadPad()
    const live = Object.values(usePad.getState().rows).filter((r) => r.deletedAt === null)
    expect(live).toHaveLength(1)
    expect(live[0]!.text).toBe('')
    expect(mem.rows.size).toBe(1)
    expect(await mem.dirtyIds()).toHaveLength(1)
  })

  it('loads existing rows as they are', async () => {
    reset('A\n  B')
    await loadPad()
    expect(shape(usePad.getState().rows)).toBe('A\n  B')
  })
})

describe('apply / undo / persist', () => {
  it('writes only the changed rows, marked dirty', async () => {
    const mem = reset('A\nB')
    await loadPad()
    await mem.markClean([...mem.rows.keys()])
    const a = idOf(usePad.getState().rows, 'A')
    apply((rows, ctx) => setText(rows, ctx, a, 'A!'))
    await Promise.resolve()
    expect(await mem.dirtyIds()).toEqual([a])
    expect(mem.rows.get(a)!.text).toBe('A!')
  })

  it('undo and redo walk the history and persist each step', async () => {
    const mem = reset('A')
    await loadPad()
    const a = idOf(usePad.getState().rows, 'A')
    cmdSplit(a, 1)
    expect(shape(usePad.getState().rows)).toBe('A\n')
    undo()
    expect(shape(usePad.getState().rows)).toBe('A')
    await Promise.resolve()
    const live = [...mem.rows.values()].filter((r) => r.deletedAt === null)
    expect(live.map((r) => r.text)).toEqual(['A'])
    redo()
    expect(shape(usePad.getState().rows)).toBe('A\n')
  })

  it('coalesces a run of keystrokes into one undo step', async () => {
    reset('A')
    await loadPad()
    const a = idOf(usePad.getState().rows, 'A')
    cmdSetText(a, 'Ab')
    cmdSetText(a, 'Abc')
    cmdSetText(a, 'Abcd')
    expect(usePad.getState().past).toHaveLength(1)
    undo()
    expect(usePad.getState().rows[a]!.text).toBe('A')
  })
})

describe('selection and visibility', () => {
  it('Delete done removes crossed-out lines with their subtrees and reports the count', async () => {
    reset('A\nB\n  B1\nC')
    await loadPad()
    const rows = usePad.getState().rows
    select([idOf(rows, 'B')], idOf(rows, 'B'))
    cmdToggleDone()
    expect(cmdDeleteDone()).toBe(2)
    expect(shape(usePad.getState().rows)).toBe('A\nC')
    expect(cmdDeleteDone()).toBe(0)
    undo()
    expect(shape(usePad.getState().rows)).toBe('A\n~B\n  B1\nC')
  })

  it('a plain bullet tap toggles once something is selected (mobile multi-select)', async () => {
    reset('A\nB\nC')
    await loadPad()
    const rows = usePad.getState().rows
    const [a, b, c] = ['A', 'B', 'C'].map((t) => idOf(rows, t))
    clickSelect(a!, { shift: false, meta: false })
    expect(usePad.getState().selection).toEqual([a])
    clickSelect(c!, { shift: false, meta: false })
    expect(usePad.getState().selection).toEqual([a, c])
    clickSelect(a!, { shift: false, meta: false })
    expect(usePad.getState().selection).toEqual([c])
    clickSelect(c!, { shift: false, meta: false })
    expect(usePad.getState().selection).toEqual([])
    clickSelect(b!, { shift: false, meta: false })
    expect(usePad.getState().selection).toEqual([b])
  })

  it('deleting the whole selection leaves one line to type into', async () => {
    reset('A\nB')
    await loadPad()
    const rows = usePad.getState().rows
    select([idOf(rows, 'A'), idOf(rows, 'B')], idOf(rows, 'A'))
    cmdDeleteSelection()
    const live = Object.values(usePad.getState().rows).filter((r) => r.deletedAt === null)
    expect(live.map((r) => r.text)).toEqual([''])
  })

  it('importOutline at top, bottom and after a line', async () => {
    reset('A\nB')
    await loadPad()
    importOutline('top1\n  top2', 'top')
    importOutline('bottom', 'bottom')
    importOutline('mid', { afterId: idOf(usePad.getState().rows, 'A') })
    expect(shape(usePad.getState().rows)).toBe('top1\n  top2\nA\nmid\nB\nbottom')
  })

  it('edit clears the selection and bumps rev', async () => {
    reset('A')
    await loadPad()
    const a = idOf(usePad.getState().rows, 'A')
    select([a], a)
    edit(a, 0)
    expect(usePad.getState().selection).toEqual([])
    expect(usePad.getState().editing).toMatchObject({ id: a, caret: 0, rev: 1 })
  })
})

describe('per-op undo', () => {
  it('undo reverts only the rows the op touched, not rows that arrived meanwhile', async () => {
    reset('A\nB')
    await loadPad()
    const a = idOf(usePad.getState().rows, 'A')
    const b = idOf(usePad.getState().rows, 'B')
    cmdSetText(a, 'A edited')
    // Another device changes B after our edit; it lands through the remote path.
    const remoteB = { ...usePad.getState().rows[b]!, text: 'B from phone', updatedAt: new Date(Date.parse(usePad.getState().rows[b]!.updatedAt) + 60_000).toISOString() }
    usePad.setState((s) => ({ rows: { ...s.rows, [b]: remoteB } }))
    undo()
    expect(usePad.getState().rows[a]!.text).toBe('A')
    expect(usePad.getState().rows[b]!.text).toBe('B from phone')
    // The undo is stamped fresh so it syncs as a new write.
    expect(usePad.getState().rows[a]!.updatedAt > remoteB.updatedAt).toBe(true)
    redo()
    expect(usePad.getState().rows[a]!.text).toBe('A edited')
    expect(usePad.getState().rows[b]!.text).toBe('B from phone')
  })

  it('undoing an insert tombstones it; undoing a delete brings the subtree back; selection lands on it', async () => {
    reset('A\n  A1\nB')
    await loadPad()
    const a = idOf(usePad.getState().rows, 'A')
    select([a], a)
    cmdDeleteSelection()
    expect(shape(usePad.getState().rows)).toBe('B')
    undo()
    expect(shape(usePad.getState().rows)).toBe('A\n  A1\nB')
    expect(usePad.getState().selection).toEqual(expect.arrayContaining([a]))
    redo()
    expect(shape(usePad.getState().rows)).toBe('B')
    cmdSplit(idOf(usePad.getState().rows, 'B'), 1)
    expect(shape(usePad.getState().rows)).toBe('B\n')
    undo()
    expect(shape(usePad.getState().rows)).toBe('B')
    const tomb = Object.values(usePad.getState().rows).filter((r) => r.deletedAt !== null)
    expect(tomb.length).toBeGreaterThan(0)
  })
})
