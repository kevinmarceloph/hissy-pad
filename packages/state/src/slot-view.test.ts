import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dedent, findFixedPad, idOf, indent, insertAfter, insertAt, moveSibling, remove, setSlot, setText, shape, slotKey } from '@hissypad/core'

import { resetStore, tableShape } from './testing'
import { apply, applyAll, closeSlot, loadPad, openPad, openSlot, usePad, zoomTo } from './store'
import { redo, undo } from './history'
import { LINE_ACTIONS, lineAbilities, lineActions } from './actions'
import { cmdAddAbove, cmdAddBelow, cmdDeleteSelection, cmdPasteAfterSelection, cmdSetState, cmdSetText } from './commands'
import { cmdMoveToPad } from './pads'
import { edit, select } from './selection'

const H = slotKey('2026-11-25', 9)
const all = () => usePad.getState().all
const view = () => shape(usePad.getState().rows)
const id = (text: string) => idOf(all(), text)
const today = () => findFixedPad(all(), 'Today')!.id

// The Inbox holds A (with A1 and A2 under it), B and C. Today holds T and U. A and U are in 9am.
beforeEach(async () => {
  resetStore('A\n  A1\n  A2\nB\nC')
  await loadPad()
  applyAll((rows, ctx) => {
    const t = insertAt(rows, ctx, { parentId: today(), afterId: null }, 'T')
    const u = insertAt(t.rows, ctx, { parentId: today(), afterId: t.newId }, 'U')
    return setSlot(u.rows, ctx, [u.newId, idOf(u.rows, 'A')], H)
  })
})

