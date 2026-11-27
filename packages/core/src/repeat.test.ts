import { describe, expect, it } from 'vitest'
import {
  addUnits, deliverRepeats, derivedId, makeRepeat, nextAfter, nextRepeatDay, onOrAfter, parseRepeat, repeatLabel, repeatLink, repeatNote, repeatSlot,
  setRepeat, setRepeatSlot, settleRepeats, shiftSlot, stopRepeat, unlinkRepeat, type RepeatChoice,
} from './repeat'
import { boomerang, comeBack, FOREVER, settleBoomerangs } from './boomerang'
import { moveNodes, remove, setDone } from './ops'
import { findFixedPad, padCounts, scopePad, settleFixedPads } from './pads'
import { idOf, pad, shape, testCtx } from './testing'
import type { NodeRow, OpCtx, Rows } from './types'

const TODAY = '2026-12-01' // a Tuesday
const weekly: RepeatChoice = { mode: 'every', n: 1, unit: 'w', keep: 'reuse' }

function table(outline: string) {
  const ctx = testCtx()
  const rows = settleFixedPads(pad(outline, ctx), ctx)
  return { ctx, rows }
}
const later = (rows: Rows) => findFixedPad(rows, 'Later')!.id
const today = (rows: Rows) => findFixedPad(rows, 'Today')!.id
const rule = (rows: Rows, id: string) => parseRepeat(rows[id]!.repeat)!
// A line made recurring, settled as the store does it.
function made(outline: string, choice: RepeatChoice, patch: Partial<NodeRow> = {}) {
  const { ctx, rows: base } = table(outline)
  const id = idOf(base, 'A')
  const res = makeRepeat({ ...base, [id]: { ...base[id]!, ...patch } }, ctx, id, choice, TODAY, 0)
  return { ctx, id, t: res.templateId, rows: settleBoomerangs(settleRepeats(res.rows, ctx), ctx) }
}
const done = (rows: Rows, ctx: OpCtx, id: string, at: string): Rows => {
  const out = setDone(rows, ctx, [id], true)
  return { ...out, [id]: { ...out[id]!, doneAt: at } }
}

describe('days', () => {
  it('adds days, weeks, months and years, a short month taking its last day', () => {
    expect(addUnits('2026-12-30', 3, 'd')).toBe('2027-01-02')
    expect(addUnits('2026-12-01', 2, 'w')).toBe('2026-12-15')
    expect(addUnits('2027-01-31', 1, 'm')).toBe('2027-02-28')
    expect(addUnits('2028-02-29', 1, 'y')).toBe('2029-02-28')
  })

  it('counts from the start, so the 31st does not drift to the 28th', () => {
    const r = { from: '2027-01-31', n: 1, unit: 'm' as const }
    expect(nextAfter(r, '2027-01-31')).toBe('2027-02-28')
    expect(nextAfter(r, '2027-02-28')).toBe('2027-03-31')
    expect(onOrAfter(r, '2026-06-01')).toBe('2027-01-31')
    expect(onOrAfter({ from: '2026-12-01', n: 2, unit: 'w' }, '2027-03-01')).toBe('2027-03-09')
    expect(onOrAfter({ from: '2026-12-01', n: 3, unit: 'd' }, '2026-12-04')).toBe('2026-12-04')
  })

  it('moves a slot by whole days, a run over midnight included', () => {
    expect(shiftSlot('2026-12-01T09', 7)).toBe('2026-12-08T09')
    expect(shiftSlot('2026-12-01T23+2,2026-12-01T09', 1)).toBe('2026-12-02T09,2026-12-02T23+2')
    expect(shiftSlot(null, 3)).toBe(null)
  })

  it('says a rule in words', () => {
    expect(repeatLabel({ mode: 'every', n: 1, unit: 'd' })).toBe('Every day')
    expect(repeatLabel({ mode: 'every', n: 2, unit: 'w' })).toBe('Every 2 weeks')
    expect(repeatLabel({ mode: 'after', n: 3, unit: 'd' })).toBe('3 days after it is done')
    expect(repeatLabel({ mode: 'after', n: 1, unit: 'm' })).toBe('A month after it is done')
  })
})

describe('derivedId', () => {
  it('is the same for the same pair, differs for another, and is shaped like a uuid', () => {
    const a = derivedId('3f0c2d5e-1111-4222-8333-444455556666', '2026-12-08')
    expect(a).toBe(derivedId('3f0c2d5e-1111-4222-8333-444455556666', '2026-12-08'))
    expect(a).not.toBe(derivedId('3f0c2d5e-1111-4222-8333-444455556666', '2026-12-09'))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const seen = new Set(Array.from({ length: 2000 }, (_, i) => derivedId('t', String(i))))
    expect(seen.size).toBe(2000)
  })
})

