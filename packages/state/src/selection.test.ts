import { beforeEach, describe, expect, it } from 'vitest'
import { idOf } from '@hissypad/core'
import { loadPad, usePad } from './store'
import { clearSelection, clickSelect, edit, neighbor, paintSelect, select, selectAll, selectRange, stepSelection, stopEditing, targets, visibleIds } from './selection'
import { cmdToggleCollapsed } from './commands'
import { resetStore } from './testing'

const id = (text: string) => idOf(usePad.getState().rows, text)
const picked = () => usePad.getState().selection.map((i) => usePad.getState().rows[i]!.text)
const plain = { shift: false, meta: false }

describe('selection and editing', () => {
  beforeEach(async () => {
    resetStore('A\nB\n  B1\n  B2\nC')
    await loadPad()
  })

  it('a tap selects one line; once something is selected a tap toggles; shift ranges from the anchor', () => {
    clickSelect(id('A'), plain)
    expect(picked()).toEqual(['A'])
    clickSelect(id('C'), plain)
    expect(picked()).toEqual(['A', 'C'])
    clickSelect(id('A'), plain)
    expect(picked()).toEqual(['C'])
    clickSelect(id('B'), { shift: true, meta: false })
    expect(picked()).toEqual(['B', 'B1', 'B2', 'C'])
    clearSelection()
    clickSelect(id('B1'), { shift: false, meta: true })
    expect(picked()).toEqual(['B1'])
  })

  it('a swipe down the bullets adds the lines it passes to what was selected, and drawn back takes them off', () => {
    select([id('A')], id('A'))
    const base = usePad.getState().selection
    paintSelect(base, id('B1'), id('C'))
    expect(picked()).toEqual(['A', 'B1', 'B2', 'C'])
    paintSelect(base, id('B1'), id('B2'))
    expect(picked()).toEqual(['A', 'B1', 'B2'])
    paintSelect(base, id('B1'), id('B'))
    expect(picked()).toEqual(['A', 'B', 'B1'])
  })

  it('selection is kept in visible order and skips lines that are not on screen', () => {
    select([id('C'), id('A'), id('A'), 'missing'], id('C'))
    expect(picked()).toEqual(['A', 'C'])
    select([id('B')], id('B'))
    cmdToggleCollapsed()
    expect(visibleIds().map((i) => usePad.getState().rows[i]!.text)).toEqual(['A', 'B', 'C'])
    selectAll()
    expect(picked()).toEqual(['A', 'B', 'C'])
    selectRange('missing', id('C')) // an anchor that is gone: just the focus
    expect(picked()).toEqual(['C'])
  })

  it('arrow keys step the selection and Shift extends it, stopping at the ends', () => {
    select([id('A')], id('A'))
    stepSelection(1, false)
    expect(picked()).toEqual(['B'])
    stepSelection(1, true)
    stepSelection(1, true)
    expect(picked()).toEqual(['B', 'B1', 'B2'])
    stepSelection(-1, true)
    expect(picked()).toEqual(['B', 'B1'])
    select([id('C')], id('C'))
    stepSelection(1, false)
    expect(picked()).toEqual(['C'])
    clearSelection()
    stepSelection(1, false) // nothing selected: starts from the top
    expect(picked()).toEqual(['A'])
  })

  it('editing clears the selection, and the targets are the selection or else the edited line', () => {
    select([id('A'), id('B')], id('A'))
    expect(targets()).toEqual([id('A'), id('B')])
    edit(id('C'), 1)
    expect(usePad.getState().selection).toEqual([])
    expect(usePad.getState().editing).toMatchObject({ id: id('C'), caret: 1 })
    expect(targets()).toEqual([id('C')])
    const rev = usePad.getState().editing!.rev
    edit(id('C'))
    expect(usePad.getState().editing).toMatchObject({ caret: 'end', rev: rev + 1 })
    stopEditing()
    expect(targets()).toEqual([])
    expect(neighbor(id('A'), 1)).toBe(id('B'))
    expect(neighbor(id('A'), -1)).toBeNull()
    expect(neighbor('missing', 1)).toBeNull()
  })
})
