// Editing operations. Every op is pure: (rows, ctx, ...) => new rows, with only the touched
// rows replaced. Nothing here knows about React, the DOM, or sync; the sync engine just sees
// rows whose updatedAt advanced.
import { kindOf, type NodeKind, type NodeRow, type OpCtx, type Rows } from './types'
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
    collapsed: false,
    numbered,
    header: false,
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
export function insertAfter(rows: Rows, ctx: OpCtx, id: string, text = ''): { rows: Rows; newId: string } {
  const p = placementAfter(buildIndex(rows), id)
  return insertAt(rows, ctx, p, text, p.afterId === id && live(rows, id).numbered)
}

export function insertBefore(rows: Rows, ctx: OpCtx, id: string, text = ''): { rows: Rows; newId: string } {
  const index = buildIndex(rows)
  const parentId = index.parentOf.get(id) ?? null
  const sibs = childrenOf(index, parentId)
  const i = sibs.findIndex((s) => s.id === id)
  return insertAt(rows, ctx, { parentId, afterId: i > 0 ? sibs[i - 1]!.id : null }, text, live(rows, id).numbered)
}

// Capture: a new top-level node at the very top of the pad.
export function insertAtTop(rows: Rows, ctx: OpCtx, text = ''): { rows: Rows; newId: string } {
  return insertAt(rows, ctx, { parentId: null, afterId: null }, text)
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

export function setDone(rows: Rows, ctx: OpCtx, ids: Iterable<string>, done: boolean): Rows {
  let out = rows
  for (const id of ids) if (isLive(out[id]) && out[id]!.done !== done) out = patch(out, ctx, id, { done })
  return out
}

// Mixed selection: if every node is done, undo them all; otherwise mark them all done.
export function toggleDone(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const list = [...ids].filter((id) => isLive(rows[id]))
  const allDone = list.length > 0 && list.every((id) => rows[id]!.done)
  return setDone(rows, ctx, list, !allDone)
}

export function setNumbered(rows: Rows, ctx: OpCtx, ids: Iterable<string>, numbered: boolean): Rows {
  let out = rows
  for (const id of ids) if (isLive(out[id]) && out[id]!.numbered !== numbered) out = patch(out, ctx, id, { numbered, header: false })
  return out
}

// Switch lines between plain, numbered and header. The two flags never overlap.
export function setKind(rows: Rows, ctx: OpCtx, ids: Iterable<string>, kind: NodeKind): Rows {
  let out = rows
  for (const id of ids) {
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
// only if it was still inside at our timestamp (LWW per row decides).
export function remove(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const index = buildIndex(rows)
  const victims = new Set<string>()
  for (const id of topmost(index, ids)) {
    victims.add(id)
    for (const d of descendantIds(index, id)) victims.add(d)
  }
  let out = rows
  for (const id of victims) {
    const now = ctx.now()
    out = { ...out, [id]: { ...out[id]!, deletedAt: now, updatedAt: now } }
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
    if (prev.collapsed) out = setCollapsed(out, ctx, prev.id, false)
  }
  return out
}

// Shift+Tab: each node moves to just after its parent. Following siblings stay where they
// are (Google Docs behaviour), they do not become children of the outdented node.
export function dedent(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const index0 = buildIndex(rows)
  const moving = topmost(index0, ids)
  let out = rows
  const lastMovedFrom = new Map<string, string>() // old parent -> last node moved out of it
  for (const id of moving) {
    const parent = index0.parentOf.get(id) ?? null
    if (parent === null) continue
    const grand = index0.parentOf.get(parent) ?? null
    const afterId = lastMovedFrom.get(parent) ?? parent
    out = moveNodes(out, ctx, [id], { parentId: grand, afterId })
    lastMovedFrom.set(parent, id)
  }
  return out
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
      if (!anchor) continue
      const before = prevSiblingExcluding(index0, anchor.id, movingSet)
      out = moveNodes(out, ctx, group, { parentId, afterId: before?.id ?? null })
    } else {
      const anchor = nextSiblingExcluding(index0, group.at(-1)!, movingSet)
      if (!anchor) continue
      out = moveNodes(out, ctx, group, { parentId, afterId: anchor.id })
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
