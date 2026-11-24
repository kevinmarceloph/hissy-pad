import { resetStore } from './testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { shape, idOf, listPads } from '@hissypad/core'
import { loadPad, openPad, usePad } from './store'
import { redo, undo } from './history'
import { select } from './selection'
import { cmdSetKind, cmdDeleteDone, cmdDeleteSelection, cmdIndent, cmdSetText, cmdSplit } from './commands'
import { archiveNameFor, cmdDeletePad, cmdFreshStart, cmdLineToPad, cmdPadToLine, cmdMoveTo, openSubPad, placeList, placeFromKey, cmdMovePad, padCandidate, cmdMoveToPad, cmdNewPad, cmdRenamePad, padList, subName, PLACE_ARROW, MAIN_PAD_NAME } from './pads'
import { importOutline } from './store'

const reset = resetStore

const shown = () => shape(usePad.getState().rows)
const main = () => shape(usePad.getState().rows)

describe('pads in the store', () => {
  let mem: ReturnType<typeof reset>
  beforeEach(async () => {
    mem = reset('A\nB\n  B1\nC')
    await loadPad()
  })

  it('a new pad opens empty, is listed after the fixed tabs, and edits in it land under the pad node', async () => {
    const w = cmdNewPad('Work')
    expect(usePad.getState().padId).toBe(w)
    expect(shown()).toBe('') // one blank line, being edited
    expect(Object.keys(usePad.getState().rows)).toHaveLength(1)
    expect(usePad.getState().editing?.id).toBe(Object.keys(usePad.getState().rows)[0])
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'Work'])
    const ids = importOutline('one\n\ttwo', 'top')
    expect(shown()).toBe('one\n  two\n')
    // In table terms the top line hangs under the pad node.
    expect(usePad.getState().all[ids[0]!]!.parentId).toBe(w)
    await Promise.resolve()
    expect(mem.rows.get(ids[0]!)!.parentId).toBe(w)
    expect(await mem.getMeta('pad.current')).toBe(w)
    openPad(null)
    expect(main()).toBe('A\nB\n  B1\nC')
    expect(await mem.getMeta('pad.current')).toBe('')
  })

  it('ops inside a pad stay inside it: indent, split, Delete done, delete the last line', () => {
    cmdNewPad('Work')
    const blank = Object.keys(usePad.getState().rows)[0]!
    const ids = importOutline('x\ny', 'top')
    select([blank], blank)
    cmdDeleteSelection()
    expect(shown()).toBe('x\ny')
    select([ids[1]!], ids[1]!)
    cmdIndent()
    expect(shown()).toBe('x\n  y')
    cmdSplit(ids[0]!, 1) // the tail becomes the first child, since x shows children
    expect(shown()).toBe('x\n  \n  y')
    select([ids[0]!], ids[0]!)
    cmdDeleteSelection()
    expect(shown()).toBe('')
    // The whole pad gone leaves one blank line to type into, inside the pad.
    const left = Object.values(usePad.getState().rows)
    expect(left).toHaveLength(1)
    expect(usePad.getState().all[left[0]!.id]!.parentId).toBe(usePad.getState().padId)
    cmdSetText(left[0]!.id, 'done one')
    expect(cmdDeleteDone()).toBe(0)
    openPad(null)
    expect(main()).toBe('A\nB\n  B1\nC')
  })

  it('rename and delete; archiving the open pad falls back to the Inbox; undo brings it back', () => {
    const w = cmdNewPad('Work')
    importOutline('w1\nw2', 'top')
    cmdRenamePad(w, 'Werk')
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'Werk'])
    expect(padList(usePad.getState().all).map((p) => p.count)).toEqual([0, 3, 0, 2]) // Today; A, B, C; Later; w1, w2 (B1 is nested, the blank line is not counted)
    expect(cmdDeletePad(w)).toBe(2) // w1 and w2; the blank first line is not counted
    expect(usePad.getState().padId).toBeNull()
    expect(listPads(usePad.getState().all).map((p) => p.text)).toEqual(['Today', 'Later'])
    undo()
    expect(listPads(usePad.getState().all).map((r) => r.text)).toEqual(['Today', 'Later', 'Werk'])
    expect(openPad(w)).toBe(true)
    expect(shown()).toBe('w1\nw2\n')
    redo()
    expect(usePad.getState().padId).toBeNull() // setAll via undo keeps us on main
  })

  it('move to pad takes the selection with subtrees to the top of the other pad', () => {
    const w = cmdNewPad('Work')
    importOutline('w1', 'top')
    openPad(null)
    const b = idOf(usePad.getState().rows, 'B')
    select([b], b)
    expect(cmdMoveToPad(w)).toBe(2)
    expect(main()).toBe('A\nC')
    expect(usePad.getState().selection).toEqual([])
    openPad(w)
    expect(shown()).toBe('B\n  B1\nw1\n')
    // Back to main, at the top.
    const w1 = idOf(usePad.getState().rows, 'w1')
    select([w1], w1)
    expect(cmdMoveToPad(null)).toBe(1)
    openPad(null)
    expect(main()).toBe('w1\nA\nC')
    // Same pad: nothing happens.
    select([w1], w1)
    expect(cmdMoveToPad(null)).toBe(0)
    // Moving everything out leaves one blank line behind.
    const vis = Object.keys(usePad.getState().rows)
    select(vis, vis[0]!, vis.at(-1)!)
    expect(cmdMoveToPad(w)).toBe(3)
    expect(Object.values(usePad.getState().rows).map((r) => r.text)).toEqual([''])
  })

  it('fresh start keeps the right side here, archives the left into a dated pad, one undo step', () => {
    const rows = usePad.getState().rows
    const sides = { right: new Set([idOf(rows, 'B')]), left: new Set<string>() }
    const name = archiveNameFor(usePad.getState().all, null, new Date('2026-11-02T10:00:00+08:00'))
    expect(name).toBe('Before 2 Nov 2026')
    const res = cmdFreshStart(sides, name)
    expect(res.moved).toBe(2)
    expect(main()).toBe('B\n  B1')
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'Before 2 Nov 2026'])
    openPad(res.archiveId)
    expect(shown()).toBe('A\nC')
    openPad(null)
    undo()
    expect(main()).toBe('A\nB\n  B1\nC')
    expect(listPads(usePad.getState().all).map((p) => p.text)).toEqual(['Today', 'Later'])
  })

  it('a remembered pad reopens on load; a missing one falls back to the Inbox', async () => {
    const w = cmdNewPad('Work')
    importOutline('w1', 'top')
    await Promise.resolve()
    usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading', past: [], future: [] })
    await loadPad()
    expect(usePad.getState().padId).toBe(w)
    expect(shown()).toBe('w1\n')
    await mem.setMeta('pad.current', 'gone')
    usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading' })
    await loadPad()
    expect(usePad.getState().padId).toBeNull()
  })

  it('pads reorder one place at a time, undoably, and the open pad stays open', () => {
    const a = cmdNewPad('One')
    const b = cmdNewPad('Two')
    const names = () => padList(usePad.getState().all).map((p) => p.name)
    expect(cmdMovePad(b, -1)).toBe(true)
    expect(names()).toEqual(['Today', 'Inbox', 'Later', 'Two', 'One'])
    expect(usePad.getState().padId).toBe(b)
    expect(cmdMovePad(b, -1)).toBe(false)
    expect(cmdMovePad(a, 1)).toBe(false)
    undo()
    expect(names()).toEqual(['Today', 'Inbox', 'Later', 'One', 'Two'])
  })

  it('Fold into turns a pad back into a line of another pad, opens that pad if the folded one was shown, and undoes', () => {
    const w = cmdNewPad('Work')
    importOutline('one\n\ttwo', 'top')
    expect(cmdPadToLine(w, { padId: w, subId: null })).toBeNull()
    expect(cmdPadToLine(w, { padId: 'nope', subId: null })).toBeNull()
    expect(cmdPadToLine(w, { padId: null, subId: null })).toBe('Work')
    expect(usePad.getState().padId).toBeNull()
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later'])
    expect(main()).toBe('Work\n  one\n    two\n  \nA\nB\n  B1\nC')
    undo()
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'Work'])
    expect(main()).toBe('A\nB\n  B1\nC')
    // From another pad: the pad shown stays.
    const x = cmdNewPad('X')
    expect(cmdPadToLine(w, { padId: null, subId: null })).toBe('Work')
    expect(usePad.getState().padId).toBe(x)
  })

  it('a sub-pad is listed by the text before an em dash; the rest is a description', () => {
    const id = (t: string) => idOf(usePad.getState().all, t)
    cmdSetText(id('B'), '\u{1F525} \u2014 urgent things')
    select([id('\u{1F525} \u2014 urgent things')], id('\u{1F525} \u2014 urgent things'))
    cmdSetKind('header')
    const all = usePad.getState().all
    expect(padList(all).find((p) => p.id === null)!.subs.map((s) => s.name)).toEqual(['\u{1F525}'])
    expect(placeList(all).map((p) => p.label)).toContain(`${MAIN_PAD_NAME} ${PLACE_ARROW} \u{1F525}`)
    expect(subName('\u2014 all dash')).toBe('\u2014 all dash')
    expect(subName('a - b')).toBe('a - b')
    expect(subName('')).toBe('Untitled')
  })

  it('a top-level header is a sub-pad: listed as "Pad → Sub-pad", a target for a move, and a place to jump to', () => {
    const id = (t: string) => idOf(usePad.getState().all, t)
    select([id('B')], id('B'))
    cmdSetKind('header')
    const w = cmdNewPad('Work')
    importOutline('w1\nw2', 'top')
    select([id('w2')], id('w2'))
    cmdSetKind('header')
    const all = () => usePad.getState().all
    expect(placeList(all()).map((p) => p.label)).toEqual(['Today', 'Inbox', 'Inbox → B', 'Later', 'Work', 'Work → w2'])
    expect(padList(all()).map((p) => p.subs.map((s) => `${s.name}:${s.count}`))).toEqual([[], ['B:1'], [], ['w2:0']])
    expect(placeFromKey(all(), 'main')).toEqual({ padId: null, subId: null })
    expect(placeFromKey(all(), id('B'))).toEqual({ padId: null, subId: id('B') })
    // From Work, send w1 to Main → B: it lands at the top of B's lines.
    select([id('w1')], id('w1'))
    expect(cmdMoveTo({ padId: null, subId: id('B') })).toBe(1)
    expect(shown()).toBe('#w2\n')
    // A sub-pad of the pad shown is a target too; the pad itself is not.
    openPad(null)
    expect(main()).toBe('A\n#B\n  w1\n  B1\nC')
    select([id('A'), id('C')], id('A'))
    expect(cmdMoveTo({ padId: null, subId: null })).toBe(0)
    expect(cmdMoveTo({ padId: null, subId: id('B') })).toBe(2)
    expect(main()).toBe('#B\n  A\n  C\n  w1\n  B1')
    undo()
    expect(main()).toBe('A\n#B\n  w1\n  B1\nC')
    // Jumping: the pad opens and the header is the row to scroll to.
    expect(openSubPad(id('w2'))).toBe(true)
    expect(usePad.getState().padId).toBe(w)
    expect(usePad.getState().reveal?.id).toBe(id('w2'))
    expect(openSubPad(id('A'))).toBe(false)
  })

  it('Make pad turns the one selected line into a pad, stays on the pad shown, and undoes in one step', () => {
    const { rows } = usePad.getState()
    select([idOf(rows, 'A'), idOf(rows, 'C')], idOf(rows, 'A'))
    expect(padCandidate()).toBeNull()
    expect(cmdLineToPad()).toBeNull()
    select([idOf(rows, 'B'), idOf(rows, 'B1')], idOf(rows, 'B')) // a line and its own child: still one line
    const res = cmdLineToPad()!
    expect(res.name).toBe('B')
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'B'])
    expect(usePad.getState().padId).toBeNull()
    expect(main()).toBe('A\nC')
    openPad(res.padId)
    expect(shown()).toBe('B1')
    openPad(null)
    undo()
    expect(main()).toBe('A\nB\n  B1\nC')
    expect(padList(usePad.getState().all)).toHaveLength(3)
  })
})
