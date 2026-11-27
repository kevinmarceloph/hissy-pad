import { describe, expect, it } from 'vitest'
import { parseSlot, slotDoingHour, slotCounts, slotCovers, slotDoneElsewhere, slotDoneExtra, slotHours, slotKey, slotOfHours, slotRuns, lineOrder, scopeSlot, slotLabel, slotLeftovers, slotLines, slotProgress, slotPast, slotShown, slotTops, unscopeSlot } from './slot'
import type { NodeRow, Rows } from './types'
import { buildIndex, homeNumbers, listNumbers } from './tree'
import { toOutline, toOutlineHtml } from './paste'

const row = (id: string, slot: string | null, done = false): NodeRow => ({
  id, parentId: null, rank: id, text: id, done, doneAt: null, doing: false, collapsed: false, numbered: false, header: false, divider: false, pad: false,
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
    // Where it was in its pad, not after the live ones, and as the row is stored.
    expect(slotLines(all, '2026-11-24T14').map((r) => r.id)).toEqual(['a', 'b'])
    expect(slotLines(all, '2026-11-24T14')[0]!.deletedAt).toBe('2026-11-24T15:00:00.000Z')
  })

  it('reads to the hour it ends at', () => {
    expect(slotLabel('2026-11-24T14+3', '2026-11-24')).toBe('Today 2pm-5pm')
    expect(slotLabel('2026-11-24T22+4', '2026-11-24')).toBe('Today 10pm-2am')
    expect(slotLabel('2026-11-24T09', '2026-11-24')).toBe('Today 9am')
    expect(slotLabel('2026-11-23T09', '2026-11-24')).toBe('Yesterday 9am')
    expect(slotLabel('2026-11-25T14+2', '2026-11-24')).toBe('Tomorrow 2pm-4pm')
    // Across a month and a year end.
    expect(slotLabel('2026-12-01T09', '2026-11-30')).toBe('Tomorrow 9am')
    expect(slotLabel('2026-12-31T09', '2027-01-01')).toBe('Yesterday 9am')
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
    expect(slotLabel('2026-11-24T09,2026-11-24T14,2026-11-25T08', '2026-11-24')).toBe('Today 9am, 2pm; Tomorrow 8am')
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
    expect(slotProgress(one, H)).toMatchObject({ top: { id: 'a' }, more: 0, count: { done: 0, open: 1 } })
    const many = table(row('a', H), under('a1', 'a', { done: true }), row('b', H, true), row('c', H, true))
    expect(slotProgress(many, H)).toMatchObject({ top: { id: 'a' }, more: 2, count: { done: 2, open: 1 } })
    // A divider is not an item: never the top, never counted.
    expect(slotProgress(table({ ...row('0', H), divider: true }, row('a', H), row('b', H)), H)).toMatchObject({ top: { id: 'a' }, more: 1 })
    // A line under another line of the same hour is listed under it, not counted beside it.
    expect(slotProgress(table(row('a', H), under('a1', 'a', { slot: H, done: true })), H).count).toEqual({ done: 0, open: 1 })
    expect(slotProgress(table(), H)).toEqual({ top: undefined, more: 0, count: { done: 0, open: 0 } })
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
    // An empty line is in the view (it may be about to be typed in), and so is an archived
    // one, alive, where it was in its pad: `archived` says which.
    expect(roots.map((r) => r.id)).toEqual(['t1', 'i1', 'empty', 'gone'])
    expect(view.rows['gone']!.deletedAt).toBeNull()
    expect([...view.archived]).toEqual(['gone'])
    expect(view.rows['t1a']!.parentId).toBe('t1')
    expect(view.homes.get('t1')).toEqual({ parentId: 'pt', rank: 'a0' })
    // An unchanged hour gives the same row objects back.
    expect(scopeSlot(all, H).rows['t1']).toBe(view.rows['t1'])
  })
})

describe('a numbered line in an hour', () => {
  const H = '2026-11-27T09'
  const num = (id: string, parentId: string | null, rank: string, slot: string | null = null): NodeRow => ({ ...row(id, slot), parentId, rank, numbered: true })
  // Inbox: one, [a pad row], two, three; in the pad: p1, p2, plain, p3.
  const all = table(
    num('one', null, 'a'), { ...row('pad', null), rank: 'b', pad: true }, num('two', null, 'c'), num('three', null, 'd', H),
    num('p1', 'pad', 'a'), num('p2', 'pad', 'b', H), { ...row('plain', null), parentId: 'pad', rank: 'c' }, num('p3', 'pad', 'd', H),
  )

  it('keeps the number it has in its own list', () => {
    const home = homeNumbers(all)
    // A pad row among Inbox's lines does not break their run; a plain line does.
    expect([home.get('one'), home.get('two'), home.get('three')]).toEqual([1, 2, 3])
    expect([home.get('p1'), home.get('p2'), home.get('p3')]).toEqual([1, 2, 1])
    expect(home.has('pad')).toBe(false)
    // The hour's own view would count them 1, 2, 3.
    const view = scopeSlot(all, H).rows
    expect([...listNumbers(buildIndex(view)).values()].sort()).toEqual([1, 2, 3])
  })

  it('copies with that number', () => {
    const view = scopeSlot(all, H).rows
    const numbers = homeNumbers(all)
    expect(toOutline(view, ['three'], { numbers })).toBe('3. three')
    expect(toOutlineHtml(view, ['three', 'p2'], undefined, numbers)).toContain('<li value="3">three</li>')
  })
})

