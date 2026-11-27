// Boomerang: a line sent out of the pads until a later day. It carries the day in `due`
// ('YYYY-MM-DD', no hour) and is kept, with everything under it, as a child of the Later pad
// row. No pad's own lines count it (padLines) and Sort never deals it (scopePad leaves out a
// row with `due`), but Later's view shows it (scopePad with `out`): under Later's own lines,
// grouped by day, as rows like any other, so they can be edited, nested and moved.
//
// What keeps the groups is the order of Later's top-level lines (settleBoomerangs): its own
// lines first, then the lines that are out, earliest day first. A line that is out keeps its
// day wherever it is dragged: it only moves within its day's group.
//
// When its day starts (at the hour a day starts at in Hours), the line comes back to the top
// of Later's own lines with `fresh` set, which the pad draws as a dot before the line, the way Things
// marks what turned up in Today. The dot goes when the line is next touched (the store
// clears `fresh` on any edit to the row) or the dot itself is pressed.
import type { NodeRow, OpCtx, Rows } from './types'
import { buildIndex, childrenOf, isLive, topmost, type FlatRow } from './tree'
import { lastPinned, moveNodes } from './ops'
import { createPad, findFixedPad } from './pads'

const DAY = /^\d{4}-\d{2}-\d{2}$/

// The day of a line that is out for good: a recurring item's template (repeat.ts). It never
// comes, and as the furthest day its group is the last under Later.
export const FOREVER = '9999-12-31'

export function isBoomeranged(r: NodeRow | undefined): r is NodeRow {
  return isLive(r) && !!r.due && !r.pad
}

// Send lines (each with what is under it) out until `due`. They go under Later, to the end
// of that day's group, out of their hour and off their pin; a line already out only changes
// its day (and so its group). Pad rows are never sent. Returns `all` itself for a day that is not one.
export function boomerang(all: Rows, ctx: OpCtx, ids: Iterable<string>, due: string): Rows {
  if (!DAY.test(due) || due === FOREVER) return all
  // A template stays where it is: it is out already, for good.
  const tops = topmost(buildIndex(all), ids).filter((id) => isLive(all[id]) && !all[id]!.pad && !all[id]!.repeat)
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
  return settleBoomerangs(out, ctx)
}

// Keep Later's lines in their groups. The rules, over Later's top-level lines:
//
//   1. Only a top-level line of Later is out: a line nested under another (or moved to
//      another pad) loses its `due` and rides with what it is under. A line that is out is
//      never pinned.
//   2. A line with no day that sits among the lines that are out joins the day of the line
//      above it, if it is new or came from inside a line that was out (Enter in a group, a
//      paste, a sub item dedented). `prev` is the table before the edit; without it (after
//      a sync merge) nothing joins.
//   3. Later's own lines rank first, then the lines that are out, earliest day first. A line
//      found out of place goes to the near edge of where it belongs: a line dragged out of
//      its day's group snaps back to that group's top or bottom, and one of Later's own
//      lines dropped among the groups goes back to the end of Later's own.
//
// The store runs it after every edit (in the same undo step) and every sync merge, as it
// does settlePins. Returns `all` itself when nothing needed fixing.
export function settleBoomerangs(all: Rows, ctx: OpCtx, prev?: Rows, touched?: Iterable<string>): Rows {
  const later = findFixedPad(all, 'Later')?.id
  let out = all
  // Rule 1.
  const check = touched ?? Object.keys(all)
  for (const id of check) {
    const r = out[id]
    if (!isLive(r) || !r.due) continue
    if (r.pad || !later || r.parentId !== later) out = { ...out, [id]: { ...r, due: null, updatedAt: ctx.now() } }
    else if (r.pinned) out = { ...out, [id]: { ...r, pinned: false, updatedAt: ctx.now() } }
  }
  if (!later) return out
  let sibs = childrenOf(buildIndex(out), later).filter((s) => !s.pad)
  if (!sibs.some((s) => s.due)) return out
  // Rule 2.
  if (prev) {
    let day: string | null = null
    for (const s of sibs) {
      if (s.due) day = s.due
      else if (day && day !== FOREVER && joins(prev, s.id, later)) out = { ...out, [s.id]: { ...out[s.id]!, due: day, pinned: false, slot: null, updatedAt: ctx.now() } }
    }
    sibs = sibs.map((s) => out[s.id]!)
  }
  // Rule 3.
  return keepGroups(out, ctx, later, sibs, (r) => r.due ?? '')
}

