import { describe, expect, it } from 'vitest'
import { hourPrefix, slotByPrefix } from './hourprefix'
import { idOf, pad, testCtx } from './testing'

const DAY = '2026-11-27'

describe('hourPrefix', () => {
  it('reads an hour, a range and a range sharing its am or pm, and eats them from the text', () => {
    expect(hourPrefix('3pm call mom', DAY, 0)).toEqual({ slot: '2026-11-27T15', text: 'call mom' })
    expect(hourPrefix('3pm-5pm write', DAY, 0)).toEqual({ slot: '2026-11-27T15+2', text: 'write' })
    expect(hourPrefix('10-11pm read', DAY, 0)).toEqual({ slot: '2026-11-27T22', text: 'read' })
    expect(hourPrefix('9am - 12pm deep work', DAY, 0)).toEqual({ slot: '2026-11-27T09+3', text: 'deep work' })
    expect(hourPrefix('10:00 AM standup', DAY, 0)).toEqual({ slot: '2026-11-27T10', text: 'standup' })
    // The start borrows the other half of the day when the same one would run the long way.
    expect(hourPrefix('11-1pm lunch', DAY, 0)).toEqual({ slot: '2026-11-27T11+2', text: 'lunch' })
    expect(hourPrefix('12-1pm lunch', DAY, 0)).toEqual({ slot: '2026-11-27T12', text: 'lunch' })
  })

  it('leaves what is not an hour', () => {
    for (const t of ['3 apples', '3:00 call', '3:30pm call', '13pm x', '0am x', '3pm', '10-11 x', '3pm-3pm x', 'call at 3pm']) {
      expect(hourPrefix(t, DAY, 0)).toBeNull()
    }
  })

  it('places the hours in the day on screen, which starts at the day start', () => {
    // Day starts at 6am: 11pm to 1am is tonight into tomorrow, and 2am is the coming night.
    expect(hourPrefix('11pm-1am sleep', DAY, 6)).toEqual({ slot: '2026-11-27T23+2', text: 'sleep' })
    expect(hourPrefix('2am read', DAY, 6)).toEqual({ slot: '2026-11-28T02', text: 'read' })
    expect(hourPrefix('6am run', DAY, 6)).toEqual({ slot: '2026-11-27T06', text: 'run' })
    // From midnight, 11pm-1am still runs into the next calendar day.
    expect(hourPrefix('11pm-1am sleep', DAY, 0)).toEqual({ slot: '2026-11-27T23+2', text: 'sleep' })
    // Across a month end.
    expect(hourPrefix('1am x', '2026-11-30', 6)).toEqual({ slot: '2026-12-01T01', text: 'x' })
  })
})

describe('slotByPrefix', () => {
  it('puts lines in the hour typed in front of them, and leaves the others', () => {
    const ctx = testCtx()
    const rows = pad('3pm call\nplain', ctx)
    const out = slotByPrefix(rows, ctx, Object.keys(rows), DAY, 6)
    expect(out[idOf(rows, '3pm call')]).toMatchObject({ text: 'call', slot: '2026-11-27T15' })
    expect(out[idOf(rows, 'plain')]).toBe(rows[idOf(rows, 'plain')])
  })
})
