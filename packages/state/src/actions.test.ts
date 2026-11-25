import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, pad, shape } from '@hissypad/core'
import { loadPad, usePad } from './store'
import { select } from './selection'
import { actionFace, LINE_ACTIONS, LINE_KINDS, lineAbilities, lineCount } from './actions'
import { cmdCopySelection, setClipboard, setClipboardProbe, setClipboardReader, useClipboard } from './commands'
import { padList } from './pads'
import { resetStore } from './testing'

const action = (id: string) => LINE_ACTIONS.find((a) => a.id === id)!

describe('line abilities', () => {
  const rows = pad('A\nB\n  B1\n  B2\nC')
  const can = (...texts: string[]) => lineAbilities(rows, texts.map((t) => idOf(rows, t)))

  it('says what the targets allow', () => {
    expect(can('A')).toEqual({ indent: false, dedent: false, up: false, down: true, children: false, folded: false, single: true, mixed: false, hour: false, pads: true, pin: true, pinned: false, paste: true })
    expect(can('B')).toMatchObject({ indent: true, up: true, down: true, children: true, dedent: false })
    expect(can('B1')).toMatchObject({ indent: false, dedent: true, up: false, down: true })
    expect(can('C')).toMatchObject({ indent: true, up: true, down: false })
  })
  it('a line with its own child is still one line; two siblings are not', () => {
    expect(can('B', 'B1').single).toBe(true)
    expect(can('A', 'B').single).toBe(false)
    expect(can('A', 'B', 'C')).toMatchObject({ indent: false, up: false, down: false }) // every sibling selected
    expect(lineAbilities(rows, [])).toEqual({ indent: false, dedent: false, up: false, down: false, children: false, folded: false, single: false, mixed: false, hour: false, pads: true, pin: false, pinned: false, paste: true })
  })

  it('a target that is not among the rows is passed over (a line just archived out of an open hour)', () => {
    expect(lineAbilities(rows, ['gone'])).toEqual(lineAbilities(rows, []))
    expect(lineAbilities(rows, ['gone', idOf(rows, 'B')])).toEqual(can('B'))
  })
})

describe('split off open', () => {
  it('moves the open sub items to a copy below and selects it; only enabled with both kinds', async () => {
    resetStore('A\nB\n  B1\n  B2\nC')
    await loadPad()
    const rows = () => usePad.getState().rows
    const can = () => lineAbilities(rows(), usePad.getState().selection)
    select([idOf(rows(), 'B')], idOf(rows(), 'B'))
    expect(action('splitOpen').enabled!(can())).toBe(false)
    select([idOf(rows(), 'B1')], idOf(rows(), 'B1'))
    action('done').run()
    select([idOf(rows(), 'B')], idOf(rows(), 'B'))
    expect(action('splitOpen').enabled!(can())).toBe(true)
    expect(action('splitOpen').run()).toBeUndefined()
    expect(shape(rows())).toBe('A\nB\n  ~B1\nB\n  B2\nC')
    const sel = usePad.getState().selection
    expect(sel).toHaveLength(1)
    expect(rows()[sel[0]!]!.parentId).toBeNull()
    expect(sel[0]).not.toBe(idOf(rows(), 'B'))
    expect(action('splitOpen').run()).toMatch(/Nothing to split/)
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

  it('Bottom puts the line last at its level; off when it is already there', () => {
    pick('A')
    expect(action('bottom').enabled!(lineAbilities(usePad.getState().rows, usePad.getState().selection))).toBe(true)
    action('bottom').run()
    expect(shown()).toBe('B\n  B1\nC\nA')
    expect(action('bottom').enabled!(lineAbilities(usePad.getState().rows, usePad.getState().selection))).toBe(false)
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

  it('Paste is off while a platform that can tell says the clipboard holds no text; a copy turns it back on', async () => {
    const on = () => action('pasteAbove').enabled!(lineAbilities(usePad.getState().rows, usePad.getState().selection))
    pick('A')
    expect(on()).toBe(true) // no probe (the web): always on
    let has = false
    setClipboardProbe(async () => has)
    await Promise.resolve(); await Promise.resolve()
    expect(useClipboard.getState().hasText).toBe(false)
    expect(on()).toBe(false)
    expect(action('pasteBelow').enabled!(lineAbilities(usePad.getState().rows, usePad.getState().selection))).toBe(false)
    cmdCopySelection()
    expect(on()).toBe(true)
    setClipboardProbe(async () => { throw new Error('no') })
    await Promise.resolve(); await Promise.resolve()
    expect(on()).toBe(true) // could not tell: on
    has = false
    setClipboardProbe(null)
    expect(on()).toBe(true)
  })

  it('Make pad says what it did, and is off for more than one line', () => {
    pick('B')
    expect(action('makePad').enabled!(lineAbilities(usePad.getState().rows, usePad.getState().selection))).toBe(true)
    expect(action('makePad').run()).toBe('“B” is a pad now.')
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'B'])
    usePad.setState({ selection: [] })
    expect(action('makePad').run()).toBeUndefined()
  })

  it('Pin puts the line at the very top and reads Unpin; Top and a drag then stop under the pins', async () => {
    const can = () => lineAbilities(usePad.getState().rows, usePad.getState().selection)
    pick('B1')
    expect(can()).toMatchObject({ pin: false, pads: true })
    pick('C')
    expect(actionFace(action('pin'), can())).toMatchObject({ name: 'Pin to top' })
    action('pin').run()
    expect(shown()).toBe('^C\nA\nB\n  B1')
    expect(actionFace(action('pin'), can())).toMatchObject({ name: 'Unpin' })
    // The first line under the pins is already at the top of its area.
    pick('A')
    expect(can()).toMatchObject({ up: false })
    expect(action('top').enabled!(can())).toBe(false)
    pick('B')
    action('top').run()
    expect(shown()).toBe('^C\nB\n  B1\nA')
    // An outdent out of a pin lands under the divider, not pinned.
    pick('B')
    action('pin').run()
    expect(shown()).toBe('^B\n  B1\n^C\nA')
    pick('B1')
    action('dedent').run()
    expect(shown()).toBe('^B\n^C\nB1\nA')
    pick('B')
    action('pin').run()
    expect(shown()).toBe('^C\nB\nB1\nA')
  })

  it('Pin is not offered in a zoomed line', () => {
    usePad.setState({ zoomId: idOf(usePad.getState().rows, 'B') })
    expect(lineAbilities(usePad.getState().rows, []).pads).toBe(false)
    usePad.setState({ zoomId: null })
  })

  it('counts lines in words', () => {
    expect([lineCount(1), lineCount(2), lineCount(0)]).toEqual(['1 line', '2 lines', '0 lines'])
  })
})
