// Boomerang: a line sent out of the pads until a later day. It carries the day in `due`
// ('YYYY-MM-DD', no hour) and is kept, with everything under it, as a child of the Later pad
// row, where no pad's view shows it (scopePad and padLines leave out a row with `due`).
// Later lists these under its own lines, grouped by day (boomerangGroups).
//
// When its day starts (at the hour a day starts at in Hours), the line comes back to the top
// of the Inbox with `fresh` set, which the pad draws as a dot before the line, the way Things
// marks what turned up in Today. The dot goes when the line is next touched (the store
// clears `fresh` on any edit to the row) or the dot itself is pressed.
import type { NodeRow, OpCtx, Rows } from './types'
import { buildIndex, childrenOf, isLive, topmost } from './tree'
import { lastPinned, moveNodes } from './ops'
import { createPad, findFixedPad } from './pads'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function isBoomeranged(r: NodeRow | undefined): r is NodeRow {
  return isLive(r) && !!r.due && !r.pad
}

// Send lines (each with what is under it) out until `due`. They go under Later, after
// everything there, out of their hour and off their pin; a line already out only changes
// its day. Pad rows are never sent. Returns `all` itself for a day that is not one.
export function boomerang(all: Rows, ctx: OpCtx, ids: Iterable<string>, due: string): Rows {
  if (!DAY.test(due)) return all
  const tops = topmost(buildIndex(all), ids).filter((id) => isLive(all[id]) && !all[id]!.pad)
  if (tops.length === 0) return all
  let out = all
  let later = findFixedPad(out, 'Later')?.id
  if (!later) {
    const made = createPad(out, ctx, 'Later')
    out = made.rows
    later = made.padId
  }
  const moving = tops.filter((id) => !out[id]!.due || out[id]!.parentId !== later)
  if (moving.length) {
    // After everything under Later, its own lines included: out of the way of the pad's ranks.
    const gone = new Set(moving)
    const last = childrenOf(buildIndex(out), later).filter((r) => !gone.has(r.id)).at(-1)
    out = moveNodes(out, ctx, moving, { parentId: later, afterId: last?.id ?? null })
  }
  for (const id of tops) {
    const r = out[id]!
    if (r.due === due && r.slot === null && !r.pinned && !r.fresh) continue
    out = { ...out, [id]: { ...r, due, slot: null, pinned: false, fresh: false, updatedAt: ctx.now() } }
  }
  return out
}

// Bring lines back to the top of the Inbox now (under its pins), in the order given. `fresh` marks them as
// just arrived (a delivery); a line called back by hand needs no dot.
export function comeBack(all: Rows, ctx: OpCtx, ids: readonly string[], fresh = false): Rows {
  const back = ids.filter((id) => isBoomeranged(all[id]))
  if (back.length === 0) return all
  let out = moveNodes(all, ctx, back, { parentId: null, afterId: lastPinned(all, null, new Set(back)) })
  for (const id of back) out = { ...out, [id]: { ...out[id]!, due: null, fresh, updatedAt: ctx.now() } }
  return out
}

// The boomeranged lines, earliest day first; within a day, as they sit under Later.
function byDay(all: Rows): NodeRow[] {
  const index = buildIndex(all)
  const place = new Map<string, number>()
  const out: NodeRow[] = []
  for (const id in all) {
    const r = all[id]!
    if (!isBoomeranged(r)) continue
    const sibs = childrenOf(index, index.parentOf.get(id) ?? null)
    place.set(id, sibs.findIndex((s) => s.id === id))
    out.push(r)
  }
  return out.sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : place.get(a.id)! - place.get(b.id)! || (a.id < b.id ? -1 : 1)))
}

export interface BoomerangGroup {
  due: string
  lines: NodeRow[]
}

// What Later shows under its own lines: the lines that are out, grouped by the day they
// come back.
export function boomerangGroups(all: Rows): BoomerangGroup[] {
  const out: BoomerangGroup[] = []
  for (const r of byDay(all)) {
    const last = out.at(-1)
    if (last && last.due === r.due) last.lines.push(r)
    else out.push({ due: r.due!, lines: [r] })
  }
  return out
}

// The moment a day starts, in the device's local time.
export function dayStartAt(day: string, start: number): Date {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  return new Date(y, m - 1, d, start)
}

// Every line whose day has come (`today` is the day that holds this moment, by the day start)
// goes back to the top of the Inbox, marked fresh: earlier days above later ones. Each row
// is stamped with the moment its day started, not with now, so every device that makes the
// delivery writes the same thing, and a device that wakes up days later never overwrites
// what was done to the line since. A row edited after that moment (it was sent out again
// for a day already under way) is stamped with now instead. Returns `all` itself when
// nothing was due.
export function deliverDue(all: Rows, ctx: OpCtx, today: string, start: number): Rows {
  const due = byDay(all).filter((r) => r.due! <= today)
  if (due.length === 0) return all
  let out = all
  // The last placed ends up on top, so the list is walked from its end.
  for (const r of due.reverse()) {
    const at = dayStartAt(r.due!, start).toISOString()
    const stamp = at > r.updatedAt ? at : ctx.now()
    out = comeBack(out, { ...ctx, now: () => stamp }, [r.id], true)
  }
  return out
}

// The dot goes: the line has been seen.
export function clearFresh(all: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  let out = all
  for (const id of ids) {
    const r = out[id]
    if (r && r.fresh) out = { ...out, [id]: { ...r, fresh: false, updatedAt: ctx.now() } }
  }
  return out
}

// A day as the section's heading and the toast say it: "Tomorrow", else "Fri, Nov 28"
// (with the year when it is not this one).
export function dueLabel(due: string, today: string): string {
  const [y = 1970, m = 1, d = 1] = due.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const [ty = 1970, tm = 1, td = 1] = today.split('-').map(Number)
  const next = new Date(ty, tm - 1, td + 1)
  if (date.getTime() === next.getTime()) return 'Tomorrow'
  if (due === today) return 'Today'
  return date.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', ...(y !== ty ? { year: 'numeric' } : {}) })
}
