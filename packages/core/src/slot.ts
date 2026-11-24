// A line can be assigned to an hour of one day (NodeRow.slot), which is how the pad's
// items show up in Hours, or to a run of hours from there. The slot is a calendar day and
// hour in the device's local time, 'YYYY-MM-DDTHH', the same slot an hour's own row is
// stored under: never a day as drawn on a screen whose day starts at 6am. A run of hours
// adds how many: 'YYYY-MM-DDTHH+3' is that hour and the two after it, and may run past
// midnight into the next day. A single hour never carries '+1'.
import { sameRow, type NodeRow, type Rows } from './types'
import { buildIndex, childrenOf, isBlank, isLive } from './tree'
import { findFixedPad, listPads } from './pads'
import { between, ranksBetween } from './rank'

export const MAX_SLOT_HOURS = 24

export function slotKey(day: string, hour: number, hours = 1): string {
  const base = `${day}T${String(hour).padStart(2, '0')}`
  return hours > 1 ? `${base}+${Math.min(hours, MAX_SLOT_HOURS)}` : base
}

export function parseSlot(slot: string | null | undefined): { day: string; hour: number; hours: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(?:\+(\d{1,2}))?$/.exec(slot ?? '')
  if (!m) return null
  const hour = Number(m[2])
  const hours = m[3] === undefined ? 1 : Number(m[3])
  if (hour < 0 || hour > 23 || hours < 1 || hours > MAX_SLOT_HOURS) return null
  return { day: m[1]!, hour, hours }
}

// A day key moved by whole days, on the calendar (not by 24h, which a DST day breaks).
function addDays(day: string, n: number): string {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d + n)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Every single-hour slot a slot covers, in order: one for an hour, several for a run.
export function slotHours(slot: string | null | undefined): string[] {
  const p = parseSlot(slot)
  if (!p) return []
  const out: string[] = []
  for (let i = 0; i < p.hours; i++) {
    const h = p.hour + i
    out.push(slotKey(addDays(p.day, Math.floor(h / 24)), h % 24))
  }
  return out
}

// Whether a line's slot takes in one hour (a single-hour key, as Hours asks for its rows).
export function slotCovers(slot: string | null | undefined, hourKey: string): boolean {
  if (!slot) return false
  if (slot === hourKey) return true
  return slot.includes('+') && slotHours(slot).includes(hourKey)
}

export interface SlotCount {
  done: number
  open: number
}

// How many assigned lines are crossed out and how many are still open, per hour. Every pad
// counts, blank lines never do, and a line counts for itself only (not for what is under it).
// A line in a run of hours counts in each hour of it. An archived line still counts: it was
// planned for that hour, and archiving it from the pad does not take it out of the day.
export function slotCounts(all: Rows): Record<string, SlotCount> {
  const out: Record<string, SlotCount> = {}
  for (const id in all) {
    const r = all[id]!
    if (r.slot === null || isBlank(r) || r.pad) continue
    for (const key of slotHours(r.slot)) {
      const c = (out[key] ??= { done: 0, open: 0 })
      if (r.done) c.done++
      else c.open++
    }
  }
  return out
}