describe('makeRepeat', () => {
  it('copies the line and what is under it to a template under Later, and links the line to it', () => {
    const { rows, id, t } = made('A\n  a1\n  a2\nB', weekly)
    expect(shape(rows)).toBe(`A\n  a1\n  a2\nB\n@Today\n@Later\n  >${FOREVER} A\n    a1\n    a2`)
    expect(rows[id]!.origin).toBe(t)
    expect(rule(rows, t)).toMatchObject({ mode: 'every', n: 1, unit: 'w', keep: 'reuse', from: TODAY, next: '2026-12-08', slot: null })
    expect(repeatLink(rows, id)).toMatchObject({ role: 'instance', templateId: t })
    expect(repeatLink(rows, t)).toMatchObject({ role: 'template', templateId: t })
    expect(repeatLink(rows, idOf(rows, 'B'))).toBe(null)
    // The template is in no pad's lines or count, like a line out on a boomerang.
    expect(shape(scopePad(rows, later(rows)))).toBe('')
    expect(padCounts(rows).get(later(rows))).toBe(0)
    expect(shape(scopePad(rows, later(rows), true))).toBe(`>${FOREVER} A\n  a1\n  a2`)
  })

  it('starts the count on the day of the line\'s hour and keeps the hours', () => {
    const { rows, t } = made('A', weekly, { slot: '2026-12-03T09+2' })
    expect(rule(rows, t)).toMatchObject({ from: '2026-12-03', next: '2026-12-10', slot: '2026-12-03T09+2', at: '2026-12-03' })
    expect(repeatSlot(rule(rows, t))).toBe('2026-12-10T09+2')
    expect(rows[t]!.slot).toBe(null)
  })

  it('leaves a crossed-out state, a pin and a pad row behind, and refuses a template', () => {
    const { rows, t, ctx } = made('A', weekly, { done: true, doneAt: '2026-12-01T03:00:00.000Z', pinned: true })
    expect([rows[t]!.done, rows[t]!.pinned]).toEqual([false, false])
    expect(makeRepeat(rows, ctx, t, weekly, TODAY, 0).rows).toBe(rows)
    expect(makeRepeat(rows, ctx, later(rows), weekly, TODAY, 0).rows).toBe(rows)
  })

  it('sits under the days of the boomerangs', () => {
    const { rows: base, ctx } = made('A\nB', weekly)
    const rows = boomerang(base, ctx, [idOf(base, 'B')], '2026-12-20')
    expect(shape(scopePad(rows, later(rows), true))).toBe(`>2026-12-20 B\n>${FOREVER} A`)
  })
})

