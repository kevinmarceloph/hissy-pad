import { describe, expect, it } from 'vitest'
import { boomerang, boomerangGroups, clearFresh, comeBack, dayStartAt, deliverDue, dueHeads, dueLabel, settleBoomerangs } from './boomerang'
import { dedent, indent, insertAt, moveNodes } from './ops'
import { buildIndex, flatten } from './tree'
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

  it('comes back by hand to the top of Later, with no dot', () => {
    const { ctx, rows } = table('A\nB')
    let out = insertAt(rows, ctx, { parentId: later(rows), afterId: null }, 'L').rows
    out = comeBack(boomerang(out, ctx, [idOf(rows, 'B')], '2026-12-01'), ctx, [idOf(rows, 'B')])
    expect(shape(scopePad(out, null))).toBe('A')
    expect(shape(scopePad(out, later(out)))).toBe('B\nL')
    expect(out[idOf(rows, 'B')]!.fresh).toBe(false)
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
    expect(shape(scopePad(out, null))).toBe('^P')
    expect(shape(scopePad(out, later(out)))).toBe('*B\n*A')
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

// Later's own view (scopePad with the lines that are out): rows like any other, in groups.
describe('settleBoomerangs', () => {
  function out3() {
    const { ctx, rows: base } = table('own\nA\n  a1\nB\nC')
    let rows = boomerang(base, ctx, [idOf(base, 'C')], '2026-12-05')
    rows = boomerang(rows, ctx, [idOf(base, 'A')], '2026-12-01')
    rows = boomerang(rows, ctx, [idOf(base, 'B')], '2026-12-01')
    rows = moveNodes(rows, ctx, [idOf(base, 'own')], { parentId: later(rows), afterId: null })
    rows = settleBoomerangs(rows, ctx)
    return { ctx, rows, l: later(rows), id: (t: string) => idOf(rows, t) }
  }
  const view = (rows: Rows) => shape(scopePad(rows, later(rows), true))

  it('keeps the groups in day order under Later\'s own lines, whatever order they were sent in', () => {
    const { rows } = out3()
    expect(view(rows)).toBe('own\n>2026-12-01 A\n  a1\n>2026-12-01 B\n>2026-12-05 C')
    const flat = flatten(buildIndex(scopePad(rows, later(rows), true)), true)
    expect([...dueHeads(flat, rows)]).toEqual([[idOf(rows, 'A'), '2026-12-01'], [idOf(rows, 'C'), '2026-12-05']])
    expect(settleBoomerangs(rows, testCtx())).toBe(rows)
  })

  it('a line moves within its group, and one dragged out snaps back to the near edge', () => {
    const { ctx, rows, l, id } = out3()
    const prev = rows
    // B above A: a move within the group stays.
    let next = moveNodes(rows, ctx, [id('B')], { parentId: l, afterId: id('own') })
    expect(view(settleBoomerangs(next, ctx, prev))).toBe('own\n>2026-12-01 B\n>2026-12-01 A\n  a1\n>2026-12-05 C')
    // A below C: back to the bottom of its own day. C to the very top: back to the top of its day.
    next = moveNodes(rows, ctx, [id('A')], { parentId: l, afterId: id('C') })
    expect(view(settleBoomerangs(next, ctx, prev))).toBe('own\n>2026-12-01 B\n>2026-12-01 A\n  a1\n>2026-12-05 C')
    next = moveNodes(rows, ctx, [id('C')], { parentId: l, afterId: null })
    expect(view(settleBoomerangs(next, ctx, prev))).toBe(view(rows))
    // One of Later's own lines dropped among the groups goes back to the end of its own.
    next = moveNodes(rows, ctx, [id('own')], { parentId: l, afterId: id('A') })
    expect(view(settleBoomerangs(next, ctx, prev))).toBe(view(rows))
  })

  it('a new line in a group joins its day; a sub item dedented does too; one nested rides along', () => {
    const { ctx, rows, l, id } = out3()
    const made = insertAt(rows, ctx, { parentId: l, afterId: id('A') }, 'new')
    expect(view(settleBoomerangs(made.rows, ctx, rows))).toBe('own\n>2026-12-01 A\n  a1\n>2026-12-01 new\n>2026-12-01 B\n>2026-12-05 C')
    // After a sync merge (no table from before) nothing joins: it is one of Later's own.
    expect(view(settleBoomerangs(made.rows, ctx))).toBe('own\nnew\n>2026-12-01 A\n  a1\n>2026-12-01 B\n>2026-12-05 C')

    const scoped = scopePad(rows, l, true)
    const lifted = dedent(scoped, ctx, [id('a1')])
    const back = { ...rows, [id('a1')]: { ...lifted[id('a1')]!, parentId: l } }
    expect(view(settleBoomerangs(back, ctx, rows))).toBe('own\n>2026-12-01 A\n>2026-12-01 a1\n>2026-12-01 B\n>2026-12-05 C')

    const nested = indent(scoped, ctx, [id('B')])
    const under = { ...rows, [id('B')]: nested[id('B')]! }
    expect(view(settleBoomerangs(under, ctx, rows))).toBe('own\n>2026-12-01 A\n  a1\n  B\n>2026-12-05 C')
  })

  it('a line that left Later has no day, and one that is out is never pinned', () => {
    const { ctx, rows, id } = out3()
    const moved = moveNodes(rows, ctx, [id('B')], { parentId: null, afterId: null })
    expect(settleBoomerangs(moved, ctx, rows)[id('B')]!.due).toBeNull()
    const pinned = { ...rows, [id('C')]: { ...rows[id('C')]!, pinned: true } }
    expect(settleBoomerangs(pinned, ctx, rows)[id('C')]!.pinned).toBe(false)
  })

  it('a change of day moves the line to its new group', () => {
    const { ctx, rows, id } = out3()
    expect(view(boomerang(rows, ctx, [id('A')], '2026-12-09'))).toBe('own\n>2026-12-01 B\n>2026-12-05 C\n>2026-12-09 A\n  a1')
  })
})
