import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, shape } from '@hissypad/core'
import { loadPad, usePad } from './store'
import { undo } from './history'
import { edit, select } from './selection'
import {
  cmdAddAbove, cmdAddAtTop, cmdAddBelow, cmdAppendAtEnd, cmdBackspaceAtStart, cmdCopySelection, cmdCutSelection, cmdDedent, cmdDeleteSelection, cmdEditNeighbor,
  cmdEnter, cmdIndent, cmdMove, cmdPasteAfterSelection, cmdPasteInto, cmdSetKind, cmdTextChanged, cmdToggleCollapsed, cmdToggleNumbered,
  cmdUngroup, copyPayload, setClipboard,
} from './commands'
import { resetStore } from './testing'

const rows = () => usePad.getState().rows
const shown = () => shape(rows())
const id = (text: string) => idOf(rows(), text)
const editing = () => usePad.getState().editing
const sel = (...texts: string[]) => select(texts.map(id), id(texts[0]!), id(texts.at(-1)!))

describe('commands', () => {
  beforeEach(async () => {
    resetStore('A\nB\n  B1\n  B2\nC')
    await loadPad()
  })

  it('Enter at the start of a line opens a blank one above and stays put; elsewhere it splits', () => {
    const a = id('A')
    cmdEnter(a, 0)
    expect(shown()).toBe('\nA\nB\n  B1\n  B2\nC')
    expect(editing()).toMatchObject({ id: a, caret: 0 })
    cmdEnter(id('B1'), 1)
    expect(shown()).toBe('\nA\nB\n  B\n  1\n  B2\nC')
    expect(editing()).toMatchObject({ id: id('1'), caret: 0 })
  })

  it('+ above and + below add a blank line beside the selection and edit it', () => {
    sel('B', 'C')
    cmdAddAbove()
    expect(shown()).toBe('A\n\nB\n  B1\n  B2\nC')
    expect(rows()[editing()!.id]!.text).toBe('')
    undo()
    sel('A', 'B')
    cmdAddBelow()
    expect(shown()).toBe('A\nB\n  \n  B1\n  B2\nC') // below a line with children is its first child
    usePad.setState({ selection: [], editing: null })
    const before = shown()
    cmdAddAbove()
    cmdAddBelow()
    expect(shown()).toBe(before) // nothing targeted, nothing added
  })

  it('Backspace at the start joins with the line above, or removes an empty line', () => {
    cmdBackspaceAtStart(id('C'))
    expect(shown()).toBe('A\nB\n  B1\n  B2C')
    expect(editing()).toMatchObject({ id: id('B2C'), caret: 2 })
    undo()
    cmdEnter(id('C'), 0) // a blank line above C
    const blank = Object.values(rows()).find((r) => r.text === '')!.id
    cmdBackspaceAtStart(blank)
    expect(shown()).toBe('A\nB\n  B1\n  B2\nC')
    expect(editing()).toMatchObject({ id: id('B2'), caret: 'end' })
    cmdBackspaceAtStart('missing') // a row that is gone: no throw
    cmdBackspaceAtStart(id('A'))   // the first line has nothing above it
    expect(shown()).toBe('A\nB\n  B1\n  B2\nC')
  })

  it('an empty line with children is not removed by Backspace', () => {
    const b = id('B')
    edit(b)
    cmdTextChanged(b, '')
    cmdBackspaceAtStart(b)
    expect(shown()).toBe('A\n\n  B1\n  B2\nC')
  })

  it('indent, outdent, move, fold, ungroup, numbered and line type act on the targets', () => {
    sel('C')
    cmdIndent()
    expect(shown()).toBe('A\nB\n  B1\n  B2\n  C')
    cmdDedent()
    expect(shown()).toBe('A\nB\n  B1\n  B2\nC')
    cmdMove('up')
    expect(shown()).toBe('A\nC\nB\n  B1\n  B2')
    cmdMove('down')
    sel('B')
    cmdToggleCollapsed()
    expect(rows()[id('B')]!.collapsed).toBe(true)
    cmdToggleCollapsed()
    cmdToggleNumbered()
    expect(shown()).toBe('A\n1.B\n  B1\n  B2\nC')
    cmdSetKind('header')
    expect(shown()).toBe('A\n#B\n  B1\n  B2\nC')
    cmdSetKind('plain')
    cmdUngroup()
    expect(shown()).toBe('A\nB\nB1\nB2\nC')
    // With nothing targeted every one of them is a no-op.
    usePad.setState({ selection: [], editing: null })
    const depth = usePad.getState().past.length
    cmdIndent(); cmdDedent(); cmdMove('up'); cmdToggleCollapsed(); cmdToggleNumbered(); cmdSetKind('header'); cmdUngroup(); cmdDeleteSelection()
    expect(usePad.getState().past).toHaveLength(depth)
  })

  it('deleting lands on the line that takes the place; deleting everything leaves one blank line', () => {
    sel('B')
    cmdDeleteSelection()
    expect(shown()).toBe('A\nC')
    expect(usePad.getState().selection).toEqual([id('C')])
    sel('C')
    cmdDeleteSelection()
    expect(usePad.getState().selection).toEqual([id('A')])
    sel('A')
    cmdDeleteSelection()
    expect(shown()).toBe('')
    expect(Object.keys(rows())).toHaveLength(1)
  })

  it('copy: one line is bare text, several are a dashed outline with an HTML list; cut also deletes', async () => {
    const got: { text: string; html: string | undefined }[] = []
    setClipboard(async (text, html) => { got.push({ text, html }); return true })
    expect(copyPayload(rows(), [id('A')])).toEqual({ text: 'A' })
    sel('B')
    expect(cmdCopySelection()).toBe('- B\n  - B1\n  - B2')
    expect(got[0]!.html).toContain('<ul>')
    sel('A')
    cmdCutSelection()
    expect(got[1]).toEqual({ text: 'A', html: undefined })
    expect(shown()).toBe('B\n  B1\n  B2\nC')
    setClipboard(async () => false)
  })

  it('pasting several lines into a line adds them after it, and replaces it when it was empty', () => {
    expect(cmdPasteInto(id('A'), 'one line')).toBe(false)
    expect(cmdPasteInto(id('A'), 'x\n\ty')).toBe(true)
    expect(shown()).toBe('A\nx\n  y\nB\n  B1\n  B2\nC')
    expect(editing()).toMatchObject({ id: id('y'), caret: 'end' })
    cmdEnter(id('C'), 0)
    const blank = Object.values(rows()).find((r) => r.text === '')!.id
    cmdPasteInto(blank, 'p\nq')
    expect(shown()).toBe('A\nx\n  y\nB\n  B1\n  B2\np\nq\nC')
    expect(cmdPasteInto(id('A'), '\n  \n')).toBe(false) // nothing but blank lines
  })

  it('a native input reporting its text: typing sets it, one newline is Enter, several are a paste', () => {
    const a = id('A')
    expect(cmdTextChanged(a, 'Ax')).toBe('Ax')
    expect(shown()).toBe('Ax\nB\n  B1\n  B2\nC')
    expect(cmdTextChanged(a, 'A\nx')).toBe('Ax')
    expect(shown()).toBe('A\nx\nB\n  B1\n  B2\nC')
    expect(cmdTextChanged(id('C'), 'C\none\ntwo')).toBe('C')
    expect(shown()).toBe('A\nx\nB\n  B1\n  B2\nC\none\ntwo')
  })

  it('paste with lines selected goes after the selection; with none, to the bottom', () => {
    sel('A')
    cmdPasteAfterSelection('p\n\tq')
    expect(shown()).toBe('A\np\n  q\nB\n  B1\n  B2\nC')
    expect(usePad.getState().selection).toEqual([id('p'), id('q')])
    usePad.setState({ selection: [] })
    cmdPasteAfterSelection('end')
    expect(shown().endsWith('C\nend')).toBe(true)
    cmdPasteAfterSelection('   ')
    expect(shown().endsWith('C\nend')).toBe(true)
  })

  it('clicking below the last line reuses an empty last line or adds one', () => {
    cmdAppendAtEnd()
    expect(shown()).toBe('A\nB\n  B1\n  B2\nC\n')
    const blank = editing()!.id
    usePad.setState({ editing: null })
    cmdAppendAtEnd()
    expect(editing()).toMatchObject({ id: blank, caret: 'end' })
    expect(Object.keys(rows())).toHaveLength(6)
  })

  it('arrow past the edge of a line edits its neighbour, caret at the near end', () => {
    cmdEditNeighbor(id('B'), 1)
    expect(editing()).toMatchObject({ id: id('B1'), caret: 0 })
    cmdEditNeighbor(id('B'), -1)
    expect(editing()).toMatchObject({ id: id('A'), caret: 'end' })
    cmdEditNeighbor(id('A'), -1)
    expect(editing()!.id).toBe(id('A'))
  })

  it('the floating + opens a blank line at the very top and edits it, one undo step', () => {
    const top = cmdAddAtTop()
    expect(shown()).toBe('\nA\nB\n  B1\n  B2\nC')
    expect(editing()).toMatchObject({ id: top, caret: 0 })
    expect(usePad.getState().selection).toEqual([])
    undo()
    expect(shown()).toBe('A\nB\n  B1\n  B2\nC')
  })
})
