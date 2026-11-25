import { describe, expect, it } from 'vitest'
import { boomerang, boomerangGroups, clearFresh, comeBack, dayStartAt, deliverDue, dueLabel } from './boomerang'
import { padCounts, scopePad, settleFixedPads, findFixedPad } from './pads'
import { idOf, pad, shape, testCtx } from './testing'
import type { Rows } from './types'

function table(outline: string) {
  const ctx = testCtx()
  const rows = settleFixedPads(pad(outline, ctx), ctx)
  return { ctx, rows }
}
const later = (rows: Rows) => findFixedPad(rows, 'Later')!.id

describe('boomerang', () => {
  it('sends a line with what is under it out of its pad, under Later, with its day', () => {
    const { ctx, rows } = table('A\n  a1\nB')
    const out = boomerang(rows, ctx, [idOf(rows, 'A')], '2026-12-01')
    expect(shape(out)).toBe('B\n@Today\n@Later\n  >2026-12-01 A\n    a1')
    // No pad shows it: not the Inbox, not Later; and Later's count leaves it out.
    expect(shape(scopePad(out, null))).toBe('B')
    expect(shape(scopePad(out, later(out)))).toBe('')
    expect(padCounts(out).get(later(out))).toBe(0)
  })

  it('takes the line out of its hour and off its pin, and groups by day', () => {
    const { ctx, rows: base } = table('A\nB')
    let rows: Rows = { ...base, [idOf(base, 'A')]: { ...base[idOf(base, 'A')]!, slot: '2026-11-25T09', pinned: true } }
    rows = boomerang(rows, ctx, [idOf(rows, 'B')], '2026-12-02')
    rows = boomerang(rows, ctx, [idOf(rows, 'A')], '2026-12-01')
    const a = rows[idOf(rows, 'A')]!
    expect([a.slot, a.pinned, a.due]).toEqual([null, false, '2026-12-01'])
    expect(boomerangGroups(rows).map((g) => [g.due, g.lines.map((r) => r.text)])).toEqual([['2026-12-01', ['A']], ['2026-12-02', ['B']]])
  })

  it('only changes the day of a line already out, and refuses a pad row or a bad day', () => {
    const { ctx, rows } = table('A\nB')
    const out = boomerang(rows, ctx, [idOf(rows, 'A')], '2026-12-01')
    const again = boomerang(out, ctx, [idOf(rows, 'A')], '2026-12-05')
    expect(again[idOf(rows, 'A')]!.rank).toBe(out[idOf(rows, 'A')]!.rank)
    expect(again[idOf(rows, 'A')]!.due).toBe('2026-12-05')
    expect(boomerang(rows, ctx, [later(rows)], '2026-12-01')).toBe(rows)
    expect(boomerang(rows, ctx, [idOf(rows, 'A')], 'soon')).toBe(rows)
  })

  it('comes back by hand to the top of the Inbox, with no dot', () => {
    const { ctx, rows } = table('A\nB')
    const out = comeBack(boomerang(rows, ctx, [idOf(rows, 'B')], '2026-12-01'), ctx, [idOf(rows, 'B')])
    expect(shape(scopePad(out, null))).toBe('B\nA')
  })
})

describe('deliverDue', () => {
  it('brings back what is due, earlier days first, marked fresh, under the pins', () => {
    const { ctx, rows: base } = table('P\nA\nB\nC')
    let rows: Rows = { ...base, [idOf(base, 'P')]: { ...base[idOf(base, 'P')]!, pinned: true } }
    rows = boomerang(rows, ctx, [idOf(rows, 'A')], '2026-12-02')
    rows = boomerang(rows, ctx, [idOf(rows, 'B')], '2026-12-01')
    rows = boomerang(rows, ctx, [idOf(rows, 'C')], '2026-12-09')
    expect(deliverDue(rows, ctx, '2026-11-30', 6)).toBe(rows)
    const out = deliverDue(rows, ctx, '2026-12-02', 6)
    expect(shape(scopePad(out, null))).toBe('^P\n*B\n*A')
    expect(boomerangGroups(out).map((g) => g.due)).toEqual(['2026-12-09'])
  })

  it('stamps the row with the moment its day started, so a late device does not win', () => {
    const { ctx, rows } = table('A')
    const out = deliverDue(boomerang(rows, ctx, [idOf(rows, 'A')], '2026-12-01'), ctx, '2026-12-03', 6)
    expect(out[idOf(rows, 'A')]!.updatedAt).toBe(dayStartAt('2026-12-01', 6).toISOString())
  })

  it('stamps with now when the row was edited after its day started', () => {
    const { rows } = table('A')
    const late = { ...testCtx(), now: () => '2027-01-01T00:00:00.000Z' }
    const sent = boomerang(rows, late, [idOf(rows, 'A')], '2026-12-01')
    const out = deliverDue(sent, { ...late, now: () => '2027-01-01T00:00:01.000Z' }, '2026-12-03', 6)
    expect(out[idOf(rows, 'A')]!.updatedAt).toBe('2027-01-01T00:00:01.000Z')
    expect(out[idOf(rows, 'A')]!.fresh).toBe(true)
  })

  it('clears the dot', () => {
    const { ctx, rows } = table('A')
    const out = deliverDue(boomerang(rows, ctx, [idOf(rows, 'A')], '2026-12-01'), ctx, '2026-12-01', 0)
    expect(clearFresh(out, ctx, [idOf(rows, 'A')])[idOf(rows, 'A')]!.fresh).toBe(false)
  })
})

describe('dueLabel', () => {
  it('reads Tomorrow, else the weekday and date', () => {
    expect(dueLabel('2026-11-26', '2026-11-25')).toBe('Tomorrow')
    expect(dueLabel('2026-11-28', '2026-11-25')).toBe('Sat, Nov 28')
    expect(dueLabel('2027-01-02', '2026-11-25')).toBe('Sat, Jan 2, 2027')
  })
})