// Put the top-level lines of a pad in the order of their keys ('' first), moving as few as
// can be: the rows left where they are make a longest run already in order, and each of
// the others goes to the near edge of where it belongs. Today's Scheduled section is kept
// by it too (schedule.ts). Returns `all` itself when they are in order.
export function keepGroups(all: Rows, ctx: OpCtx, parent: string, sibs: readonly NodeRow[], key: (r: NodeRow) => string): Rows {
  let out = all
  if (sibs.every((s, i) => i === 0 || key(sibs[i - 1]!) <= key(s))) return out
  const best: number[] = []
  const from: number[] = []
  let end = 0
  sibs.forEach((s, i) => {
    best[i] = 1
    from[i] = -1
    for (let j = 0; j < i; j++) {
      if (key(sibs[j]!) <= key(s) && best[j]! + 1 > best[i]!) {
        best[i] = best[j]! + 1
        from[i] = j
      }
    }
    if (best[i]! > best[end]!) end = i
  })
  const kept = new Set<string>()
  for (let i = end; i >= 0; i = from[i]!) kept.add(sibs[i]!.id)
  const target = sibs.map((s, i) => ({ s, i })).sort((a, b) => (key(a.s) < key(b.s) ? -1 : key(a.s) > key(b.s) ? 1 : a.i - b.i))
  target.forEach(({ s }, at) => {
    if (!kept.has(s.id)) out = moveNodes(out, ctx, [s.id], { parentId: parent, afterId: at > 0 ? target[at - 1]!.s.id : null })
  })
  return out
}

// Rule 2's test: the row is new, or before the edit it was somewhere under a line that was
// out (`grouped`: a top-level line of the pad that is in a group).
export function joins(prev: Rows, id: string, later: string, grouped: (r: NodeRow) => boolean = (r) => !!r.due): boolean {
  let r = prev[id]
  if (!isLive(r)) return true
  if (r.parentId === later) return false
  for (let hops = 0; r && r.parentId !== null && hops < 1000; hops++) {
    const p: NodeRow | undefined = prev[r.parentId]
    if (!p) return false
    if (p.parentId === later) return grouped(p)
    r = p
  }
  return false
}

// Where a day's heading goes in Later's view: the id of the first top-level row of each
// group, with its day. `flat` is the rows as drawn.
export function dueHeads(flat: readonly Pick<FlatRow, 'id' | 'depth'>[], rows: Rows): Map<string, string> {
  const out = new Map<string, string>()
  let day: string | null = null
  for (const f of flat) {
    if (f.depth !== 0) continue
    const due = rows[f.id]?.due ?? null
    if (due && due !== day) out.set(f.id, due)
    day = due
  }
  return out
}

// Bring lines back to the top of Later's own lines now (under its pins), in the order given.
// `fresh` marks them as just arrived (a delivery); a line called back by hand needs no dot.
export function comeBack(all: Rows, ctx: OpCtx, ids: readonly string[], fresh = false): Rows {
  const back = ids.filter((id) => isBoomeranged(all[id]))
  if (back.length === 0) return all
  const later = findFixedPad(all, 'Later')?.id ?? null
  let out = moveNodes(all, ctx, back, { parentId: later, afterId: lastPinned(all, later, new Set(back)) })
  // A template called back is an ordinary line again: its rule goes with its day.
  for (const id of back) out = { ...out, [id]: { ...out[id]!, due: null, repeat: null, fresh, updatedAt: ctx.now() } }
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
// goes back to the top of Later's own lines, marked fresh: earlier days above later ones. Each row
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
  if (due === FOREVER) return 'Recurring'
  const [y = 1970, m = 1, d = 1] = due.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const [ty = 1970, tm = 1, td = 1] = today.split('-').map(Number)
  const next = new Date(ty, tm - 1, td + 1)
  if (date.getTime() === next.getTime()) return 'Tomorrow'
  if (due === today) return 'Today'
  return date.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', ...(y !== ty ? { year: 'numeric' } : {}) })
}
