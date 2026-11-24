import { describe, expect, it } from 'vitest'
import { parseSlot, slotCounts, slotCovers, slotHours, slotKey, slotLabel, slotLines } from './slot'
import type { NodeRow, Rows } from './types'

const row = (id: string, slot: string | null, done = false): NodeRow => ({
  id, parentId: null, rank: id, text: id, done, doneAt: null, collapsed: false, numbered: false, header: false, pad: false,
  slot, category: null, updatedAt: '2026-11-24T00:00:00.000Z', deletedAt: null,
})
const table = (...rs: NodeRow[]): Rows => Object.fromEntries(rs.map((r) => [r.id, r]))

describe('a run of hours', () => {
  it('writes a single hour as before and a run with how many hours', () => {
    expect(slotKey('2026-11-24', 14)).toBe('2026-11-24T14')
    expect(slotKey('2026-11-24', 14, 1)).toBe('2026-11-24T14')
    expect(slotKey('2026-11-24', 14, 3)).toBe('2026-11-24T14+3')
    expect(parseSlot('2026-11-24T14+3')).toEqual({ day: '2026-11-24', hour: 14, hours: 3 })
    expect(parseSlot('2026-11-24T14')).toEqual({ day: '2026-11-24', hour: 14, hours: 1 })
    expect(parseSlot('2026-11-24T14+0')).toBeNull()
    expect(parseSlot('2026-11-24T14+25')).toBeNull()
  })

  it('lists the hours it covers, past midnight and month end', () => {
    expect(slotHours('2026-11-24T14+3')).toEqual(['2026-11-24T14', '2026-11-24T15', '2026-11-24T16'])
    expect(slotHours('2026-11-30T22+3')).toEqual(['2026-11-30T22', '2026-11-30T23', '2026-12-01T00'])
    expect(slotCovers('2026-11-30T22+3', '2026-12-01T00')).toBe(true)
    expect(slotCovers('2026-11-30T22+3', '2026-12-01T01')).toBe(false)
    expect(slotCovers('2026-11-30T22', '2026-11-30T22')).toBe(true)
  })

  it('counts a line in every hour of its run and lists it there', () => {
    const all = table(row('a', '2026-11-24T14+2'), row('b', '2026-11-24T15', true))
    expect(slotCounts(all)).toEqual({
      '2026-11-24T14': { done: 0, open: 1 },
      '2026-11-24T15': { done: 1, open: 1 },
    })
    expect(slotLines(all, '2026-11-24T15').map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('reads to the hour it ends at', () => {
    expect(slotLabel('2026-11-24T14+3', '2026-11-24')).toBe('Today 2pm-5pm')
    expect(slotLabel('2026-11-24T22+4', '2026-11-24')).toBe('Today 10pm-2am')
    expect(slotLabel('2026-11-24T09', '2026-11-24')).toBe('Today 9am')
  })
})