describe('an hour as a view of the store', () => {
  it('shows the lines put in the hour and what is under them, in pad order', () => {
    expect(openSlot(H)).toBe(true)
    // Today comes before the Inbox, whatever the ranks say across pads.
    expect(view()).toBe('U\nA\n  A1\n  A2')
    expect(usePad.getState().slotId).toBe(H)
    closeSlot()
    expect(usePad.getState().slotId).toBeNull()
    expect(view()).toBe('A\n  A1\n  A2\nB\nC')
  })

  it('is one hour, and ends when a pad is opened or a line is zoomed into', () => {
    expect(openSlot(slotKey('2026-11-25', 9, 3))).toBe(false)
    expect(openSlot('nonsense')).toBe(false)
    openSlot(H)
    zoomTo(id('A'))
    expect(usePad.getState()).toMatchObject({ slotId: null, zoomId: id('A') })
    openSlot(H)
    expect(usePad.getState()).toMatchObject({ slotId: H, zoomId: null })
    openPad(null)
    expect(usePad.getState().slotId).toBeNull()
  })

  it('edits a line where it lives: its pad and its place there do not change', () => {
    openSlot(H)
    const before = all()[id('U')]!
    apply((rows, ctx) => setText(rows, ctx, id('U'), 'U, typed in the hour'))
    expect(all()[before.id]).toMatchObject({ text: 'U, typed in the hour', parentId: today(), rank: before.rank, slot: H })
    expect(view()).toBe('U, typed in the hour\nA\n  A1\n  A2')
    undo()
    expect(all()[before.id]!.text).toBe('U')
    expect(view()).toBe('U\nA\n  A1\n  A2')
    redo()
    expect(all()[before.id]!.text).toBe('U, typed in the hour')
  })

  it('edits what is under a line like any pad does', () => {
    openSlot(H)
    apply((rows, ctx) => indent(rows, ctx, [id('A2')]))
    expect(view()).toBe('U\nA\n  A1\n    A2')
    expect(all()[id('A2')]).toMatchObject({ parentId: id('A1'), slot: null })
    apply((rows, ctx) => insertAfter(rows, ctx, id('A1'), 'A1 and a half').rows)
    expect(tableShape()).toContain('A\n  A1\n    A1 and a half\n    A2\nB')
  })

  it('writes nothing for a move past a line of another pad: the hour lists its lines as the pads have them', () => {
    openSlot(H)
    const before = all()
    const steps = usePad.getState().past.length
    apply((rows, ctx) => moveSibling(rows, ctx, [id('A')], 'up'))
    expect(all()).toBe(before)
    expect(usePad.getState().past.length).toBe(steps)
    expect(view()).toBe('U\nA\n  A1\n  A2')
  })

  it('moves a line in its pad when it is moved among the hour\'s lines of that pad', () => {
    // B and C join A in the hour: three lines of the Inbox, after Today's U.
    applyAll((rows, ctx) => setSlot(rows, ctx, [id('B'), id('C')], H))
    openSlot(H)
    expect(view()).toBe('U\nA\n  A1\n  A2\nB\nC')
    apply((rows, ctx) => moveSibling(rows, ctx, [id('C')], 'up'))
    expect(view()).toBe('U\nA\n  A1\n  A2\nC\nB')
    // It moved in the Inbox, with nothing else touched; one undo step takes it back.
    expect(tableShape()).toContain('A\n  A1\n  A2\nC\nB')
    apply((rows, ctx) => moveSibling(rows, ctx, [id('C')], 'up'))
    expect(view()).toBe('U\nC\nA\n  A1\n  A2\nB')
    expect(tableShape()).toContain('C\nA\n  A1\n  A2\nB')
    // Up again would pass Today's line: nothing to write.
    const here = all()
    apply((rows, ctx) => moveSibling(rows, ctx, [id('C')], 'up'))
    expect(all()).toBe(here)
    apply((rows, ctx) => moveSibling(rows, ctx, [id('C')], 'down'))
    expect(view()).toBe('U\nA\n  A1\n  A2\nC\nB')
    undo()
    expect(tableShape()).toContain('C\nA\n  A1\n  A2\nB')
  })

  it('puts a line moved out to the root after the line it was under, in that line\'s pad, and in the hour', () => {
    openSlot(H)
    apply((rows, ctx) => dedent(rows, ctx, [id('A1')]))
    // In the Inbox it is now the line after A; in the hour it is one of the hour's own.
    expect(all()[id('A1')]).toMatchObject({ parentId: null, slot: H })
    expect(tableShape().startsWith('A\n  A2\nA1\nB\nC')).toBe(true)
    expect(view()).toBe('U\nA\n  A2\nA1')
  })

  it('keeps one of the hour\'s lines in the hour when it is moved in under another', () => {
    openSlot(H)
    apply((rows, ctx) => indent(rows, ctx, [id('A')]))
    // A is under U now, in Today, with what was under it. It still carries its hour.
    expect(all()[id('A')]).toMatchObject({ parentId: id('U'), slot: H })
    expect(view()).toBe('U\n  A\n    A1\n    A2')
  })

  it('opens the line after one of the hour\'s own right under it, in that line\'s pad and in the hour', () => {
    openSlot(H)
    // U has nothing under it, so a line after it is at the root of the view.
    const made = apply((rows, ctx) => insertAfter(rows, ctx, id('U')).rows)
    const fresh = Object.values(made).find((r) => r.text === '')!
    expect(all()[fresh.id]).toMatchObject({ parentId: today(), slot: H })
    // An empty line stays in the view, so it can be typed in.
    apply((rows, ctx) => setText(rows, ctx, fresh.id, 'new'))
    expect(tableShape()).toContain('@Today\n  T\n  U\n  new')
    expect(view()).toBe('U\nnew\nA\n  A1\n  A2')
    undo()
    undo()
    expect(all()[fresh.id]!.deletedAt).not.toBeNull()
    expect(view()).toBe('U\nA\n  A1\n  A2')
  })

  it('puts a line made above every line of the hour before the first one, in that line\'s pad', () => {
    openSlot(H)
    const made = apply((rows, ctx) => insertAt(rows, ctx, { parentId: null, afterId: null }, 'first').rows)
    expect(all()[idOf(made, 'first')]).toMatchObject({ parentId: today(), slot: H })
    expect(tableShape()).toContain('@Today\n  T\n  first\n  U')
    expect(view()).toBe('first\nU\nA\n  A1\n  A2')
  })

  it('sends a line made in an empty hour to Today, where it goes among the scheduled lines by its hour', () => {
    const empty = slotKey('2026-11-25', 11)
    openSlot(empty)
    expect(view()).toBe('')
    const made = apply((rows, ctx) => insertAt(rows, ctx, { parentId: null, afterId: null }, 'first').rows)
    expect(all()[idOf(made, 'first')]).toMatchObject({ parentId: today(), slot: empty })
    expect(tableShape()).toContain('@Today\n  T\n  U\n  first')
  })

  it('archives a line with what is under it, and follows a change made from outside', () => {
    openSlot(H)
    const under = id('A1')
    apply((rows, ctx) => remove(rows, ctx, [id('A')]))
    expect(all()[under]!.deletedAt).not.toBeNull()
    // Archived lines stay in the hour, where they were (Kevin, 2026-11-27).
    expect(view()).toBe('U\nA\n  A1\n  A2')
    expect(usePad.getState().rows[under]!.deletedAt).toBeNull()
    undo()
    expect(all()[under]!.deletedAt).toBeNull()
    expect(view()).toBe('U\nA\n  A1\n  A2')
    // A line put in the hour from the pad's side shows up in the open hour.
    applyAll((rows, ctx) => setSlot(rows, ctx, [id('C')], H))
    expect(view()).toBe('U\nA\n  A1\n  A2\nC')
  })
})