describe('deliverRepeats: every', () => {
  it('does nothing before the day', () => {
    const { rows, ctx } = made('A', weekly)
    expect(deliverRepeats(rows, ctx, '2026-12-07', 0)).toBe(rows)
    expect(nextRepeatDay(rows, 0)).toBe('2026-12-08')
  })

  it('reuse: the instance still open comes back to the top of Today, fresh, and the rule moves on', () => {
    const { rows, ctx, id, t } = made('A\n  a1\nB', weekly)
    const out = deliverRepeats(rows, ctx, '2026-12-08', 0)
    expect(shape(scopePad(out, today(out)))).toBe('*A\n  a1')
    expect(shape(scopePad(out, null))).toBe('B')
    expect(rule(out, t).next).toBe('2026-12-15')
    expect(out[id]!.updatedAt).toBe(new Date(2026, 11, 8, 0).toISOString())
  })

  it('reuse: with the last one crossed out, a new copy is made from the template as it is now', () => {
    const { rows: base, ctx, id, t } = made('A\n  a1', weekly)
    let rows = done(base, ctx, id, '2026-12-02T03:00:00.000Z')
    const kid = Object.values(rows).find((r) => r.parentId === t)!
    rows = { ...rows, [kid.id]: { ...kid, text: 'a1 edited' } }
    const out = deliverRepeats(rows, ctx, '2026-12-08', 0)
    expect(shape(scopePad(out, today(out)))).toBe('*A\n  a1 edited')
    expect(shape(scopePad(out, null))).toBe('~A\n  a1')
    const copy = out[derivedId(t, '2026-12-08')]!
    expect([copy.origin, copy.done, copy.due, copy.repeat]).toEqual([t, false, null, null])
  })

  it('replace: the one still open is archived for a fresh copy', () => {
    const { rows, ctx, id, t } = made('A', { ...weekly, keep: 'replace' })
    const out = deliverRepeats(rows, ctx, '2026-12-08', 0)
    expect(out[id]!.deletedAt).not.toBe(null)
    expect(shape(scopePad(out, null))).toBe('')
    expect(shape(scopePad(out, today(out)))).toBe('*A')
    expect(out[derivedId(t, '2026-12-08')]!.origin).toBe(t)
  })

  it('add: every missed day makes its own, the old ones left alone', () => {
    const { rows, ctx, t } = made('A', { mode: 'every', n: 1, unit: 'd', keep: 'add' })
    const out = deliverRepeats(rows, ctx, '2026-12-03', 0)
    expect(shape(scopePad(out, null))).toBe('A')
    expect(shape(scopePad(out, today(out)))).toBe('*A\n*A')
    expect(rule(out, t).next).toBe('2026-12-04')
  })

  it('reuse and replace make up for missed days once', () => {
    const { rows, ctx, t } = made('A', { mode: 'every', n: 1, unit: 'd', keep: 'reuse' })
    const out = deliverRepeats(rows, ctx, '2026-12-20', 0)
    expect(shape(scopePad(out, today(out)))).toBe('*A')
    expect(rule(out, t).next).toBe('2026-12-21')
  })

  it('writes the same rows on every device, and nothing the second time', () => {
    const { rows: base, ctx, id } = made('A\n  a1', { ...weekly, keep: 'add' })
    const rows = done(base, ctx, id, '2026-12-02T03:00:00.000Z')
    const one = deliverRepeats(rows, testCtx(), '2026-12-08', 0)
    const two = deliverRepeats(rows, testCtx(), '2026-12-09', 0)
    const fresh = (out: Rows) => Object.values(out).filter((r) => !(r.id in rows)).sort((a, b) => (a.id < b.id ? -1 : 1))
    expect(fresh(one)).toEqual(fresh(two))
    expect(fresh(one).length).toBe(2)
    expect(one[later(one)]).toBe(rows[later(rows)])
    expect(deliverRepeats(one, ctx, '2026-12-08', 0)).toBe(one)
  })

  it('puts an instance with hours in them, in Today\'s Scheduled section', () => {
    const { rows: base, ctx, id } = made('A\nB', weekly, { slot: '2026-12-01T09' })
    let rows = moveNodes(base, ctx, [idOf(base, 'B')], { parentId: today(base), afterId: null })
    rows = done(rows, ctx, id, '2026-12-01T10:00:00.000Z')
    const out = deliverRepeats(rows, ctx, '2026-12-08', 0)
    const top = scopePad(out, today(out))
    expect(shape(top)).toBe('B\n*A')
    expect(Object.values(top).find((r) => r.text === 'A')!.slot).toBe('2026-12-08T09')
  })

  it('leaves an archived template and one with a broken rule alone', () => {
    const { rows, ctx, t } = made('A', weekly)
    const gone = remove(rows, ctx, [t])
    expect(deliverRepeats(gone, ctx, '2026-12-08', 0)).toBe(gone)
    const broken = { ...rows, [t]: { ...rows[t]!, repeat: '{"mode":"every"' } }
    expect(deliverRepeats(broken, ctx, '2026-12-08', 0)).toBe(broken)
  })
})

describe('deliverRepeats: after', () => {
  const after: RepeatChoice = { mode: 'after', n: 3, unit: 'd', keep: 'reuse' }

  it('waits while the instance is open', () => {
    const { rows, ctx } = made('A', after)
    expect(deliverRepeats(rows, ctx, '2027-06-01', 0)).toBe(rows)
    expect(nextRepeatDay(rows, 0)).toBe(null)
  })

  it('makes the next one n days after the last was crossed out', () => {
    const { rows: base, ctx, id, t } = made('A', after)
    const rows = done(base, ctx, id, new Date(2026, 11, 4, 15).toISOString())
    expect(nextRepeatDay(rows, 0)).toBe('2026-12-07')
    expect(deliverRepeats(rows, ctx, '2026-12-06', 0)).toBe(rows)
    const out = deliverRepeats(rows, ctx, '2026-12-07', 0)
    expect(shape(scopePad(out, today(out)))).toBe('*A')
    expect(out[derivedId(t, '2026-12-07')]!.origin).toBe(t)
    // That one is open, so nothing more comes.
    expect(deliverRepeats(out, ctx, '2026-12-30', 0)).toBe(out)
  })

  it('counts a day by the hour the day starts at', () => {
    const { rows: base, ctx, id } = made('A', after)
    // 2am on the 5th is still the 4th when the day starts at 6.
    const rows = done(base, ctx, id, new Date(2026, 11, 5, 2).toISOString())
    expect(nextRepeatDay(rows, 6)).toBe('2026-12-07')
  })

  it('counts an archived instance from the day it was archived', () => {
    const { rows: base, id } = made('A', after)
    const at = new Date(2026, 11, 2, 12).toISOString()
    const rows = remove(base, { now: () => at, newId: () => 'x' }, [id])
    expect(nextRepeatDay(rows, 0)).toBe('2026-12-05')
  })
})

