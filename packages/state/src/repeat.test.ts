import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findFixedPad, FOREVER, idOf, parseRepeat } from '@hissypad/core'
import { cmdComeBack, cmdPickBoomerang, deliverBoomerangs, setBoomerangPickerOpener, stopBoomerangTimer, targetDue } from './boomerang'
import { cmdMoveToPad } from './pads'
import { cmdToggleDone } from './commands'
import { undo } from './history'
import { resetHours } from './hours'
import { cmdApplySlot, cmdPickSlot, cmdSetSlot, setSlotPickerOpener, slotPickerLines, targetSlot } from './hours/slots'
import { cmdMakeRepeat, cmdOpenTemplate, cmdSetRepeat, cmdStopRepeat, cmdUnlinkRepeat, repeatMark, repeatOf, repeatWords } from './repeat'
import { select } from './selection'
import { loadPad, openPad, usePad } from './store'
import { resetStore, tableShape } from './testing'

const all = () => usePad.getState().all
const id = (text: string) => idOf(all(), text)
const later = () => findFixedPad(all(), 'Later')!.id
// Tuesday 2026-12-01, 10am.
const NOW = new Date(2026, 11, 1, 10)
const weekly = { mode: 'every', n: 1, unit: 'w', keep: 'reuse' } as const

beforeEach(async () => {
  resetHours()
  resetStore('A\n  a1\nB')
  await loadPad()
})
afterEach(() => {
  stopBoomerangTimer()
  setBoomerangPickerOpener(null)
  setSlotPickerOpener(null)
})

describe('recurring items', () => {
  it('makes a line recurring: a template under Later, the line its first instance, one undo step', () => {
    const a = id('A')
    const t = cmdMakeRepeat(a, weekly, NOW)
    expect(tableShape()).toBe(`A\n  a1\nB\n>${FOREVER} A`)
    expect(all()[t]!.parentId).toBe(later())
    expect(repeatOf(a)).toMatchObject({ role: 'instance', templateId: t })
    expect(repeatOf(t)?.role).toBe('template')
    expect(repeatWords(t, NOW)).toBe('Every week, next Tue, Dec 8')
    expect(repeatMark(all(), t, NOW)).toBe('↻ Every week, next Tue, Dec 8')
    expect(repeatMark(all(), a, NOW)).toBe('↻')
    expect(repeatMark(all(), id('B'), NOW)).toBe('')
    undo()
    expect(tableShape()).toBe('A\n  a1\nB')
    expect(repeatOf(a)).toBeNull()
  })

  it('changes the rule from an instance, and stops from the template', () => {
    const a = id('A')
    const t = cmdMakeRepeat(a, weekly, NOW)
    cmdSetRepeat(a, { mode: 'every', n: 3, unit: 'd', keep: 'add' }, NOW)
    expect(parseRepeat(all()[t]!.repeat)).toMatchObject({ n: 3, unit: 'd', keep: 'add', next: '2026-12-04' })
    cmdStopRepeat(t)
    expect(tableShape()).toBe('A\n  a1\nB\n@Later\n  A\n    a1')
    expect(repeatOf(a)).toBeNull()
    expect(repeatMark(all(), a, NOW)).toBe('')
  })

  it('unlinks an instance and goes to the template', () => {
    const a = id('A')
    const t = cmdMakeRepeat(a, weekly, NOW)
    expect(cmdOpenTemplate(a)).toBe(true)
    expect(usePad.getState().padId).toBe(later())
    expect(usePad.getState().selection).toEqual([t])
    cmdUnlinkRepeat([a], NOW)
    expect(repeatOf(a)).toBeNull()
    expect(cmdOpenTemplate(a)).toBe(false)
    expect(repeatOf(t)?.role).toBe('template')
  })

  it('makes the next instance when its day starts, outside undo, once', async () => {
    const a = id('A')
    const t = cmdMakeRepeat(a, weekly, NOW)
    select([a], a)
    cmdToggleDone()
    const depth = usePad.getState().past.length
    await deliverBoomerangs(new Date(2026, 11, 7, 23))
    expect(tableShape()).toBe(`~A\n  a1\nB\n>${FOREVER} A`)
    await deliverBoomerangs(new Date(2026, 11, 8, 0, 1))
    expect(tableShape()).toBe(`~A\n  a1\nB\n@Today\n  *A\n    a1\n>${FOREVER} A`)
    expect(usePad.getState().past.length).toBe(depth)
    expect(parseRepeat(all()[t]!.repeat)!.next).toBe('2026-12-15')
    await deliverBoomerangs(new Date(2026, 11, 8, 9))
    expect(tableShape()).toBe(`~A\n  a1\nB\n@Today\n  *A\n    a1\n>${FOREVER} A`)
  })

  it('a template dragged out of Later, or called back, is an ordinary line again', () => {
    const t = cmdMakeRepeat(id('A'), weekly, NOW)
    openPad(later())
    select([t], t)
    cmdMoveToPad(null)
    expect([all()[t]!.repeat, all()[t]!.due]).toEqual([null, null])
    // The move left Later empty, so a blank line was made for it: a step of its own.
    while (all()[t]!.repeat === null && usePad.getState().past.length) undo()
    expect(repeatOf(t)?.role).toBe('template')
    expect(cmdComeBack([t])).toBe(1)
    expect(tableShape()).toBe('A\n  a1\nB\n@Later\n  A\n    a1')
  })

  it('the hour picker on a template sets the hours of its instances, and the day picker opens on no day', () => {
    const a = id('A')
    const t = cmdMakeRepeat(a, weekly, NOW)
    cmdSetSlot('2020-01-01T09', [t])
    expect(all()[t]!.slot).toBeNull()
    expect(targetSlot([t])).toBe('2026-12-08T09')
    expect(targetDue([t])).toBeNull()
    let opened: readonly string[] = []
    setSlotPickerOpener((ids) => (opened = ids))
    cmdPickSlot([t])
    expect(opened).toEqual([t])
    expect(slotPickerLines()).toEqual([t])
    cmdApplySlot(null)
    expect(targetSlot([t])).toBeNull()
    setBoomerangPickerOpener(() => {})
    cmdPickBoomerang([t])
  })
})
