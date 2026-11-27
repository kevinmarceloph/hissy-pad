import { beforeEach, describe, expect, it } from 'vitest'
import { findFixedPad, idOf, insertAt, setSlot, shape, slotKey, togglePinned, unscheduledCount } from '@hissypad/core'

import { resetStore, tableShape } from './testing'
import { apply, applyAll, closePart, loadPad, openPad, openPart, openSlot, usePad } from './store'
import { undo } from './history'
import { cmdAppendAtEnd, cmdEnter, cmdSetText } from './commands'
import { edit } from './selection'

const H9 = slotKey('2026-11-25', 9)
const H14 = slotKey('2026-11-25', 14)
const all = () => usePad.getState().all
const view = () => shape(usePad.getState().rows)
const id = (text: string) => idOf(all(), text)
const today = () => findFixedPad(all(), 'Today')!.id

// The Inbox holds A. Today holds P (pinned), T and U of its own, then N (9am) and M (2pm).
beforeEach(async () => {
  resetStore('A')
  await loadPad()
  applyAll((rows, ctx) => {
    let out = rows
    let after: string | null = null
    for (const text of ['P', 'T', 'U', 'M', 'N']) {
      const made = insertAt(out, ctx, { parentId: today(), afterId: after }, text)
      out = made.rows
      after = made.newId
    }
    out = setSlot(out, ctx, [idOf(out, 'M')], H14)
    return setSlot(out, ctx, [idOf(out, 'N')], H9)
  })
  // Pinned as the pad does it, in Today's own view.
  openPad(today())
  apply((rows, ctx) => togglePinned(rows, ctx, [idOf(rows, 'P')]))
  openPad(null)
})

describe('Today\'s two sections as views of the store', () => {
  it('shows Today\'s own lines, pins included, or its lines with an hour in hour order', () => {
    openPart('own')
    expect(view()).toBe('^P\nT\nU')
    openPart('scheduled')
    expect(view()).toBe('N\nM')
    // The pad open in the Pads tab is left as it was, and is back when the part closes.
    expect(usePad.getState().padId).toBeNull()
    closePart()
    expect(view()).toBe('A')
  })

  it('counts the lines waiting for an hour: not the pins, not the done ones', () => {
    expect(unscheduledCount(all())).toBe(2)
    applyAll((rows, ctx) => setSlot(rows, ctx, [id('U')], H9))
    expect(unscheduledCount(all())).toBe(1)
  })

  it('writes an edit back under Today, and a new line at the end stays unscheduled', () => {
    openPart('own')
    cmdAppendAtEnd()
    const made = usePad.getState().editing!.id
    cmdSetText(made, 'V')
    expect(all()[made]).toMatchObject({ parentId: today(), slot: null })
    expect(view()).toBe('^P\nT\nU\nV')
    // In Today it sits at the end of the pad's own lines, above the ones with an hour.
    expect(tableShape()).toContain('@Today\n  ^P\n  T\n  U\n  V\n  N\n  M')
    undo()
  })

  it('gives a line made in the schedule the hour of the line above it', () => {
    openPart('scheduled')
    edit(id('N'), 'end')
    cmdEnter(id('N'), 1)
    const made = usePad.getState().editing!.id
    cmdSetText(made, 'N2')
    expect(all()[made]).toMatchObject({ parentId: today(), slot: H9 })
    expect(view()).toBe('N\nN2\nM')
  })

  it('moves a line to the other part when it gets an hour or loses it', () => {
    openPart('own')
    applyAll((rows, ctx) => setSlot(rows, ctx, [id('T')], H14))
    expect(view()).toBe('^P\nU')
    openPart('scheduled')
    // Lines in the same hour keep the order the pad has them in.
    expect(view()).toBe('N\nT\nM')
  })

  it('gives way to an open hour and to a pad, and comes back after the hour', () => {
    openPart('own')
    openSlot(H9)
    expect(view()).toBe('N')
    openSlot(null)
    expect(view()).toBe('^P\nT\nU')
    openPad(today())
    expect(usePad.getState().partId).toBeNull()
  })
})
