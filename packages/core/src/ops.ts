// Editing operations. Every op is pure: (rows, ctx, ...) => new rows, with only the touched
// rows replaced. Nothing here knows about React, the DOM, or sync; the sync engine just sees
// rows whose updatedAt advanced.
import { kindOf, stateOf, type LineState, type NodeKind, type NodeRow, type OpCtx, type Rows } from './types'
import { between } from './rank'
import {
  allocateRanks,
  buildIndex,
  childrenOf,
  descendantIds,
  flatten,
  isAncestor,
  isLive,
  topmost,
  type TreeIndex,
} from './tree'

export interface Placement {
  parentId: string | null
  afterId: string | null // null = first among parentId's children
}

function live(rows: Rows, id: string): NodeRow {
  const r = rows[id]
  if (!isLive(r)) throw new Error(`ops: no live node ${id}`)
  return r
}

function patch(rows: Rows, ctx: OpCtx, id: string, changes: Partial<NodeRow>): Rows {
  const cur = live(rows, id)
  return { ...rows, [id]: { ...cur, ...changes, updatedAt: ctx.now() } }
}

function makeNode(ctx: OpCtx, parentId: string | null, rank: string, text: string, numbered = false): NodeRow {
  return {
    id: ctx.newId(),
    parentId,
    rank,
    text,
    done: false,
    doneAt: null,
    doing: false,
    collapsed: false,
    numbered,
    header: false,
    pad: false,
    slot: null,
    category: null,
    pinned: false,
    countHidden: false,
    due: null,
    fresh: false,
    updatedAt: ctx.now(),
    deletedAt: null,
  }
}

// n ranks that fit after `afterId` among `parentId`'s children, ignoring rows in `exclude`
// (the rows being moved, which may currently sit in that very gap). Siblings that collide
// with the gap are re-ranked in `rows` (see allocateRanks).
function gapRanks(
  rows: Rows,
  ctx: OpCtx,
  p: Placement,
  n: number,
  exclude: ReadonlySet<string> = new Set(),
): { rows: Rows; ranks: string[] } {
  const index = buildIndex(rows)
  const sibs = childrenOf(index, p.parentId).filter((s) => !exclude.has(s.id))
  const { ranks, fixes } = allocateRanks(sibs, p.afterId, n)
  let out = rows
  for (const f of fixes) out = patch(out, ctx, f.id, { rank: f.rank })
  return { rows: out, ranks }
}

// The last pinned line among `parentId`'s children, leaving out `exclude`: where an
// unpinned line goes to be at the top of the unpinned area (null: the very top).
export function lastPinned(rows: Rows, parentId: string | null, exclude: ReadonlySet<string> = new Set()): string | null {
  const sibs = childrenOf(buildIndex(rows), parentId)
  let last: string | null = null
  for (const s of sibs) if (s.pinned && !exclude.has(s.id)) last = s.id
  return last
}

// Where Enter puts a new node: first child when the node shows children, else next sibling.
export function placementAfter(index: TreeIndex, id: string): Placement {
  const row = index.children.get(index.parentOf.get(id) ?? null)?.find((r) => r.id === id)
  const kids = childrenOf(index, id)
  if (row && !row.collapsed && kids.length > 0) return { parentId: id, afterId: null }
  return { parentId: index.parentOf.get(id) ?? null, afterId: id }
}

export function insertAt(rows: Rows, ctx: OpCtx, p: Placement, text = '', numbered = false): { rows: Rows; newId: string } {
  const g = gapRanks(rows, ctx, p, 1)
  const node = makeNode(ctx, p.parentId, g.ranks[0]!, text, numbered)
  return { rows: { ...g.rows, [node.id]: node }, newId: node.id }
}

// A new sibling continues a numbered list; a new first child starts plain.
// A new sibling of a pinned line is pinned too (pins.ts), so it stays where it was made.
export function insertAfter(rows: Rows, ctx: OpCtx, id: string, text = ''): { rows: Rows; newId: string } {
  const p = placementAfter(buildIndex(rows), id)
  const res = insertAt(rows, ctx, p, text, p.afterId === id && live(rows, id).numbered)
  return p.afterId === id && live(rows, id).pinned ? pinNew(res) : res
}