describe('the rule', () => {
  it('changes from the template, the next day counted from today', () => {
    const { rows, ctx, t } = made('A', weekly)
    const out = setRepeat(rows, ctx, t, { mode: 'every', n: 2, unit: 'd', keep: 'add' }, '2026-12-04')
    expect(rule(out, t)).toMatchObject({ n: 2, unit: 'd', keep: 'add', from: TODAY, next: '2026-12-05' })
    expect(setRepeat(out, ctx, t, { mode: 'every', n: 2, unit: 'd', keep: 'add' }, '2026-12-04')).toBe(out)
    expect(rule(setRepeat(out, ctx, t, { mode: 'after', n: 1, unit: 'w', keep: 'reuse' }, '2026-12-04'), t)).toMatchObject({ mode: 'after', next: '2026-12-04' })
    expect(setRepeat(rows, ctx, idOf(rows, 'A'), weekly, TODAY)).toBe(rows)
  })

  it('takes hours from the hour picker: a day ahead moves the next instance to it', () => {
    const { rows, ctx, t } = made('A', weekly)
    const ahead = setRepeatSlot(rows, ctx, t, '2026-12-05T14', TODAY, 0)
    expect(rule(ahead, t)).toMatchObject({ from: '2026-12-05', next: '2026-12-05', slot: '2026-12-05T14' })
    const same = setRepeatSlot(rows, ctx, t, '2026-12-01T14', TODAY, 0)
    expect(rule(same, t)).toMatchObject({ from: TODAY, next: '2026-12-08' })
    expect(repeatSlot(rule(same, t))).toBe('2026-12-08T14')
    expect(rule(setRepeatSlot(same, ctx, t, null, TODAY, 0), t).slot).toBe(null)
  })

  it('says when the next one comes', () => {
    const { rows, t } = made('A', weekly)
    expect(repeatNote(rows, t, TODAY, 0)).toBe('Every week, next Tue, Dec 8')
    expect(repeatNote(rows, t, '2026-12-07', 0)).toBe('Every week, next tomorrow')
    const waiting = made('A', { mode: 'after', n: 1, unit: 'd', keep: 'reuse' })
    expect(repeatNote(waiting.rows, waiting.t, TODAY, 0)).toBe('A day after it is done')
  })

  it('stops: the template is a line of Later again, and its instance an ordinary line', () => {
    const { rows, ctx, id, t } = made('A', weekly)
    const out = settleBoomerangs(settleRepeats(stopRepeat(rows, ctx, t), ctx), ctx)
    expect(shape(scopePad(out, later(out)))).toBe('A')
    expect(repeatLink(out, id)).toBe(null)
    expect(deliverRepeats(out, ctx, '2026-12-08', 0)).toBe(out)
  })

  it('unlinks an instance; an after rule then counts from today', () => {
    const { rows, ctx, id, t } = made('A', { mode: 'after', n: 2, unit: 'd', keep: 'reuse' })
    const out = unlinkRepeat(rows, ctx, [id], '2026-12-03')
    expect(out[id]!.origin).toBe(null)
    expect(rule(out, t).next).toBe('2026-12-05')
    const next = deliverRepeats(out, ctx, '2026-12-05', 0)
    expect(shape(scopePad(next, today(next)))).toBe('*A')
    expect(shape(scopePad(next, null))).toBe('A')
  })
})

describe('settleRepeats', () => {
  it('a template moved out of Later, or under another line, is no template any more', () => {
    const { rows, ctx, t } = made('A\nB', weekly)
    const moved = moveNodes(rows, ctx, [t], { parentId: idOf(rows, 'B'), afterId: null })
    const out = settleBoomerangs(settleRepeats(moved, ctx, [t]), ctx, rows, [t])
    expect([out[t]!.repeat, out[t]!.due]).toEqual([null, null])
  })

  it('keeps a template out for good, in no hour and on no pin, and a line with no rule is not', () => {
    const { rows, ctx, t } = made('A\nB', weekly)
    const b = idOf(rows, 'B')
    const bent = { ...rows, [t]: { ...rows[t]!, due: '2026-12-09', slot: '2026-12-01T09', pinned: true }, [b]: { ...rows[b]!, due: FOREVER } }
    const out = settleRepeats(bent, ctx)
    expect([out[t]!.due, out[t]!.slot, out[t]!.pinned, out[b]!.due]).toEqual([FOREVER, null, false, null])
    expect(settleRepeats(rows, ctx)).toBe(rows)
  })

  it('a boomerang leaves a template where it is, and Back now makes it a line again', () => {
    const { rows, ctx, t } = made('A', weekly)
    expect(boomerang(rows, ctx, [t], '2026-12-09')).toBe(rows)
    const back = comeBack(rows, ctx, [t])
    expect([back[t]!.repeat, back[t]!.due]).toEqual([null, null])
  })
})
