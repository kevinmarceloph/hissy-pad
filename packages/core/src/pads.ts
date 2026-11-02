// Several pads in one table. The main pad is the root level, exactly as before. Any other
// pad is a root-level row with `pad: true`; everything under it is that pad's content.
// Nothing migrates when a second pad appears, and a build that does not know the flag
// still shows a pad as a heading with its lines under it.
//
// The app edits one pad at a time through a *scoped* view: the pad's rows with its
// direct children lifted to parentId null, so every op in ops.ts (indent, dedent,
// insert at top, Delete done, select all) works unchanged inside the pad. The store
// turns the changed rows back (parentId null -> the pad id) before saving them.
import type { NodeRow, OpCtx, Rows } from './types'
import { buildIndex, childrenOf, descendantIds, flatten, isLive, topmost } from './tree'
import { insertAt, moveNodes, type Placement } from './ops'

// null is the main pad (the root level).
export type PadId = string | null

export function isPadNode(r: NodeRow | undefined): r is NodeRow {
  return isLive(r) && r.pad && r.parentId === null
}

// The pads other than the main one, in root order. Each pad's name is its node's text.
export function listPads(all: Rows): NodeRow[] {
  return childrenOf(buildIndex(all), null).filter((r) => r.pad)
}

// Lifted copies are cached per source row, so the scoped view of an unchanged pad row
// is the same object each time it is derived (cheap re-renders, exact change diffs).
const lifted = new WeakMap<NodeRow, NodeRow>()
function lift(r: NodeRow): NodeRow {
  let l = lifted.get(r)
  if (!l) lifted.set(r, (l = { ...r, parentId: null }))
  return l
}

// The live rows of one pad as a pad of their own. For the main pad: every root row that
// is not a pad, with its subtree. For another pad: its subtree, children lifted to the
// root. Orphans (a parent missing or deleted, including a deleted pad) sit at the root of
// the main pad, as buildIndex already places them.
export function scopePad(all: Rows, padId: PadId): Rows {
  const index = buildIndex(all)
  const out: Record<string, NodeRow> = {}
  const take = (r: NodeRow) => {
    for (const id of descendantIds(index, r.id)) {
      const d = all[id]!
      // A row whose stored parent was repaired by buildIndex keeps its effective parent.
      const p = index.parentOf.get(id) ?? null
      out[id] = d.parentId === p ? d : { ...d, parentId: p }
    }
  }
  if (padId === null) {
    for (const r of childrenOf(index, null)) {
      if (r.pad) continue
      out[r.id] = r.parentId === null ? r : lift(r)
      take(r)
    }
  } else {
    if (!isPadNode(all[padId])) return {}
    for (const r of childrenOf(index, padId)) {
      out[r.id] = lift(r)
      take(r)
    }
  }
  return out
}

// A changed scoped row back in table terms: a root row of pad P has parentId P.
export function unscopeRow(r: NodeRow, padId: PadId): NodeRow {
  return padId !== null && r.parentId === null ? { ...r, parentId: padId } : r
}

// A new pad at the end of the root. Returns the new rows and the pad's id.
export function createPad(all: Rows, ctx: OpCtx, name: string): { rows: Rows; padId: string } {
  const last = childrenOf(buildIndex(all), null).at(-1)
  const res = insertAt(all, ctx, { parentId: null, afterId: last?.id ?? null }, name)
  const node = res.rows[res.newId]!
  return { rows: { ...res.rows, [node.id]: { ...node, pad: true } }, padId: node.id }
}

// Move lines (with their subtrees) to the top of another pad, keeping their order.
export function moveToPad(all: Rows, ctx: OpCtx, ids: Iterable<string>, padId: PadId): Rows {
  if (padId !== null && !isPadNode(all[padId])) return all
  const index = buildIndex(all)
  const moving = topmost(index, ids)
  if (moving.length === 0) return all
  return moveNodes(all, ctx, moving, { parentId: padId, afterId: null })
}

