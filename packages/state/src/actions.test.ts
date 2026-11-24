import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, pad, shape } from '@hissypad/core'
import { loadPad, usePad } from './store'
import { select } from './selection'
import { actionFace, LINE_ACTIONS, LINE_KINDS, lineAbilities, lineCount } from './actions'
import { setClipboard, setClipboardReader } from './commands'
import { padList } from './pads'
import { resetStore } from './testing'

const action = (id: string) => LINE_ACTIONS.find((a) => a.id === id)!

describe('line abilities', () => {
  const rows = pad('A\nB\n  B1\n  B2\nC')
  const can = (...texts: string[]) => lineAbilities(rows, texts.map((t) => idOf(rows, t)))

  it('says what the targets allow', () => {
    expect(can('A')).toEqual({ indent: false, dedent: false, up: false, down: true, children: false, folded: false, single: true })
    expect(can('B')).toMatchObject({ indent: true, up: true, down: true, children: true, dedent: false })
    expect(can('B1')).toMatchObject({ indent: false, dedent: true, up: false, down: true })
    expect(can('C')).toMatchObject({ indent: true, up: true, down: false })
  })
  it('a line with its own child is still one line; two siblings are not', () => {
    expect(can('B', 'B1').single).toBe(true)
    expect(can('A', 'B').single).toBe(false)
    expect(can('A', 'B', 'C')).toMatchObject({ indent: false, up: false, down: false }) // every sibling selected
    expect(lineAbilities(rows, [])).toEqual({ indent: false, dedent: false, up: false, down: false, children: false, folded: false, single: false })
  })
})

describe('the toolbar registry', () => {
  beforeEach(async () => {
    resetStore('A\nB\n  B1\nC')
    await loadPad()
  })
  const shown = () => shape(usePad.getState().rows)
  const pick = (text: string) => { const id = idOf(usePad.getState().rows, text); select([id], id) }

  it('ids are unique, groups are contiguous, and every action has a name and a hint', () => {
    expect(new Set(LINE_ACTIONS.map((a) => a.id)).size).toBe(LINE_ACTIONS.length)
    const groups = LINE_ACTIONS.map((a) => a.group).filter((g, i, all) => g !== all[i - 1])
    expect(new Set(groups).size).toBe(groups.length)
    expect(groups[0]).toBe('mark')
    for (const a of LINE_ACTIONS) expect(a.name && a.hint && a.label).toBeTruthy()
    expect(LINE_KINDS.map((k) => k.kind)).toEqual(['plain', 'header', 'numbered'])
  })

  it('each action runs its command on the selection', () => {
    pick('C')
    action('indent').run()
    expect(shown()).toBe('A\nB\n  B1\n  C')
    action('dedent').run()
    action('up').run()
    expect(shown()).toBe('A\nC\nB\n  B1')
    action('down').run()
    action('done').run()
    expect(shown()).toBe('A\nB\n  B1\n~C')
    action('addAbove').run()
    expect(shown()).toBe('A\nB\n  B1\n\n~C')
    pick('B')
    action('fold').run()
    expect(usePad.getState().rows[idOf(usePad.getState().rows, 'B')]!.collapsed).toBe(true)
    action('ungroup').run()
    expect(shown()).toBe('A\nB\nB1\n\n~C')
    pick('A')
    action('addBelow').run()
    pick('A')
    action('copy').run()
    action('delete').run()
    expect(shown()).toBe('\nB\nB1\n\n~C')
  })

  it('Fold reads Unfold once every target with sub items is folded, and then opens them', () => {
    const can = () => lineAbilities(usePad.getState().rows, usePad.getState().selection)
    pick('B')
    expect(actionFace(action('fold'), can())).toMatchObject({ name: 'Fold', icon: 'fold' })
    action('fold').run()
    expect(can().folded).toBe(true)
    expect(actionFace(action('fold'), can())).toMatchObject({ name: 'Unfold', icon: 'unfold' })
    action('fold').run()
    expect(can().folded).toBe(false)
    expect(usePad.getState().rows[idOf(usePad.getState().rows, 'B')]!.collapsed).toBe(false)
  })

  it('Top puts the line first at its level; off when it is already there', () => {
    pick('C')
    expect(action('top').enabled!(lineAbilities(usePad.getState().rows, usePad.getState().selection))).toBe(true)
    action('top').run()
    expect(shown()).toBe('C\nA\nB\n  B1')
    expect(action('top').enabled!(lineAbilities(usePad.getState().rows, usePad.getState().selection))).toBe(false)
  })

  it('Cut copies then deletes; Paste above and below bring the clipboard in as lines beside the selection', async () => {
    let clip = ''
    setClipboard(async (text) => { clip = text; return true })
    setClipboardReader(async () => clip)
    pick('B')
    action('cut').run()
    expect(clip).toBe('- B\n  - B1')
    expect(shown()).toBe('A\nC')
    pick('C')
    expect(await action('pasteAbove').run()).toBeUndefined()
    expect(shown()).toBe('A\nB\n  B1\nC')
    expect(usePad.getState().selection.map((id) => usePad.getState().rows[id]!.text)).toEqual(['B', 'B1'])
    pick('A')
    await action('pasteBelow').run()
    expect(shown()).toBe('A\nB\n  B1\nB\n  B1\nC')
    // Nothing on the clipboard, or no reading it: the action says so and the pad stays.
    setClipboardReader(async () => null)
    pick('A')
    expect(await action('pasteBelow').run()).toMatch(/Nothing to paste/)
    expect(shown()).toBe('A\nB\n  B1\nB\n  B1\nC')
    setClipboard(async () => false)
    setClipboardReader(async () => null)
  })

  it('Make pad says what it did, and is off for more than one line', () => {
    pick('B')
    expect(action('makePad').enabled!(lineAbilities(usePad.getState().rows, usePad.getState().selection))).toBe(true)
    expect(action('makePad').run()).toBe('“B” is a pad now.')
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'B'])
    usePad.setState({ selection: [] })
    expect(action('makePad').run()).toBeUndefined()
  })

  it('counts lines in words', () => {
    expect([lineCount(1), lineCount(2), lineCount(0)]).toEqual(['1 line', '2 lines', '0 lines'])
  })
})