function pinNew(res: { rows: Rows; newId: string }): { rows: Rows; newId: string } {
  return { rows: { ...res.rows, [res.newId]: { ...res.rows[res.newId]!, pinned: true } }, newId: res.newId }
}

export function insertBefore(rows: Rows, ctx: OpCtx, id: string, text = ''): { rows: Rows; newId: string } {
  const index = buildIndex(rows)
  const parentId = index.parentOf.get(id) ?? null
  const sibs = childrenOf(index, parentId)
  const i = sibs.findIndex((s) => s.id === id)
  const res = insertAt(rows, ctx, { parentId, afterId: i > 0 ? sibs[i - 1]!.id : null }, text, live(rows, id).numbered)
  return live(rows, id).pinned ? pinNew(res) : res
}

// Capture: a new top-level node at the top of the pad, under its pinned lines (pins.ts).
export function insertAtTop(rows: Rows, ctx: OpCtx, text = ''): { rows: Rows; newId: string } {
  return insertAt(rows, ctx, { parentId: null, afterId: lastPinned(rows, null) }, text)
}

// Enter mid-text: the head stays, the tail becomes the new node (placed per placementAfter).
export function splitNode(rows: Rows, ctx: OpCtx, id: string, caret: number): { rows: Rows; newId: string } {
  const row = live(rows, id)
  const head = row.text.slice(0, caret)
  const tail = row.text.slice(caret)
  const next = patch(rows, ctx, id, { text: head })
  return insertAfter(next, ctx, id, tail)
}

export function setText(rows: Rows, ctx: OpCtx, id: string, text: string): Rows {
  if (live(rows, id).text === text) return rows
  return patch(rows, ctx, id, { text })
}

// Crossing out stamps doneAt (what "Recently done" sorts by); un-doing clears it.
// `archived` lets it reach an archived line too, as Hours does: it still lists them.
export function setDone(rows: Rows, ctx: OpCtx, ids: Iterable<string>, done: boolean, archived = false): Rows {
  let out = rows
  for (const id of ids) {
    const r = out[id]
    if (!r || (!archived && !isLive(r)) || r.done === done) continue
    const now = ctx.now()
    out = { ...out, [id]: { ...out[id]!, done, doneAt: done ? now : null, doing: false, updatedAt: now } }
  }
  return out
}

// Put lines in one of the three states. Done goes through setDone (doneAt, doing cleared).
export function setState(rows: Rows, ctx: OpCtx, ids: Iterable<string>, state: LineState): Rows {
  const list = [...ids].filter((id) => isLive(rows[id]))
  if (state === 'done') return setDone(rows, ctx, list, true)
  let out = setDone(rows, ctx, list, false)
  const doing = state === 'doing'
  for (const id of list) if (out[id]!.doing !== doing) out = patch(out, ctx, id, { doing })
  return out
}

// The state a set of lines shares, or null when they differ (or there are none): the
// floating switch lights that side, and no side for a mixed set.
export function sharedState(rows: Rows, ids: Iterable<string>): LineState | null {
  const seen = new Set([...ids].filter((id) => isLive(rows[id])).map((id) => stateOf(rows[id]!)))
  return seen.size === 1 ? [...seen][0]! : null
}

// Give lines one of Hours' categories (its id), or take theirs away with null.
export function setCategory(rows: Rows, ctx: OpCtx, ids: Iterable<string>, category: string | null): Rows {
  let out = rows
  for (const id of ids) if (isLive(out[id]) && out[id]!.category !== category) out = patch(out, ctx, id, { category })
  return out
}

// Assign lines to an hour of a day in Hours (slot.ts), or take them out of it with null.
// `archived` lets it reach an archived line too (Hours' × on one it still lists).
export function setSlot(rows: Rows, ctx: OpCtx, ids: Iterable<string>, slot: string | null, archived = false): Rows {
  let out = rows
  for (const id of ids) {
    const r = out[id]
    if (!r || (!archived && !isLive(r)) || r.slot === slot) continue
    out = { ...out, [id]: { ...r, slot, updatedAt: ctx.now() } }
  }
  return out
}

