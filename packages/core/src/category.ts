// A category as a view of the store (Kevin, 2026-11-27): every line in the category, from
// every pad, in groups by pad (Today, the Inbox, Later, then the other pads as their tabs
// run), each with the lines over it and everything under it, whatever category those are
// in. That is the point: a line in a category under one that is not, or the other way
// round, is seen here and can be put right. The store shows it the way it shows an open
// hour (scopeSlot in slot.ts), so the pad's own ops, keys and toolbar edit it.
//
// A line that is neither in the category, nor over one that is, nor under one, is left
// out, so a line in the view can have siblings the view does not hold. They stay where
// they are: a rank made between two lines of the view is a real rank in the pad.
import { sameRow, type NodeRow, type Rows } from './types'
import { buildIndex, childrenOf, isLive, type TreeIndex } from './tree'
import { findFixedPad, listPads, type PadId } from './pads'
import { between, ranksBetween } from './rank'
import type { SlotHome } from './slot'

// "No category" as a view: the lines that have none, with the lines over and under them
// (Kevin, 2026-11-27). It is asked for with this in place of a category's id, which is never
// one: ids are ten letters and digits.
export const NO_CATEGORY = '-'
const inCategory = (r: NodeRow, category: string) => (category === NO_CATEGORY ? r.category === null : r.category === category)

export interface CategoryView {
  rows: Rows
  // Where each top-level line of the view really is: its pad (as parentId) and its rank there.
  homes: ReadonlyMap<string, SlotHome>
  // The first top-level line of each pad's group, with the pad: where a heading is drawn.
  heads: ReadonlyMap<string, PadId>
}

// The pads in the order of their tabs: Today, the Inbox (null), Later, then the others.
function padOrder(all: Rows): PadId[] {
  const today = findFixedPad(all, 'Today')
  const later = findFixedPad(all, 'Later')
  const fixed = new Set([today?.id, later?.id])
  return [...(today ? [today.id] : []), null, ...(later ? [later.id] : []), ...listPads(all).filter((p) => !fixed.has(p.id)).map((p) => p.id)]
}

// The ids the view holds: the category's lines, the lines over them, the lines under them.
function held(all: Rows, index: TreeIndex, category: string): Set<string> {
  const keep = new Set<string>()
  const swept = new Set<string>()
  const under = (id: string) => {
    if (swept.has(id)) return
    swept.add(id)
    for (const c of childrenOf(index, id)) {
      keep.add(c.id)
      under(c.id)
    }
  }
  for (const id in all) {
    const r = all[id]!
    // A pad's own row carries the pad's category, not a line's.
    if (!isLive(r) || !inCategory(r, category) || (r.pad && r.parentId === null)) continue
    keep.add(id)
    let up = index.parentOf.get(id) ?? null
    // Up to its pad's row, which is not a line.
    for (let n = 0; up !== null && n < 64 && !(all[up]!.pad && all[up]!.parentId === null); n++) {
      keep.add(up)
      up = index.parentOf.get(up) ?? null
    }
  }
  // Everything under a line of the category, once the lines over them are in.
  for (const id of [...keep]) if (inCategory(all[id]!, category)) under(id)
  return keep
}

// A lifted line is the same object for as long as its row and its place in the view are,
// so an unchanged view redraws nothing.
const raised = new WeakMap<NodeRow, NodeRow>()
function raise(r: NodeRow, rank: string): NodeRow {
  let l = raised.get(r)
  if (!l || l.rank !== rank) raised.set(r, (l = { ...r, parentId: null, rank }))
  return l
}

const views = new WeakMap<Rows, Map<string, CategoryView>>()
export function scopeCategory(all: Rows, category: string): CategoryView {
  let byCat = views.get(all)
  if (!byCat) views.set(all, (byCat = new Map()))
  const had = byCat.get(category)
  if (had) return had
  const index = buildIndex(all)
  const keep = held(all, index, category)
  const tops: { row: NodeRow; pad: PadId }[] = []
  for (const pad of padOrder(all)) {
    for (const r of childrenOf(index, pad)) if (keep.has(r.id) && !(pad === null && r.pad)) tops.push({ row: r, pad })
  }
  const out: Record<string, NodeRow> = {}
  const homes = new Map<string, SlotHome>()
  const heads = new Map<string, PadId>()
  const ranks = ranksBetween(null, null, tops.length)
  let last: PadId | undefined
  tops.forEach(({ row, pad }, i) => {
    homes.set(row.id, { parentId: pad, rank: row.rank })
    if (pad !== last) heads.set(row.id, pad)
    last = pad
    out[row.id] = raise(row, ranks[i]!)
    const take = (parentId: string) => {
      for (const child of childrenOf(index, parentId)) {
        if (!keep.has(child.id)) continue
        // A row whose stored parent was repaired by buildIndex keeps its effective parent.
        out[child.id] = child.parentId === parentId ? child : { ...child, parentId }
        take(child.id)
      }
    }
    take(row.id)
  })
  const view: CategoryView = { rows: out, homes, heads }
  byCat.set(category, view)
  return view
}

