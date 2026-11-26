import { describe, expect, it } from 'vitest'
import { parseSlot, slotCounts, slotCovers, slotDoneElsewhere, slotDoneExtra, slotHours, slotKey, slotOfHours, slotRuns, lineOrder, scopeSlot, slotLabel, slotLines, slotProgress, slotPast, slotTops } from './slot'
import type { NodeRow, Rows } from './types'

const row = (id: string, slot: string | null, done = false): NodeRow => ({
  id, parentId: null, rank: id, text: id, done, doneAt: null, doing: false, collapsed: false, numbered: false, header: false, pad: false,
  slot, category: null, pinned: false, countHidden: false, due: null, fresh: false, updatedAt: '2026-11-24T00:00:00.000Z', deletedAt: null,
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

  it('holds hours that are apart as runs with commas between them', () => {
    // However they were picked: sorted, each once, neighbours joined, over midnight too.
    expect(slotOfHours(['2026-11-24T14', '2026-11-24T09', '2026-11-24T15', '2026-11-24T09'])).toBe('2026-11-24T09,2026-11-24T14+2')
    expect(slotOfHours(['2026-11-25T00', '2026-11-24T23'])).toBe('2026-11-24T23+2')
    expect(slotOfHours(['2026-11-24T09'])).toBe('2026-11-24T09')
    expect(slotOfHours([])).toBeNull()
    const apart = '2026-11-24T09,2026-11-24T14+2'
    expect(slotRuns(apart)).toEqual([{ day: '2026-11-24', hour: 9, hours: 1 }, { day: '2026-11-24', hour: 14, hours: 2 }])
    expect(slotHours(apart)).toEqual(['2026-11-24T09', '2026-11-24T14', '2026-11-24T15'])
    expect(slotCovers(apart, '2026-11-24T15')).toBe(true)
    expect(slotCovers(apart, '2026-11-24T10')).toBe(false)
    // It is not one hour or one run, and a part that does not read spoils the lot.
    expect(parseSlot(apart)).toBeNull()
    expect(slotRuns('2026-11-24T09,nonsense')).toEqual([])
    expect(slotLabel(apart, '2026-11-24')).toBe('Today 9am, 2pm-4pm')
    expect(slotLabel('2026-11-24T09,2026-11-24T14,2026-11-25T08', '2026-11-24')).toMatch(/^Today 9am, 2pm; .*, 8am$/)
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
    // The lines themselves, in the order they were crossed out.
    const lines = slotDoneElsewhere(all)
    expect(lines['2026-11-24T14']!.map((r) => r.id)).toEqual(['a', 'b'])
    expect(lines['2026-11-24T15']!.map((r) => r.id)).toEqual(['e'])
  })
})

describe('an hour as a pad of its own', () => {
  const H = '2026-11-24T14'
  const under = (id: string, parentId: string, over: Partial<NodeRow> = {}): NodeRow => ({ ...row(id, null), parentId, ...over })

  it('lists a line that sits under another line of the same hour once, under it', () => {
    const all = table(row('a', H), under('a1', 'a', { slot: H }), row('b', H))
    expect(slotTops(all, H).map((r) => r.id)).toEqual(['a', 'b'])
    expect(slotTops(all, '2026-11-24T15')).toEqual([])
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

describe('the order of an hour\'s lines', () => {
  const H = '2026-11-24T14'
  const pad = (id: string, name: string, rank: string): NodeRow => ({ ...row(id, null), text: name, rank, pad: true })
  const inPad = (id: string, padId: string, rank: string): NodeRow => ({ ...row(id, H), parentId: padId, rank })

  it('goes by pad (Today, the Inbox, Later, then the rest), then down the pad', () => {
    const all = table(
      pad('pl', 'Later', 'a1'), pad('pt', 'Today', 'a2'), pad('pw', 'Work', 'a3'),
      inPad('w1', 'pw', 'a0'), inPad('l1', 'pl', 'a0'), inPad('t2', 'pt', 'b0'), inPad('t1', 'pt', 'a0'),
      { ...row('i1', H), rank: 'z9' }, { ...row('i0', H, true), rank: 'a0' },
    )
    // A crossed-out line keeps its place: i0 is done and still comes before i1.
    expect(slotLines(all, H).map((r) => r.id)).toEqual(['t1', 't2', 'i0', 'i1', 'l1', 'w1'])
    // The same table gives the same map, without walking it again.
    expect(lineOrder(all)).toBe(lineOrder(all))
  })

  it('makes a view of the hour: its lines at the root in that order, each with what is under it', () => {
    const all = table(
      pad('pt', 'Today', 'a2'), inPad('t1', 'pt', 'a0'), { ...row('t1a', null), parentId: 't1' },
      { ...row('i1', H), rank: 'a0' }, { ...row('gone', H), deletedAt: '2026-11-24T10:00:00.000Z' }, { ...row('empty', H), text: '', rank: 'b0' },
    )
    const view = scopeSlot(all, H)
    const roots = Object.values(view.rows).filter((r) => r.parentId === null).sort((a, b) => (a.rank < b.rank ? -1 : 1))
    // An empty line is in the view (it may be about to be typed in); an archived one is not.
    expect(roots.map((r) => r.id)).toEqual(['t1', 'i1', 'empty'])
    expect(view.rows['t1a']!.parentId).toBe('t1')
    expect(view.homes.get('t1')).toEqual({ parentId: 'pt', rank: 'a0' })
    // An unchanged hour gives the same row objects back.
    expect(scopeSlot(all, H).rows['t1']).toBe(view.rows['t1'])
  })
})

describe('slotPast', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m)
  it('is true once the last hour the slot covers has ended', () => {
    expect(slotPast('2026-11-24T14', at(14, 59))).toBe(false)
    expect(slotPast('2026-11-24T14', at(15))).toBe(true)
    expect(slotPast('2026-11-24T13+3', at(15, 30))).toBe(false)
    expect(slotPast('2026-11-23T22+4', at(1))).toBe(false)
    expect(slotPast('2026-11-23T22+4', at(2))).toBe(true)
    expect(slotPast(null, at(2))).toBe(false)
  })
})