// Mixed selection: if every node is done, undo them all; otherwise mark them all done.
export function toggleDone(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const list = [...ids].filter((id) => isLive(rows[id]))
  const allDone = list.length > 0 && list.every((id) => rows[id]!.done)
  return setDone(rows, ctx, list, !allDone)
}

// A list is numbered or not as a whole: numbering a line numbers the plain lines beside it
// (same parent), and un-numbering one un-numbers the numbered ones. Headers keep their look,
// and pad rows and lines sent out (due) are left alone.
function listMates(rows: Rows, ids: Iterable<string>, from: NodeKind): string[] {
  const out = new Set<string>()
  const parents = new Set<string | null>()
  for (const id of ids) {
    if (!isLive(rows[id])) continue
    out.add(id)
    parents.add(rows[id]!.parentId)
  }
  for (const r of Object.values(rows)) {
    if (!isLive(r) || r.pad || r.due || !parents.has(r.parentId)) continue
    if (kindOf(r) === from) out.add(r.id)
  }
  return [...out]
}

export function setNumbered(rows: Rows, ctx: OpCtx, ids: Iterable<string>, numbered: boolean): Rows {
  let out = rows
  for (const id of listMates(rows, ids, numbered ? 'plain' : 'numbered')) {
    if (out[id]!.numbered !== numbered) out = patch(out, ctx, id, { numbered, header: false })
  }
  return out
}

// Switch lines between plain, numbered and header. The two flags never overlap.
export function setKind(rows: Rows, ctx: OpCtx, ids: Iterable<string>, kind: NodeKind): Rows {
  let out = rows
  const list = [...ids]
  // Numbering spreads to the plain lines beside; going back to plain from numbered spreads too.
  const spread = kind === 'numbered' ? listMates(rows, list, 'plain')
    : kind === 'plain' && list.some((id) => isLive(rows[id]) && rows[id]!.numbered) ? listMates(rows, list, 'numbered')
    : list
  for (const id of spread) {
    if (!isLive(out[id]) || kindOf(out[id]!) === kind) continue
    out = patch(out, ctx, id, { numbered: kind === 'numbered', header: kind === 'header' })
  }
  return out
}

// Mixed selection: if every line is numbered, un-number them all; otherwise number them all.
export function toggleNumbered(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const list = [...ids].filter((id) => isLive(rows[id]))
  const all = list.length > 0 && list.every((id) => rows[id]!.numbered)
  return setNumbered(rows, ctx, list, !all)
}

export function setCollapsed(rows: Rows, ctx: OpCtx, id: string, collapsed: boolean): Rows {
  if (live(rows, id).collapsed === collapsed) return rows
  return patch(rows, ctx, id, { collapsed })
}

export function toggleCollapsed(rows: Rows, ctx: OpCtx, id: string): Rows {
  return setCollapsed(rows, ctx, id, !live(rows, id).collapsed)
}

// Tombstone the nodes and everything under them. Descendants get their own tombstone
// so another device that has moved one of them out in the meantime still sees it deleted
// only if it was still inside at our timestamp (LWW per row decides). One stamp for the
// whole call: that shared deletedAt is what groups the rows as one entry in the trash.
export function remove(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const index = buildIndex(rows)
  const victims = new Set<string>()
  for (const id of topmost(index, ids)) {
    victims.add(id)
    for (const d of descendantIds(index, id)) victims.add(d)
  }
  if (victims.size === 0) return rows
  const now = ctx.now()
  let out = rows
  for (const id of victims) out = { ...out, [id]: { ...out[id]!, deletedAt: now, updatedAt: now } }
  return out
}

// Lift the tombstone from exactly these rows (the caller decides which of a deleted
// subtree come back), stamped fresh so the restore syncs. A row whose parent stays
// deleted shows at the root, the way the tree already treats orphans.
export function restore(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  let out = rows
  const now = ctx.now()
  for (const id of ids) {
    const r = out[id]
    if (!r || r.deletedAt === null) continue
    out = { ...out, [id]: { ...r, deletedAt: null, updatedAt: now } }
  }
  return out
}

