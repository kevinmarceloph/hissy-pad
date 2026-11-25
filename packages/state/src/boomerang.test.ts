import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dayStartAt, idOf } from '@hissypad/core'
import {
  boomerangChoices, boomerangList, cmdApplyBoomerang, cmdBoomerang, cmdClearFresh, cmdComeBack, cmdPickBoomerang, deliverBoomerangs,
  setBoomerangPickerOpener, stopBoomerangTimer, targetDue,
} from './boomerang'
import { cmdSetText, cmdToggleDone } from './commands'
import { undo } from './history'
import { openHours, resetHours } from './hours'
import { edit, select } from './selection'
import { loadPad, usePad } from './store'
import { resetStore, tableShape } from './testing'
import { LINE_ACTIONS } from './actions'

const id = (text: string) => idOf(usePad.getState().all, text)

beforeEach(async () => {
  resetHours()
  resetStore('A\n  a1\nB\nC')
  await loadPad()
})
afterEach(() => {
  stopBoomerangTimer()
  setBoomerangPickerOpener(null)
})

describe('boomerang commands', () => {
  it('sends the selection out of the pad, and undo brings it back', () => {
    select([id('A')], id('A'))
    expect(cmdBoomerang('2026-12-01')).toBe(1)
    expect(tableShape()).toBe('B\nC\n>2026-12-01 A')
    expect(usePad.getState().selection).toEqual([])
    undo()
    expect(tableShape()).toBe('A\n  a1\nB\nC')
  })

  it('ends the edit of a line that left', () => {
    edit(id('B'))
    cmdBoomerang('2026-12-01')
    expect(usePad.getState().editing).toBeNull()
  })

  it('is a floating action that opens the picker with the lines, and the answer says what it did', () => {
    const action = LINE_ACTIONS.find((a) => a.id === 'boomerang')!
    expect(action.floats && action.icon).toBe('boomerang')
    let asked: readonly string[] = []
    setBoomerangPickerOpener((ids) => { asked = ids })
    select([id('B'), id('C')], id('B'))
    cmdPickBoomerang()
    expect(asked).toEqual([id('B'), id('C')])
    expect(cmdApplyBoomerang('2026-11-26', '2026-11-25')).toBe('2 lines are out until tomorrow.')
    expect(boomerangList().map((g) => g.lines.map((r) => r.text))).toEqual([['B', 'C']])
    expect(targetDue([id('B'), id('C')])).toBe('2026-11-26')
  })

  it('the picker\'s Back now brings the lines it was opened for back', () => {
    setBoomerangPickerOpener(() => {})
    cmdBoomerang('2026-12-01', [id('C')])
    cmdPickBoomerang([id('C')])
    expect(cmdApplyBoomerang(null, '2026-11-25')).toBe('Back in the Inbox.')
    expect(tableShape()).toBe('C\nA\n  a1\nB')
  })

  it('comes back by hand', () => {
    cmdBoomerang('2026-12-01', [id('C')])
    expect(cmdComeBack([id('C')])).toBe(1)
    expect(tableShape()).toBe('C\nA\n  a1\nB')
  })

  it('offers days counted from today', () => {
    // 2026-11-25 is a Wednesday.
    expect(boomerangChoices('2026-11-25').map((c) => c.due)).toEqual(['2026-11-26', '2026-11-28', '2026-11-30', '2026-12-25'])
    // A Sunday's next Monday is not tomorrow.
    expect(boomerangChoices('2026-11-29')[2]!.due).toBe('2026-12-07')
  })
})

describe('delivery', () => {
  it('brings back what is due once its day has started, by the day start, with a dot and no undo step', async () => {
    const stores = await openHours()
    stores.day.getState().adoptStart(6)
    cmdBoomerang('2026-12-01', [id('B')])
    const undoDepth = usePad.getState().past.length
    // 5am on the day: with a day that starts at 6 it is still the day before.
    expect(await deliverBoomerangs(new Date(2026, 11, 1, 5))).toBe(0)
    expect(await deliverBoomerangs(new Date(2026, 11, 1, 6))).toBe(1)
    expect(tableShape()).toBe('*B\nA\n  a1\nC')
    expect(usePad.getState().past.length).toBe(undoDepth)
    expect(usePad.getState().all[id('B')]!.updatedAt).toBe(dayStartAt('2026-12-01', 6).toISOString())
  })

  it('the dot goes when the line is touched, or pressed', async () => {
    cmdBoomerang('2026-12-01', [id('B'), id('C')])
    await deliverBoomerangs(new Date(2026, 11, 2, 12))
    expect(tableShape()).toBe('*B\n*C\nA\n  a1')
    edit(id('B'))
    cmdSetText(id('B'), 'B!')
    cmdClearFresh(id('C'))
    expect(tableShape()).toBe('B!\nC\nA\n  a1')
  })

  it('crossing it out counts as touching it', async () => {
    cmdBoomerang('2026-12-01', [id('B')])
    await deliverBoomerangs(new Date(2026, 11, 2, 12))
    select([id('B')], id('B'))
    cmdToggleDone()
    expect(usePad.getState().all[id('B')]!.fresh).toBe(false)
  })
})
