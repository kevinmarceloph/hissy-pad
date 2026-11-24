import { describe, expect, it } from 'vitest'
import { parseSlot, slotCounts, slotCovers, slotDoneExtra, slotHours, slotKey, slotLabel, slotLines, slotOutline, slotProgress, slotTops } from './slot'
import type { NodeRow, Rows } from './types'

const row = (id: string, slot: string | null, done = false): NodeRow => ({
  id, parentId: null, rank: id, text: id, done, doneAt: null, doing: false, collapsed: false, numbered: false, header: false, pad: false,
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

  it('keeps an archived line in its hours, counted and listed', () => {
    const gone = { ...row('a', '2026-11-24T14', true), deletedAt: '2026-11-24T15:00:00.000Z' }
    const all = table(gone, row('b', '2026-11-24T14'))
    expect(slotCounts(all)).toEqual({ '2026-11-24T14': { done: 1, open: 1 } })
    expect(slotLines(all, '2026-11-24T14').map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('reads to the hour it ends at', () => {
    expect(slotLabel('2026-11-24T14+3', '2026-11-24')).toBe('Today 2pm-5pm')
    expect(slotLabel('2026-11-24T22+4', '2026-11-24')).toBe('Today 10pm-2am')
    expect(slotLabel('2026-11-24T09', '2026-11-24')).toBe('Today 9am')
  })
})

describe('lines crossed out during an hour', () => {
  // Local time, as the slots are: 2:10pm and 3:40pm on 24 Nov.
  const at = (h: number, m: number) => new Date(2026, 10, 24, h, m).toISOString()
  const done = (id: string, slot: string | null, when: string, extra: Partial<NodeRow> = {}): NodeRow =>
    ({ ...row(id, slot, true), doneAt: when, ...extra })

  it('counts them by the hour they were crossed out, cleared ones too, leaving out the ones assigned there', () => {
    const all = table(
      done('a', null, at(14, 10)),
      done('b', '2026-11-23T09', at(14, 50)),
      done('c', '2026-11-24T14', at(14, 20)),          // assigned to 2pm: already in 2pm's count
      done('d', '2026-11-24T13+2', at(14, 5)),         // a run that takes in 2pm: same
      done('e', null, at(15, 40), { deletedAt: at(16, 0) }), // cleared since: still counts
      done('f', null, at(15, 41), { text: '  ' }),     // blank: never
      done('g', null, at(15, 42), { pad: true }),      // a pad row: never
      { ...row('h', null, true), doneAt: null },       // crossed out before doneAt existed
      row('i', null),                                  // open
    )
    expect(slotDoneExtra(all)).toEqual({ '2026-11-24T14': 2, '2026-11-24T15': 1 })
  })
})

describe('an hour as a pad of its own', () => {
  const H = '2026-11-24T14'
  const under = (id: string, parentId: string, over: Partial<NodeRow> = {}): NodeRow => ({ ...row(id, null), parentId, ...over })

  it('lists the lines put in it and everything under them, depth first', () => {
    const all = table(row('a', H), under('a1', 'a'), under('a1x', 'a1'), under('a2', 'a'), row('b', H), row('c', null), under('c1', 'c'))
    expect(slotOutline(all, H).map((r) => `${r.row.id}:${r.depth}`)).toEqual(['a:0', 'a1:1', 'a1x:2', 'a2:1', 'b:0'])
    expect(slotOutline(all, '2026-11-24T15')).toEqual([])
  })

  it('shows a line that sits under another line of the same hour once, under it', () => {
    const all = table(row('a', H), under('a1', 'a', { slot: H }), row('b', H))
    expect(slotTops(all, H).map((r) => r.id)).toEqual(['a', 'b'])
    expect(slotOutline(all, H).map((r) => r.row.id)).toEqual(['a', 'a1', 'b'])
  })

  it('keeps an archived line with nothing under it', () => {
    const gone = '2026-11-24T10:00:00.000Z'
    const all = table({ ...row('a', H), deletedAt: gone }, under('a1', 'a', { deletedAt: gone }))
    expect(slotOutline(all, H).map((r) => r.row.id)).toEqual(['a'])
  })

  it('counts its own lines only, never what is under them', () => {
    const one = table(row('a', H), under('a1', 'a', { done: true }), under('a2', 'a'))
    expect(slotProgress(one, H)).toMatchObject({ top: { id: 'a' }, count: { done: 0, open: 1 } })
    const many = table(row('a', H), under('a1', 'a', { done: true }), row('b', H, true), row('c', H, true))
    expect(slotProgress(many, H)).toMatchObject({ top: { id: 'a' }, count: { done: 2, open: 1 } })
    // A line under another line of the same hour is listed under it, not counted beside it.
    expect(slotProgress(table(row('a', H), under('a1', 'a', { slot: H, done: true })), H).count).toEqual({ done: 0, open: 1 })
    expect(slotProgress(table(), H)).toEqual({ top: undefined, count: { done: 0, open: 0 } })
  })
})