// Move a set of nodes (with their subtrees) to one spot, keeping their document order.
// Refused (rows returned unchanged) when the target is inside one of the moved subtrees.
export function moveNodes(rows: Rows, ctx: OpCtx, ids: Iterable<string>, p: Placement): Rows {
  const index = buildIndex(rows)
  const moving = topmost(index, ids)
  if (moving.length === 0) return rows
  const movingSet = new Set(moving)
  if (p.parentId !== null) {
    if (movingSet.has(p.parentId)) return rows
    for (const m of moving) if (isAncestor(index, m, p.parentId)) return rows
  }
  if (p.afterId !== null && movingSet.has(p.afterId)) return rows
  const g = gapRanks(rows, ctx, p, moving.length, movingSet)
  const ranks = g.ranks
  let out = g.rows
  moving.forEach((id, i) => {
    out = patch(out, ctx, id, { parentId: p.parentId, rank: ranks[i]! })
  })
  return out
}

function prevSiblingExcluding(index: TreeIndex, id: string, exclude: ReadonlySet<string>): NodeRow | null {
  const sibs = childrenOf(index, index.parentOf.get(id) ?? null)
  const i = sibs.findIndex((s) => s.id === id)
  for (let j = i - 1; j >= 0; j--) if (!exclude.has(sibs[j]!.id)) return sibs[j]!
  return null
}

function nextSiblingExcluding(index: TreeIndex, id: string, exclude: ReadonlySet<string>): NodeRow | null {
  const sibs = childrenOf(index, index.parentOf.get(id) ?? null)
  const i = sibs.findIndex((s) => s.id === id)
  for (let j = i + 1; j < sibs.length; j++) if (!exclude.has(sibs[j]!.id)) return sibs[j]!
  return null
}

// Tab: each node becomes the last child of the nearest unselected sibling above it.
// A run of selected siblings therefore lands under the same node, in order. The new
// parent is expanded so the moved nodes stay visible.
export function indent(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const index0 = buildIndex(rows)
  const moving = topmost(index0, ids)
  const movingSet = new Set(moving)
  let out = rows
  for (const id of moving) {
    const prev = prevSiblingExcluding(index0, id, movingSet)
    if (!prev) continue
    const index = buildIndex(out)
    const last = childrenOf(index, prev.id).at(-1)
    out = moveNodes(out, ctx, [id], { parentId: prev.id, afterId: last?.id ?? null })
    if (out[id]!.pinned) out = patch(out, ctx, id, { pinned: false }) // only a top-level line is pinned
    if (prev.collapsed) out = setCollapsed(out, ctx, prev.id, false)
  }
  return out
}

// Shift+Tab: each node moves to just after its parent. Following siblings stay where they
// are (Google Docs behaviour), they do not become children of the outdented node. Out of a
// pinned line, it goes to the top of the unpinned area instead (pins.ts): it is not pinned.
export function dedent(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const index0 = buildIndex(rows)
  const moving = topmost(index0, ids)
  let out = rows
  const lastMovedFrom = new Map<string, string>() // old parent -> last node moved out of it
  for (const id of moving) {
    const parent = index0.parentOf.get(id) ?? null
    if (parent === null) continue
    const grand = index0.parentOf.get(parent) ?? null
    const afterId = lastMovedFrom.get(parent) ?? (out[parent]!.pinned ? lastPinned(out, grand) : parent)
    out = moveNodes(out, ctx, [id], { parentId: grand, afterId })
    lastMovedFrom.set(parent, id)
    out = adoptLevelNumbering(out, ctx, id)
  }
  return out
}

// A line that came out to another level takes that level's numbering (Kevin, 2026-11-27):
// numbered when the line beside it there is numbered, plain when it is plain. The line
// beside it is the one before it, or after it when that one is a header (a header is never
// numbered, so it says nothing). A header itself stays as it is, and so does a line with
// no plain or numbered neighbour.
function adoptLevelNumbering(rows: Rows, ctx: OpCtx, id: string): Rows {
  const r = rows[id]
  if (!r || r.header) return rows
  const sibs = childrenOf(buildIndex(rows), r.parentId)
  const i = sibs.findIndex((x) => x.id === id)
  const beside = [sibs[i - 1], sibs[i + 1]].find((x) => x && !x.header && !x.pad)
  if (!beside || beside.numbered === r.numbered) return rows
  return patch(rows, ctx, id, { numbered: beside.numbered })
}