// How many lines each category has, for the list that offers the views: the category's
// own lines only, blank ones and pads' rows left out. The lines with none are counted
// under NO_CATEGORY.
export function categoryCounts(all: Rows): Map<string, number> {
  const out = new Map<string, number>()
  for (const id in all) {
    const r = all[id]!
    if (!isLive(r) || (r.pad && r.parentId === null) || r.text.trim() === '') continue
    const key = r.category ?? NO_CATEGORY
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return out
}

// The rows an op changed in a category's view (`view`, as scopeCategory gave it), back in
// table terms:
//   - a top-level line the op left where it was goes back to its pad, where it was.
//   - a line that is at the top level somewhere else now (dragged there, moved out from
//     under a line, or new) becomes, in the table, the line after the top-level line above
//     it in the view, in that line's pad. A line of a pad dropped first in its own pad's
//     group goes before the line below it instead, and so does anything with no line
//     above it. In an empty view a new line goes to the top of `fallbackPad`.
//   - a new line that the view would not hold (not under a line of the category) takes the
//     category, so it stays where it was typed. In "No category" a new line has none, and stays.
//   - archiving a line archives the lines under it that the view left out, too.
// Anything else is stored as the op left it. A row that ends up as the table has it is left out.
export function unscopeCategory(all: Rows, category: string, view: CategoryView, changed: readonly NodeRow[], fallbackPad: PadId = null): NodeRow[] {
  const { homes, rows } = view
  const moving = new Set(changed.map((r) => r.id))
  // What the view holds after the op.
  const after: Record<string, NodeRow> = { ...rows }
  for (const r of changed) after[r.id] = r
  const still = (id: string) => {
    const now = after[id]
    return now !== undefined && now.parentId === null && now.deletedAt === null && now.rank === rows[id]!.rank
  }
  // The top-level line that stayed put right above a rank of the view, or right below it.
  const beside = (rank: string, dir: 'above' | 'below') => {
    let best: NodeRow | undefined
    for (const id of homes.keys()) {
      if (!still(id)) continue
      const top = rows[id]!
      if (dir === 'above' ? top.rank < rank && (!best || top.rank > best.rank) : top.rank > rank && (!best || top.rank < best.rank)) best = top
    }
    return best
  }
  // The nearest rank among the live lines right under `parentId`, past `from` one way or the
  // other, the lines being placed left out.
  const near = (parentId: string | null, from: string | null, dir: 'next' | 'prev') => {
    let found: string | null = null
    for (const id in all) {
      const r = all[id]!
      if (!isLive(r) || r.parentId !== parentId || moving.has(id)) continue
      if (dir === 'next' ? (from === null || r.rank > from) && (found === null || r.rank < found) : from !== null && r.rank < from && (found === null || r.rank > found)) found = r.rank
    }
    return found
  }
  // Several lines placed beside the same one keep the order the view had them in.
  const last = new Map<string, string>()
  const place = (r: NodeRow): SlotHome => {
    const above = beside(r.rank, 'above')
    const below = beside(r.rank, 'below')
    const own = homes.get(r.id)?.parentId
    const up = above && homes.get(above.id)!
    const down = below && homes.get(below.id)!
    if (up && !(own !== undefined && down && down.parentId === own && up.parentId !== own)) {
      const rank = between(last.get(above.id) ?? up.rank, near(up.parentId, up.rank, 'next'))
      last.set(above.id, rank)
      return { parentId: up.parentId, rank }
    }
    if (down) {
      const rank = between(last.get(`<${below.id}`) ?? near(down.parentId, down.rank, 'prev'), down.rank)
      last.set(`<${below.id}`, rank)
      return { parentId: down.parentId, rank }
    }
    const stored = all[r.id]
    if (own !== undefined) return homes.get(r.id)!
    if (stored) return { parentId: stored.parentId, rank: stored.rank }
    const rank = between(last.get('') ?? null, near(fallbackPad, null, 'next'))
    last.set('', rank)
    return { parentId: fallbackPad, rank }
  }
  // Whether the view holds a row for a line of the category over it (or for itself).
  const covered = (r: NodeRow) => {
    let up: NodeRow | undefined = r
    for (let n = 0; up && n < 64; n++) {
      if (inCategory(up, category)) return true
      up = up.parentId ? after[up.parentId] : undefined
    }
    return false
  }
  const out: NodeRow[] = []
  let index: TreeIndex | null = null
  for (const r of [...changed].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))) {
    let back = r
    const was = all[r.id]
    if (r.parentId === null) {
      const home = homes.get(r.id)
      back = home && r.rank === rows[r.id]!.rank ? { ...r, parentId: home.parentId, rank: home.rank } : { ...r, ...place(r) }
    }
    if (!was && back.category === null && !covered(r)) back = { ...back, category }
    if (was && sameRow({ ...back, updatedAt: was.updatedAt }, was)) continue
    out.push(back)
    // Archived here: the lines under it that the view did not hold go with it.
    if (was && was.deletedAt === null && back.deletedAt !== null) {
      index ??= buildIndex(all)
      const sweep = (id: string) => {
        for (const c of childrenOf(index!, id)) {
          if (!(c.id in rows)) out.push({ ...c, deletedAt: back.deletedAt, updatedAt: back.updatedAt })
          if (!(c.id in rows) || !moving.has(c.id)) sweep(c.id)
        }
      }
      sweep(r.id)
    }
  }
  return out
}