describe('archived lines in an hour', () => {
  const H = '2026-11-24T14'
  const AT = '2026-11-24T15:00:00.000Z'
  const under = (id: string, parentId: string, over: Partial<NodeRow> = {}): NodeRow => ({ ...row(id, null), parentId, ...over })

  it('come with what was archived under them in the same archive, and nothing else', () => {
    const all = table(
      row('a', H), { ...row('b', H), deletedAt: AT }, under('b1', 'b', { deletedAt: AT }),
      // Archived on its own, an hour before: it stays out.
      under('b0', 'b', { deletedAt: '2026-11-24T14:00:00.000Z' }),
      // A blank tombstone with the hour on it (an undone Enter) is not a line of the hour.
      { ...row('x', H), text: '', deletedAt: AT },
    )
    expect([...slotShown(all, H).archived].sort()).toEqual(['b', 'b1'])
    const view = scopeSlot(all, H)
    expect(Object.keys(view.rows).sort()).toEqual(['a', 'b', 'b1'])
    expect(view.rows['b1']!.parentId).toBe('b')
    // An hour with none reads the table as it is.
    expect(slotShown(all, '2026-11-24T15').table).toBe(all)
  })

  it('stay archived through an edit, and take a line put under them along', () => {
    const all = table(row('a', H), { ...row('b', H, true), deletedAt: AT }, under('a1', 'a'))
    const view = scopeSlot(all, H)
    // The view's row is alive; the text changes, and the row goes back archived.
    const typed = { ...view.rows['b']!, text: 'b, again', updatedAt: '2026-11-24T16:00:00.000Z' }
    expect(unscopeSlot(all, H, view, [typed])).toEqual([{ ...all['b']!, text: 'b, again', updatedAt: '2026-11-24T16:00:00.000Z' }])
    // A live line moved in under it is archived with it.
    const moved = { ...view.rows['a1']!, parentId: 'b', updatedAt: '2026-11-24T16:00:00.000Z' }
    expect(unscopeSlot(all, H, view, [moved])).toEqual([{ ...moved, deletedAt: AT }])
  })

  it('are left where they are by a fresh start, which takes the open lines out of the hour', () => {
    const all = table(row('a', H), row('b', H, true), { ...row('c', H), deletedAt: AT }, row('d', `${H}+2`), row('e', '2026-11-24T09'))
    expect(slotLeftovers(all, H)).toEqual([{ id: 'a', slot: null }, { id: 'd', slot: '2026-11-24T15' }])
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

describe('marking a line doing puts it in the hour it is now', () => {
  const ctx = { now: () => '2026-11-27T07:00:00.000Z', newId: () => 'x' }
  const NOW = '2026-11-27T15'

  it('gives a line with no hour this one, and adds it to the hours a line already has', () => {
    const rows = table(row('a', null), row('b', '2026-11-27T14'), row('c', '2026-11-27T09'))
    const out = slotDoingHour(rows, ctx, ['a', 'b', 'c'], NOW)
    expect(out.a!.slot).toBe(NOW)
    expect(out.b!.slot).toBe('2026-11-27T14+2')
    expect(out.c!.slot).toBe('2026-11-27T09,2026-11-27T15')
    expect(out.a!.updatedAt).toBe(ctx.now())
  })

  it('leaves a line already doing, already in the hour, blank, a divider or a pad row as it is', () => {
    const rows = table(
      { ...row('doing', null), doing: true },
      row('here', '2026-11-27T14+3'),
      { ...row('blank', null), text: ' ' },
      { ...row('rule', null), divider: true },
      { ...row('pad', null), pad: true, header: true },
      { ...row('gone', null), deletedAt: '2026-11-26T00:00:00.000Z' },
    )
    expect(slotDoingHour(rows, ctx, Object.keys(rows), NOW)).toBe(rows)
  })

  it('takes a done line going back to doing', () => {
    const rows = table(row('a', null, true))
    expect(slotDoingHour(rows, ctx, ['a'], NOW).a!.slot).toBe(NOW)
  })
})
