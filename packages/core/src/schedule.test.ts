import { describe, expect, it } from 'vitest'
import { scheduleHead, scheduledKey, settleSchedule, isTodayPad } from './schedule'
import { dedent, insertAt, moveNodes } from './ops'
import { buildIndex, childrenOf, flatten } from './tree'
import { findFixedPad, scopePad, settleFixedPads } from './pads'
import { togglePinned, settlePins } from './pins'
import { idOf, pad, testCtx } from './testing'
import type { Rows } from './types'

const today = (rows: Rows) => findFixedPad(rows, 'Today')!.id

// Today with the lines given, each "text@HH" in that hour of one day.
function table(lines: string) {
  const ctx = testCtx()
  let rows = settleFixedPads(pad('', ctx), ctx)
  const t = today(rows)
  let after: string | null = null
  for (const line of lines.split(' ')) {
    const [text = '', hour] = line.split('@')
    const res = insertAt(rows, ctx, { parentId: t, afterId: after }, text)
    rows = hour ? { ...res.rows, [res.newId]: { ...res.rows[res.newId]!, slot: `2026-11-27T${hour}` } } : res.rows
    after = res.newId
  }
  return { ctx, rows, t, id: (text: string) => idOf(rows, text) }
}

// Today's top-level lines in order, the scheduled ones with their hour.
function view(rows: Rows): string {
  return childrenOf(buildIndex(rows), today(rows))
    .map((r) => (r.pinned ? '^' : '') + r.text + (r.slot ? `@${r.slot.slice(11)}` : ''))
    .join(' ')
}

describe('settleSchedule', () => {
  it('puts the lines with an hour under the pad\'s own, earliest first, and leaves the rest as they were', () => {
    const { ctx, rows } = table('a b@11 c d@09 e f@10+2')
    const out = settleSchedule(rows, ctx)
    expect(view(out)).toBe('a c e d@09 f@10+2 b@11')
    expect(settleSchedule(out, testCtx())).toBe(out)
  })

  it('does nothing in a Today with no hours', () => {
    const { ctx, rows } = table('a b c')
    expect(settleSchedule(rows, ctx)).toBe(rows)
  })

  it('orders across days, and a line in several hours goes by the first', () => {
    const { ctx, rows, id } = table('a@09 b@08')
    const later = { ...rows, [id('b')]: { ...rows[id('b')]!, slot: '2026-11-28T08' } }
    expect(view(settleSchedule(later, ctx))).toBe('a@09 b@08')
    const apart = { ...rows, [id('a')]: { ...rows[id('a')]!, slot: '2026-11-27T07,2026-11-27T14' } }
    expect(scheduledKey(apart[id('a')])).toBe('2026-11-27T07')
    expect(view(settleSchedule(apart, ctx)).startsWith('a@')).toBe(true)
  })

  it('a scheduled line dragged goes back to its place; one of the pad\'s own dropped in the section goes back to the end of its own', () => {
    const { ctx, rows: base, t, id } = table('a b c@09 d@10 e@11')
    const rows = settleSchedule(base, ctx)
    let next = moveNodes(rows, ctx, [id('e')], { parentId: t, afterId: null })
    expect(view(settleSchedule(next, ctx, rows))).toBe('a b c@09 d@10 e@11')
    next = moveNodes(rows, ctx, [id('a')], { parentId: t, afterId: id('d') })
    expect(view(settleSchedule(next, ctx, rows))).toBe('b a c@09 d@10 e@11')
  })

  it('lines in the same hour keep the order they are given', () => {
    const { ctx, rows: base, t, id } = table('x c@09 d@09')
    const rows = settleSchedule(base, ctx)
    const next = moveNodes(rows, ctx, [id('d')], { parentId: t, afterId: id('x') })
    expect(view(settleSchedule(next, ctx, rows))).toBe('x d@09 c@09')
  })

  it('a new line in the section takes the hour of the line above it; a sub item dedented does too', () => {
    const { ctx, rows: base, t, id } = table('a c@09 d@10')
    const rows = settleSchedule(base, ctx)
    const made = insertAt(rows, ctx, { parentId: t, afterId: id('c') }, 'new')
    expect(view(settleSchedule(made.rows, ctx, rows))).toBe('a c@09 new@09 d@10')
    const sub = insertAt(rows, ctx, { parentId: id('d'), afterId: null }, 'sub')
    const out = dedent(sub.rows, ctx, [sub.newId])
    expect(view(settleSchedule(out, ctx, sub.rows))).toBe('a c@09 d@10 sub@10')
    // Without the table before (a sync merge), a line with no hour is one of the pad's own.
    expect(view(settleSchedule(made.rows, ctx))).toBe('a new c@09 d@10')
  })

  it('a line whose hour is taken off goes back to the end of the pad\'s own, and one given an hour goes down', () => {
    const { ctx, rows: base, id } = table('a b c@09 d@10')
    const rows = settleSchedule(base, ctx)
    let next: Rows = { ...rows, [id('d')]: { ...rows[id('d')]!, slot: null } }
    expect(view(settleSchedule(next, ctx, rows))).toBe('a b d c@09')
    next = { ...rows, [id('a')]: { ...rows[id('a')]!, slot: '2026-11-27T12' } }
    expect(view(settleSchedule(next, ctx, rows))).toBe('b c@09 d@10 a@12')
  })

  it('a pinned line stays with the pins whatever its hour', () => {
    const { ctx, rows: base, id } = table('a b@09 c@08')
    const rows = settleSchedule(base, ctx)
    const pinned = settlePins(togglePinned(scopePad(rows, today(rows)), ctx, [id('b')]), ctx)
    const all = { ...rows, [id('b')]: { ...pinned[id('b')]!, parentId: today(rows) } }
    expect(view(settleSchedule(all, ctx, rows))).toBe('^b@09 a c@08')
  })

  it('leaves a line under another, and the other pads, alone', () => {
    const { ctx, rows: base, id } = table('a b')
    const sub = insertAt(base, ctx, { parentId: id('a'), afterId: null }, 'sub')
    const inbox = insertAt(sub.rows, ctx, { parentId: null, afterId: null }, 'in')
    const rows = { ...inbox.rows, [sub.newId]: { ...inbox.rows[sub.newId]!, slot: '2026-11-27T09' }, [inbox.newId]: { ...inbox.rows[inbox.newId]!, slot: '2026-11-27T09' } }
    expect(settleSchedule(rows, ctx)).toBe(rows)
  })
})

describe('scheduleHead', () => {
  it('is the first scheduled top-level row of the view, or null', () => {
    const { ctx, rows: base, id } = table('a b@09 c@10')
    const rows = settleSchedule(base, ctx)
    const shown = scopePad(rows, today(rows))
    expect(scheduleHead(flatten(buildIndex(shown), true), shown)).toBe(id('b'))
    const none = table('a b')
    const plain = scopePad(none.rows, none.t)
    expect(scheduleHead(flatten(buildIndex(plain), true), plain)).toBeNull()
  })
})

describe('isTodayPad', () => {
  it('knows Today from the Inbox and Later', () => {
    const { rows, t } = table('a')
    expect(isTodayPad(rows, t)).toBe(true)
    expect(isTodayPad(rows, null)).toBe(false)
    expect(isTodayPad(rows, findFixedPad(rows, 'Later')!.id)).toBe(false)
  })
})