describe('the toolbar in an open hour', () => {
  const offered = (can: ReturnType<typeof lineAbilities>) => lineActions(can).map((a) => a.id)

  it('offers Out of this hour and not Make pad, and the other way round in a pad', () => {
    const inPad = lineAbilities(usePad.getState().rows, [id('B')])
    expect(inPad.hour).toBe(false)
    expect(offered(inPad)).toContain('makePad')
    expect(offered(inPad)).not.toContain('outOfHour')

    openSlot(H)
    const inHour = lineAbilities(usePad.getState().rows, [id('A')])
    expect(inHour.hour).toBe(true)
    expect(offered(inHour)).toContain('outOfHour')
    expect(offered(inHour)).not.toContain('makePad')
  })

  it('has up and down for one of the hour\'s own lines only past a line of its own pad, and for lines under one', () => {
    openSlot(H)
    // A is the second of the hour's two lines, and U is Today's: it can go in under U, and
    // cannot trade places with it.
    expect(lineAbilities(usePad.getState().rows, [id('A')])).toMatchObject({ up: false, down: false, indent: true, dedent: false })
    expect(lineAbilities(usePad.getState().rows, [id('U')])).toMatchObject({ up: false, down: false, indent: false })
    expect(lineAbilities(usePad.getState().rows, [id('A2')])).toMatchObject({ up: true, down: false, indent: true, dedent: true })
    // With another Inbox line in the hour, the two can.
    applyAll((rows, ctx) => setSlot(rows, ctx, [id('B')], H))
    expect(lineAbilities(usePad.getState().rows, [id('A')])).toMatchObject({ up: false, down: true })
    expect(lineAbilities(usePad.getState().rows, [id('B')])).toMatchObject({ up: true, down: false })
  })

  it('takes the selected lines out of the hour and leaves them in their pads', () => {
    openSlot(H)
    const a = all()[id('A')]!
    select([a.id], a.id)
    const said = LINE_ACTIONS.find((x) => x.id === 'outOfHour')!.run()
    expect(said).toBe('Took 1 line out of the hour.')
    expect(all()[a.id]).toMatchObject({ slot: null, parentId: a.parentId, rank: a.rank, deletedAt: null })
    expect(usePad.getState().selection).toEqual([])
    expect(view()).toBe('U')
    undo()
    expect(view()).toBe('U\nA\n  A1\n  A2')
  })

  it('makes no line for an hour when its last live line is archived', () => {
    openSlot(H)
    const before = Object.keys(all()).length
    const u = id('U')
    select([u, id('A')], u)
    cmdDeleteSelection()
    // Both are archived, and still drawn in the hour.
    expect(all()[u]!.deletedAt).not.toBeNull()
    expect(view()).toBe('U\nA\n  A1\n  A2')
    // Nothing new was made, in Today or anywhere.
    expect(Object.keys(all()).length).toBe(before)
  })

  it('puts a line added above the hour\'s first line before it in its pad, and one added below after it', () => {
    openSlot(H)
    edit(id('U'), 'end')
    cmdAddAbove()
    cmdSetText(usePad.getState().editing!.id, 'above U')
    edit(id('U'), 'end')
    cmdAddBelow()
    cmdSetText(usePad.getState().editing!.id, 'below U')
    expect(tableShape()).toContain('@Today\n  T\n  above U\n  U\n  below U')
    expect(view()).toBe('above U\nU\nbelow U\nA\n  A1\n  A2')
  })

  it('moves an hour\'s line to another pad, the open one included, and it stays in the hour', () => {
    openSlot(H)
    select([id('U')], id('U'))
    // U is in Today; the Inbox is the pad that is open behind the hour.
    expect(cmdMoveToPad(null)).toBe(1)
    expect(all()[id('U')]).toMatchObject({ parentId: null, slot: H })
    expect(view()).toContain('U')
  })

  it('pastes an outline below a line of the hour as lines of the hour, after it in its pad', () => {
    openSlot(H)
    select([id('U')], id('U'))
    cmdPasteAfterSelection('one\n  under one\ntwo')
    expect(tableShape()).toContain('@Today\n  T\n  U\n  one\n    under one\n  two')
    expect(view()).toBe('U\none\n  under one\ntwo\nA\n  A1\n  A2')
  })
})

describe('doing puts a line in the hour it is now', () => {
  afterEach(() => vi.useRealTimers())
  const at = (hour: number) => vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(new Date(2026, 10, 25, hour, 20))

  it('from the switch: doing adds the hour, done does not, and undo takes it back', () => {
    at(14)
    select([id('B')], id('B'))
    cmdSetState('doing')
    expect(all()[id('B')]).toMatchObject({ doing: true, slot: slotKey('2026-11-25', 14) })
    undo()
    expect(all()[id('B')]).toMatchObject({ doing: false, slot: null })
    select([id('C')], id('C'))
    cmdSetState('done')
    expect(all()[id('C')]).toMatchObject({ done: true, slot: null })
  })

  it('inside an open hour: the line keeps that hour and gains this one', () => {
    at(10)
    openSlot(H)
    select([id('A')], id('A'))
    cmdSetState('doing')
    expect(all()[id('A')]).toMatchObject({ doing: true, slot: slotKey('2026-11-25', 9, 2) })
    expect(view()).toBe('U\nA\n  A1\n  A2')
  })
})