// How many lines were crossed out during each hour (by doneAt, device local time) beyond the
// ones assigned to that hour, which slotCounts already has. A line cleared or deleted since
// still counts: the work was done then. Blank lines and pad rows never count, nor a line
// crossed out before doneAt existed.
export function slotDoneExtra(all: Rows): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id in all) {
    const r = all[id]!
    if (!r.done || !r.doneAt || isBlank(r) || r.pad) continue
    const at = new Date(r.doneAt)
    if (Number.isNaN(at.getTime())) continue
    const key = slotKey(todayKey(at), at.getHours())
    if (slotCovers(r.slot, key)) continue
    // Nor one that sits under a line of that hour: the hour lists it there already.
    let up = r.parentId ? all[r.parentId] : undefined
    let inside = false
    for (let n = 0; up && n < 64 && !inside; n++) {
      inside = slotCovers(up.slot, key)
      up = up.parentId ? all[up.parentId] : undefined
    }
    if (inside) continue
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

// Where every live line stands in the whole table, as one number: pad order first (Today,
// the Inbox, Later, then the other pads as their tabs run), then down the pad as it reads.
// It is how an hour orders its lines, which may come from several pads (Kevin, 2026-11-25:
// an hour keeps no order of its own). Kept per table: the same rows give the same map.
const orders = new WeakMap<Rows, Map<string, number>>()
export function lineOrder(all: Rows): Map<string, number> {
  let order = orders.get(all)
  if (order) return order
  order = new Map()
  const index = buildIndex(all)
  let n = 0
  const walk = (parentId: string | null, root: boolean) => {
    for (const r of childrenOf(index, parentId)) {
      // The root holds the Inbox's lines and the pads' own rows, which are walked as pads.
      if (root && r.pad) continue
      order!.set(r.id, n++)
      walk(r.id, false)
    }
  }
  const today = findFixedPad(all, 'Today')
  const later = findFixedPad(all, 'Later')
  const fixed = new Set([today?.id, later?.id])
  if (today) walk(today.id, false)
  walk(null, true)
  if (later) walk(later.id, false)
  for (const p of listPads(all)) if (!fixed.has(p.id)) walk(p.id, false)
  orders.set(all, order)
  return order
}

// The lines in one hour (a single-hour key), a run of hours that takes it in included, in
// the order above. An archived line stays listed, as in slotCounts, after the live ones.
// `blank` keeps the empty ones too: the hour's view needs the line that is about to be typed.
export function slotLines(all: Rows, slot: string, blank = false): NodeRow[] {
  const list: NodeRow[] = []
  for (const id in all) {
    const r = all[id]!
    if (slotCovers(r.slot, slot) && (blank || !isBlank(r)) && !r.pad) list.push(r)
  }
  const order = lineOrder(all)
  const at = (r: NodeRow) => order.get(r.id) ?? Infinity
  return list.sort((a, b) => at(a) - at(b) || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) || (a.id < b.id ? -1 : 1))
}

// The lines an hour lists at its top level: the ones put in it, less any that sits under
// another line of the same hour, which shows it as one of its children instead.
export function slotTops(all: Rows, slot: string, blank = false): NodeRow[] {
  return slotLines(all, slot, blank).filter((r) => {
    let up = r.parentId ? all[r.parentId] : undefined
    for (let n = 0; up && n < 64; n++) {
      if (isLive(up) && !up.pad && (blank || !isBlank(up)) && slotCovers(up.slot, slot)) return false
      up = up.parentId ? all[up.parentId] : undefined
    }
    return true
  })
}

// An hour as a pad of its own: each top line, then everything under it, depth first.
// Folds are not kept: the hour shows the whole of what was put in it. An archived line
// stays listed with nothing under it.
export interface SlotRow {
  row: NodeRow
  depth: number
}
export function slotOutline(all: Rows, slot: string): SlotRow[] {
  const tops = slotTops(all, slot)
  if (tops.length === 0) return []
  const index = buildIndex(all)
  const out: SlotRow[] = []
  const walk = (row: NodeRow, depth: number) => {
    out.push({ row, depth })
    for (const child of childrenOf(index, row.id)) walk(child, depth + 1)
  }
  for (const top of tops) walk(top, 0)
  return out
}

// ---- an hour as a view of the store ----------------------------------------------------------
// The live lines of one hour as a pad of their own, the way scopePad and scopeNode make one
// (pads.ts): the hour's own lines (slotTops) at the root, each with everything under it.
// The store shows this while an hour is open, so the pad's own ops, keys and toolbar edit
// it (PLAN.md, "Hours joins the pad"). An archived line is not in a view; slotLines still
// lists it.
//
// The hour's lines come from different pads, so at the root each gets a rank made up for
// the view, in the hour's order. `homes` remembers where each one really is.
export interface SlotHome {
  parentId: string | null
  rank: string
}
export interface SlotView {
  rows: Rows
  homes: ReadonlyMap<string, SlotHome>
}

// A lifted line is the same object for as long as its row and its place in the hour are,
// so an unchanged hour redraws nothing.
const raised = new WeakMap<NodeRow, NodeRow>()
function raise(r: NodeRow, rank: string): NodeRow {
  let l = raised.get(r)
  if (!l || l.rank !== rank) raised.set(r, (l = { ...r, parentId: null, rank }))
  return l
}

export function scopeSlot(all: Rows, slot: string): SlotView {
  // Empty lines too: one just made is empty until it is typed in.
  const tops = slotTops(all, slot, true).filter((r) => isLive(r))
  const out: Record<string, NodeRow> = {}
  const homes = new Map<string, SlotHome>()
  if (tops.length === 0) return { rows: out, homes }
  const index = buildIndex(all)
  const ranks = ranksBetween(null, null, tops.length)
  tops.forEach((top, i) => {
    homes.set(top.id, { parentId: top.parentId, rank: top.rank })
    out[top.id] = raise(top, ranks[i]!)
    const take = (parentId: string) => {
      for (const child of childrenOf(index, parentId)) {
        // A row whose stored parent was repaired by buildIndex keeps its effective parent.
        out[child.id] = child.parentId === parentId ? child : { ...child, parentId }
        take(child.id)
      }
    }
    take(top.id)
  })
  return { rows: out, homes }
}