// Ungroup: each node's children come out to sit right after it, at its own level, in
// order; the node itself stays, now with nothing under it. Grandchildren keep their
// parents. Deeper nodes go first, so ungrouping a line and one of its children together
// flattens both levels.
export function ungroup(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const index0 = buildIndex(rows)
  const want = new Set(ids)
  const order = flatten(index0, false).map((r) => r.id).filter((id) => want.has(id)).reverse()
  let out = rows
  for (const id of order) {
    const index = buildIndex(out)
    const kids = childrenOf(index, id).map((r) => r.id)
    if (kids.length === 0) continue
    out = moveNodes(out, ctx, kids, { parentId: index.parentOf.get(id) ?? null, afterId: id })
  }
  return out
}

// Split off open: a copy of the line (same text, kind and category, not done, no hour)
// goes right after it and takes the open sub items, each with all it holds; the done sub
// items stay on the old line. A line without both done and open sub items is left alone.
// Returns the new lines' ids, one per line split.
export function splitOpen(rows: Rows, ctx: OpCtx, ids: Iterable<string>): { rows: Rows; newIds: string[] } {
  const index0 = buildIndex(rows)
  const order = flatten(index0, false).map((r) => r.id).filter((id) => new Set(ids).has(id)).reverse()
  let out = rows
  const newIds: string[] = []
  for (const id of order) {
    const index = buildIndex(out)
    const kids = childrenOf(index, id)
    const open = kids.filter((k) => !k.done).map((k) => k.id)
    if (open.length === 0 || open.length === kids.length) continue
    const row = live(out, id)
    const made = insertAt(out, ctx, { parentId: index.parentOf.get(id) ?? null, afterId: id }, row.text, row.numbered)
    out = patch(made.rows, ctx, made.newId, { header: row.header, category: row.category })
    out = moveNodes(out, ctx, open, { parentId: made.newId, afterId: null })
    newIds.unshift(made.newId)
  }
  return { rows: out, newIds }
}

// Alt+Up / Alt+Down: a selection moves as a block past the nearest unselected sibling.
// Nodes under different parents move within their own parent independently.
export function moveSibling(rows: Rows, ctx: OpCtx, ids: Iterable<string>, dir: 'up' | 'down'): Rows {
  const index0 = buildIndex(rows)
  const moving = topmost(index0, ids)
  const movingSet = new Set(moving)
  const byParent = new Map<string | null, string[]>()
  for (const id of moving) {
    const p = index0.parentOf.get(id) ?? null
    byParent.set(p, [...(byParent.get(p) ?? []), id])
  }
  let out = rows
  for (const [parentId, group] of byParent) {
    if (dir === 'up') {
      const anchor = prevSiblingExcluding(index0, group[0]!, movingSet)
      if (!anchor || anchor.pinned !== rows[group[0]!]!.pinned) continue // never across the pins' divider
      const before = prevSiblingExcluding(index0, anchor.id, movingSet)
      out = moveNodes(out, ctx, group, { parentId, afterId: before?.id ?? null })
    } else {
      const anchor = nextSiblingExcluding(index0, group.at(-1)!, movingSet)
      if (!anchor || anchor.pinned !== rows[group.at(-1)!]!.pinned) continue
      out = moveNodes(out, ctx, group, { parentId, afterId: anchor.id })
    }
  }
  return out
}