// ---- Fresh start -------------------------------------------------------------------
//
// Two panes: the pad as it is (left) and the fresh pad (right). Lines are sent across one
// at a time or as a block; a line follows its nearest ancestor that was sent explicitly,
// unless it was itself sent the other way. `right` and `left` hold the explicit choices.

export type Side = 'left' | 'right'

export interface Sides {
  right: ReadonlySet<string>
  left: ReadonlySet<string>
}

// Every row's side, resolved top-down over a scoped pad.
export function resolveSides(scoped: Rows, sides: Sides): Map<string, Side> {
  const index = buildIndex(scoped)
  const out = new Map<string, Side>()
  for (const r of flatten(index, false)) {
    const parent = index.parentOf.get(r.id) ?? null
    const inherited: Side = parent === null ? 'left' : out.get(parent)!
    out.set(r.id, sides.right.has(r.id) ? 'right' : sides.left.has(r.id) ? 'left' : inherited)
  }
  return out
}

// Send rows to a side: they become explicit there, and any explicit choice under them is
// cleared so the subtree follows.
export function sendTo(scoped: Rows, sides: Sides, ids: Iterable<string>, side: Side): Sides {
  const index = buildIndex(scoped)
  const right = new Set(sides.right)
  const left = new Set(sides.left)
  for (const id of ids) {
    if (!isLive(scoped[id])) continue
    for (const d of descendantIds(index, id)) {
      right.delete(d)
      left.delete(d)
    }
    right.delete(id)
    left.delete(id)
    ;(side === 'right' ? right : left).add(id)
  }
  return { right, left }
}

// One side of a split as a pad of its own: each row's depth is counted from its nearest
// ancestor on the same side, in document order.
export function sideRows(scoped: Rows, resolved: ReadonlyMap<string, Side>, side: Side): { id: string; depth: number; parentId: string | null }[] {
  const index = buildIndex(scoped)
  const out: { id: string; depth: number; parentId: string | null }[] = []
  const walk = (parentId: string | null, nearest: string | null, depth: number) => {
    for (const r of childrenOf(index, parentId)) {
      if (resolved.get(r.id) === side) {
        out.push({ id: r.id, depth, parentId: nearest })
        walk(r.id, r.id, depth + 1)
      } else {
        walk(r.id, nearest, depth)
      }
    }
  }
  walk(null, null, 0)
  return out
}

// Commit a fresh start on pad `padId`: the right side stays in the pad, the left side
// moves to a new pad named `archiveName`, each side keeping its order and rebuilt so a
// line hangs under its nearest ancestor on the same side. Returns the new rows, the
// archive pad's id and how many lines moved. A row whose parent does not change stays
// untouched, so the common case (a few top lines kept, the rest archived) writes only the
// archived roots and the new pad.
export function freshStart(
  all: Rows,
  ctx: OpCtx,
  padId: PadId,
  sides: Sides,
  archiveName: string,
): { rows: Rows; archiveId: string; moved: number } {
  const scoped = scopePad(all, padId)
  const resolved = resolveSides(scoped, sides)
  const made = createPad(all, ctx, archiveName)
  let out = made.rows
  const rootOf = (side: Side): PadId => (side === 'right' ? padId : made.padId)
  // The right side first: a kept line under an archived parent leaves before the parent
  // goes, so it never rides along into the archive.
  const lastUnder = new Map<string | null, string | null>() // new parent -> last row placed under it
  for (const side of ['right', 'left'] as const) {
    for (const r of sideRows(scoped, resolved, side)) {
      const parent = r.parentId ?? rootOf(side)
      const prev = lastUnder.get(parent) ?? null
      lastUnder.set(parent, r.id)
      if (out[r.id]!.parentId === parent) continue
      const p: Placement = { parentId: parent, afterId: prev }
      out = moveNodes(out, ctx, [r.id], p)
    }
  }
  const moved = descendantIds(buildIndex(out), made.padId).length
  return { rows: out, archiveId: made.padId, moved }
}