// The rows an op changed in an hour's view (`view`, as scopeSlot gave it), back in table terms:
//   - one of the hour's own lines still at the root goes back to its pad, where it was. A
//     move among them writes nothing: an hour keeps no order.
//   - a line moved out to the root joins the hour, and in its pad becomes the line after
//     the one it came out from under (the hour's line above it in the view).
//   - a line made at the root is new: it goes to the top of Today, in this hour. With no
//     Today yet, to the top of the pad given.
// Anything else (a line under another, one of the hour's own moved in under a line) is
// stored as the op left it. A row that ends up as the table has it is left out.
export function unscopeSlot(all: Rows, slot: string, view: SlotView, changed: readonly NodeRow[], fallbackPad: string | null = null): NodeRow[] {
  const { homes, rows } = view
  // The lowest rank among the live lines right under `parentId` that is above `after`.
  const nextRank = (parentId: string | null, after: string | null) => {
    let found: string | null = null
    for (const id in all) {
      const r = all[id]!
      if (isLive(r) && r.parentId === parentId && (after === null || r.rank > after) && (found === null || r.rank < found)) found = r.rank
    }
    return found
  }
  // New lines keep the order the view had them in, above what Today already holds.
  const made = changed.filter((r) => r.parentId === null && !homes.has(r.id) && !all[r.id])
  const into = findFixedPad(all, 'Today')?.id ?? fallbackPad
  let first = nextRank(into, null)
  const fresh = new Map<string, string>()
  for (const r of [...made].sort((a, b) => (a.rank < b.rank ? 1 : a.rank > b.rank ? -1 : 0))) {
    first = between(null, first)
    fresh.set(r.id, first)
  }
  // The hour's own line right above a rank at the root of the view.
  const above = (rank: string) => {
    let best: NodeRow | undefined
    for (const id of homes.keys()) {
      const top = rows[id]
      if (top && top.rank < rank && (!best || top.rank > best.rank)) best = top
    }
    return best
  }
  const out: NodeRow[] = []
  for (const r of changed) {
    let back = r
    if (r.parentId === null) {
      const home = homes.get(r.id)
      const stored = all[r.id]
      if (home) back = { ...r, parentId: home.parentId, rank: home.rank }
      else if (!stored) back = { ...r, parentId: into, rank: fresh.get(r.id)!, slot }
      else {
        const from = above(r.rank)
        const at = from && homes.get(from.id)
        back = at
          ? { ...r, parentId: at.parentId, rank: between(at.rank, nextRank(at.parentId, at.rank)), slot }
          : { ...r, parentId: stored.parentId, rank: stored.rank, slot }
      }
    }
    const was = all[r.id]
    if (was && sameRow({ ...back, updatedAt: was.updatedAt }, was)) continue
    out.push(back)
  }
  return out
}

// What an hour's row shows and counts: the line on top of its list, and its own lines,
// crossed out and open. Only the lines put in the hour count; what is under them is theirs
// (Kevin, 2026-11-25: a few items picked for the hour, done or not).
export function slotProgress(all: Rows, slot: string): { top: NodeRow | undefined; count: SlotCount } {
  const tops = slotTops(all, slot)
  const done = tops.filter((r) => r.done).length
  return { top: tops[0], count: { done, open: tops.length - done } }
}

function hourWord(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${hour < 12 ? 'am' : 'pm'}`
}

// "Mon 23 Nov, 2pm": how a line's hour reads in the pad; a run reads "Mon 23 Nov, 2pm-5pm",
// to the hour it ends at. `today` (a day key) turns its own day into "Today".
export function slotLabel(slot: string, today?: string): string {
  const p = parseSlot(slot)
  if (!p) return ''
  const [y = 1970, m = 1, d = 1] = p.day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const hour = p.hours > 1 ? `${hourWord(p.hour)}-${hourWord((p.hour + p.hours) % 24)}` : hourWord(p.hour)
  if (p.day === today) return `Today ${hour}`
  const day = date.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day}, ${hour}`
}

// Today's calendar day as a day key, device local time.
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