// Move to top: each target goes first among its siblings (a selection keeps its order).
// A group already at the top stays put. An unpinned line goes to the top of the unpinned
// area, under the pins; a pinned one to the top of the pins (pins.ts).
export function moveToTop(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const index0 = buildIndex(rows)
  const moving = topmost(index0, ids)
  const byParent = new Map<string | null, string[]>()
  for (const id of moving) {
    const p = index0.parentOf.get(id) ?? null
    byParent.set(p, [...(byParent.get(p) ?? []), id])
  }
  let out = rows
  for (const [parentId, group] of byParent) {
    for (const pinned of [true, false]) {
      const part = group.filter((id) => rows[id]!.pinned === pinned)
      if (part.length === 0) continue
      const prev = prevSiblingExcluding(buildIndex(out), part[0]!, new Set(part))
      if (!prev || prev.pinned !== pinned) continue
      const afterId = pinned ? null : lastPinned(out, parentId, new Set(part))
      out = moveNodes(out, ctx, part, { parentId, afterId })
    }
  }
  return out
}

// Move to bottom: each target goes last among its siblings (a selection keeps its order).
// A group already at the bottom stays put. A pinned line goes to the bottom of the pins,
// right above the divider; an unpinned one to the bottom of the level (pins.ts).
export function moveToBottom(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const index0 = buildIndex(rows)
  const moving = topmost(index0, ids)
  const byParent = new Map<string | null, string[]>()
  for (const id of moving) {
    const p = index0.parentOf.get(id) ?? null
    byParent.set(p, [...(byParent.get(p) ?? []), id])
  }
  let out = rows
  for (const [parentId, group] of byParent) {
    for (const pinned of [true, false]) {
      const part = group.filter((id) => rows[id]!.pinned === pinned)
      if (part.length === 0) continue
      const skip = new Set(part)
      const index = buildIndex(out)
      const next = nextSiblingExcluding(index, part.at(-1)!, skip)
      if (!next || next.pinned !== pinned) continue
      const last = childrenOf(index, parentId).filter((s) => !skip.has(s.id) && s.pinned === pinned).at(-1)!
      out = moveNodes(out, ctx, part, { parentId, afterId: last.id })
    }
  }
  return out
}

// Backspace at the start of a node: fold its text into the visible node above and delete
// it. Refused when the node still has children (deleting those by accident is the worst
// outcome for a scratchpad) or when there is nothing above.
export function mergeIntoPrev(
  rows: Rows,
  ctx: OpCtx,
  id: string,
): { rows: Rows; prevId: string; caret: number } | null {
  const index = buildIndex(rows)
  if (childrenOf(index, id).length > 0) return null
  const vis = flatten(index, true)
  const i = vis.findIndex((r) => r.id === id)
  if (i <= 0) return null
  const prevId = vis[i - 1]!.id
  const prev = live(rows, prevId)
  const me = live(rows, id)
  let out = patch(rows, ctx, prevId, { text: prev.text + me.text })
  out = remove(out, ctx, [id])
  return { rows: out, prevId, caret: prev.text.length }
}

// Delete every crossed-out line, with its subtree. Undo is the safety net.
export function removeDone(rows: Rows, ctx: OpCtx): Rows {
  const done = Object.values(rows).filter((r) => isLive(r) && r.done).map((r) => r.id)
  return done.length ? remove(rows, ctx, done) : rows
}

// Sweep: every done top-level node moves under a "Done" node at the bottom of the pad,
// created on first use. Children ride along, so a crossed-out heading takes its list.
export function sweepDone(rows: Rows, ctx: OpCtx, doneLabel = 'Done'): Rows {
  const index = buildIndex(rows)
  const roots = childrenOf(index, null)
  let bin = roots.find((r) => r.text === doneLabel && !r.done)
  let out = rows
  const done = roots.filter((r) => r.done && r.id !== bin?.id).map((r) => r.id)
  if (done.length === 0) return rows
  if (!bin) {
    const last = roots.at(-1)!
    const res = insertAt(out, ctx, { parentId: null, afterId: last.id }, doneLabel)
    out = res.rows
    bin = out[res.newId]!
    out = setCollapsed(out, ctx, bin.id, true)
  }
  const lastChild = childrenOf(buildIndex(out), bin.id).at(-1)
  return moveNodes(out, ctx, done, { parentId: bin.id, afterId: lastChild?.id ?? null })
}

// Re-export for callers that only import ops.
export { between }
