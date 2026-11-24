import { resetStore, tableShape } from './testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, shape } from '@hissypad/core'
import { loadPad, openPad, usePad } from './store'
import { undo } from './history'
import { cmdAppendAtEnd, cmdEnter, cmdIndent, cmdSetText } from './commands'
import { cmdNewPad } from './pads'
import { cmdCreateBegin, cmdCreateEnd, cmdCreateItem, cmdCreateMove, cmdCreateOpen, cmdCreateSetText, createDefaultPlace, createPlaceOf } from './create'
import { cmdApplySlot, cmdPickSlot, setSlotPickerOpener } from './hours/slots'

const st = () => usePad.getState()
const id = (text: string) => idOf(st().all, text)

describe('a new item on its card', () => {
  beforeEach(async () => {
    resetStore('A\n  A1\nB')
    await loadPad()
  })

  it('makes the line at the top of the pad shown and zooms into it', () => {
    const depth = cmdCreateBegin()
    const item = cmdCreateItem(createDefaultPlace(), 'N')
    expect(tableShape()).toBe('N\nA\n  A1\nB')
    expect(st().zoomId).toBe(item)
    expect(st().rows).toEqual({})
    cmdCreateSetText(item, 'New')
    expect(cmdCreateEnd(depth, item, true)).toBe(item)
    expect(st().zoomId).toBeNull()
    expect(tableShape()).toBe('New\nA\n  A1\nB')
    expect(shape(st().rows)).toBe('New\nA\n  A1\nB')
  })

  it('edits the sub items with the pad\'s own commands, bounded to the item', () => {
    const depth = cmdCreateBegin()
    const item = cmdCreateItem(createDefaultPlace(), 'N')
    cmdAppendAtEnd()
    cmdSetText(st().editing!.id, 'one')
    cmdEnter(st().editing!.id, 3)
    cmdSetText(st().editing!.id, 'two')
    cmdIndent()
    cmdEnter(st().editing!.id, 3) // a Return after the last one leaves a blank line
    expect(shape(st().rows)).toBe('one\n  two\n  ')
    expect(st().all[id('one')]!.parentId).toBe(item)
    cmdCreateEnd(depth, item, true)
    expect(tableShape()).toBe('N\n  one\n    two\nA\n  A1\nB')
  })

  it('goes to another pad or sub-pad, sub items and all', () => {
    const work = cmdNewPad('Work')
    openPad(null)
    const depth = cmdCreateBegin()
    const item = cmdCreateItem(createDefaultPlace(), 'N')
    cmdAppendAtEnd()
    cmdSetText(st().editing!.id, 'sub')
    cmdCreateMove(item, { padId: work, subId: null })
    expect(createPlaceOf(st().all, item)).toEqual({ padId: work, subId: null })
    expect(shape(st().rows)).toBe('sub') // still zoomed
    cmdCreateEnd(depth, item, true)
    expect(st().padId).toBeNull()
    expect(tableShape()).toContain('@Work\n  N\n    sub')
  })

  it('takes everything back on Cancel, with nothing to redo', () => {
    const before = tableShape()
    const depth = cmdCreateBegin()
    const item = cmdCreateItem(createDefaultPlace(), 'N')
    cmdAppendAtEnd()
    cmdSetText(st().editing!.id, 'sub')
    expect(cmdCreateEnd(depth, item, false)).toBe('')
    expect(tableShape()).toBe(before)
    expect(st().future).toEqual([])
    expect(st().past.length).toBe(depth)
  })

  it('does not keep a line with no words on it or under it', () => {
    const before = tableShape()
    const depth = cmdCreateBegin()
    const item = cmdCreateItem(createDefaultPlace(), '')
    cmdAppendAtEnd()
    expect(cmdCreateEnd(depth, item, true)).toBe('')
    expect(tableShape()).toBe(before)
  })

  it('puts the item in an hour through the picker while zoomed', () => {
    let asked: readonly string[] = []
    setSlotPickerOpener((ids) => { asked = ids })
    const depth = cmdCreateBegin()
    const item = cmdCreateItem(createDefaultPlace(), 'N')
    cmdPickSlot([item])
    expect(asked).toEqual([item])
    cmdApplySlot('2026-11-24T09')
    expect(st().all[item]!.slot).toBe('2026-11-24T09')
    cmdCreateEnd(depth, item, true)
    setSlotPickerOpener(null)
  })

  it('drops the zoom when an undo takes the item away', () => {
    cmdCreateBegin()
    const item = cmdCreateItem(createDefaultPlace(), 'N')
    undo()
    expect(st().zoomId).toBeNull()
    expect(st().all[item]!.deletedAt).not.toBeNull()
    expect(shape(st().rows)).toBe('A\n  A1\nB')
  })

  it('opens the pad at the item from the pad icon', () => {
    const work = cmdNewPad('Work')
    openPad(null)
    const depth = cmdCreateBegin()
    const item = cmdCreateItem({ padId: work, subId: null }, 'N')
    expect(cmdCreateOpen(depth, item)).toBe(true)
    expect(st().padId).toBe(work)
    expect(st().selection).toEqual([item])
    expect(st().reveal?.id).toBe(item)
  })
})
