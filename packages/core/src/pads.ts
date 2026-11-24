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
import { buildIndex, childrenOf, countLines, descendantIds, flatten, isBlank, isLive, topmost, type TreeIndex } from './tree'
import { insertAt, moveNodes, remove, type Placement } from './ops'

// null is the main pad (the root level).
export type PadId = string | null

export function isPadNode(r: NodeRow | undefined): r is NodeRow {
  return isLive(r) && r.pad && r.parentId === null
}

// A sub-pad is a header line at the top level of a pad (main included). It is not stored
// as anything more than that: making a top-level line a header makes it a sub-pad, and
// its sub items are the sub-pad's lines. Lines can be sent to it and the pad switcher can
// jump to it, but it is still shown as a header inside its pad.
export function isSubPad(all: Rows, r: NodeRow | undefined): boolean {
  return isLive(r) && r.header && !r.pad && (r.parentId === null || isPadNode(all[r.parentId]))
}

export function listSubPads(index: TreeIndex, padId: PadId): NodeRow[] {
  return childrenOf(index, padId).filter((r) => r.header && !r.pad)
}

// A place lines can be sent to: a pad (null is main), or one of its sub-pads.
export interface Place {
  padId: PadId
  subId: string | null
}

export const MAIN_PLACE: Place = { padId: null, subId: null }

// The place a row id names: a pad node, or a sub-pad. null for anything else.
export function placeOf(all: Rows, id: string): Place | null {
  const r = all[id]
  if (!r) return null
  if (isSubPad(all, r)) return { padId: r.parentId, subId: id }
  return isPadNode(r) ? { padId: id, subId: null } : null
}

// True while the place is still there (a pad can be deleted, a header turned back).
export function isPlace(all: Rows, place: Place): boolean {
  if (place.padId !== null && !isPadNode(all[place.padId])) return false
  return place.subId === null || (isSubPad(all, all[place.subId]) && all[place.subId]!.parentId === place.padId)
}

// The pads other than the main one, in root order. Each pad's name is its node's text.
export function listPads(all: Rows): NodeRow[] {
  return childrenOf(buildIndex(all), null).filter((r) => r.pad)
}

// A pad's top-level lines that hold something: text, or sub items under a blank line.
// Blank spacers are left out (the counting rule, see isBlank). `open` also leaves out
// crossed-out lines: that is the list the Sort queue, the widgets and the watch show.
export function padLines(index: TreeIndex, padId: PadId, open = false): NodeRow[] {
  return childrenOf(index, padId).filter((r) => !r.pad && !(open && r.done) && (!isBlank(r) || childrenOf(index, r.id).length > 0))
}

// The number each pad shows: its open top-level lines. Main is under the key null.
export function padCounts(all: Rows): Map<PadId, number> {
  const index = buildIndex(all)
  const out = new Map<PadId, number>([[null, padLines(index, null, true).length]])
  for (const p of listPads(all)) out.set(p.id, padLines(index, p.id, true).length)
  return out
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

// Turn a line into a pad of its own: it goes to the end of the root with the flag set,
// its text (on one line) is the pad's name and everything under it is the pad's content.
// Line-only marks (crossed out, numbered, header, folded) are dropped. Refused for a pad
// node or a missing row. Returns the new rows and the pad's name.
export function lineToPad(all: Rows, ctx: OpCtx, id: string): { rows: Rows; name: string } | null {
  const row = all[id]
  if (!isLive(row) || (row.pad && row.parentId === null)) return null
  const last = childrenOf(buildIndex(all), null).filter((r) => r.id !== id).at(-1)
  const moved = moveNodes(all, ctx, [id], { parentId: null, afterId: last?.id ?? null })
  const name = row.text.replace(/\s*\n\s*/g, ' ').trim() || 'Untitled pad'
  const node = moved[id]!
  const pad: NodeRow = { ...node, parentId: null, text: name, pad: true, done: false, doneAt: null, numbered: false, header: false, collapsed: false, updatedAt: ctx.now() }
  return { rows: { ...moved, [id]: pad }, name }
}

// The opposite of lineToPad: fold a pad back into another place (a pad or a sub-pad) as a
// line at its top. The pad's name is the line's text and its lines become the sub items. Only
// that one row is written. Refused for a row that is not a pad, or a target that is the
// pad itself, one of its own sub-pads, or gone.
export function padToLine(all: Rows, ctx: OpCtx, padId: string, into: Place): Rows | null {
  if (!isPadNode(all[padId]) || into.padId === padId || !isPlace(all, into)) return null
  const parentId = into.subId ?? into.padId
  const moved = moveNodes(all, ctx, [padId], { parentId, afterId: null })
  return { ...moved, [padId]: { ...moved[padId]!, parentId, pad: false, updatedAt: ctx.now() } }
}

// ---- Fixed pads ----------------------------------------------------------------------
//
// Since 2026-11-24 the tabs start with three pads that are always there and never move:
// Today, Inbox, Later. Each is an ordinary pad row found by its name (the first one in root
// order, so every device picks the same), and the root level is no longer shown as a pad of
// its own: whatever lands there (Main's lines from before, a line added to Main by the watch
// or an older build, an orphan) is moved to the top of Inbox.

export const FIXED_PADS = ['Today', 'Inbox', 'Later'] as const
export type FixedPad = (typeof FIXED_PADS)[number]

const nameKey = (s: string) => s.trim().toLowerCase()

// Which fixed pad a row is, or null for any other row (or a later pad of the same name).
export function fixedPadOf(all: Rows, id: string | null): FixedPad | null {
  if (id === null || !isPadNode(all[id])) return null
  const name = FIXED_PADS.find((n) => nameKey(n) === nameKey(all[id]!.text))
  return name && findFixedPad(all, name)?.id === id ? name : null
}

export function findFixedPad(all: Rows, name: FixedPad): NodeRow | undefined {
  return listPads(all).find((p) => nameKey(p.text) === nameKey(name))
}

// Bring the table in line with the rule above, in one pass: make each fixed pad that is
// missing, fold a second pad of the same name into the first (its lines go to the bottom,
// the extra pad row is deleted), and move the root's lines to the top of Inbox. Returns
// `all` itself when there was nothing to do.
export function settleFixedPads(all: Rows, ctx: OpCtx): Rows {
  let out = all
  for (const name of FIXED_PADS) {
    const same = listPads(out).filter((p) => nameKey(p.text) === nameKey(name))
    if (same.length === 0) {
      out = createPad(out, ctx, name).rows
      continue
    }
    const [keep, ...extra] = same
    for (const dup of extra) {
      const index = buildIndex(out)
      const lines = childrenOf(index, dup.id).map((r) => r.id)
      if (lines.length) out = moveNodes(out, ctx, lines, { parentId: keep!.id, afterId: childrenOf(index, keep!.id).at(-1)?.id ?? null })
      out = remove(out, ctx, [dup.id])
    }
  }
  const inbox = findFixedPad(out, 'Inbox')!
  const loose = childrenOf(buildIndex(out), null).filter((r) => !r.pad).map((r) => r.id)
  if (loose.length) out = moveNodes(out, ctx, loose, { parentId: inbox.id, afterId: null })
  return out
}

// Move a pad one place left (-1) or right (1) among the pads. The fixed pads are always
// first and are not in this order. Only the moved pad's rank changes.
export function movePad(all: Rows, ctx: OpCtx, padId: string, dir: -1 | 1): Rows {
  const root = childrenOf(buildIndex(all), null)
  // The fixed pads keep their places at the front of the tabs, wherever their rows sit.
  const pads = root.filter((r) => r.pad && fixedPadOf(all, r.id) === null)
  const i = pads.findIndex((r) => r.id === padId)
  const other = pads[i + dir]
  if (i < 0 || !other) return all
  if (dir === 1) return moveNodes(all, ctx, [padId], { parentId: null, afterId: other.id })
  const before = root.filter((r) => r.id !== padId)
  const j = before.findIndex((r) => r.id === other.id)
  return moveNodes(all, ctx, [padId], { parentId: null, afterId: before[j - 1]?.id ?? null })
}

// Move lines (with their subtrees) to the top of another pad, keeping their order.
export function moveToPad(all: Rows, ctx: OpCtx, ids: Iterable<string>, padId: PadId): Rows {
  return moveToPlace(all, ctx, ids, { padId, subId: null })
}

// The same for any place: the lines go to the top of the pad, or to the top of the
// sub-pad's own lines. A sub-pad is never moved into itself.
export function moveToPlace(all: Rows, ctx: OpCtx, ids: Iterable<string>, place: Place): Rows {
  if (!isPlace(all, place)) return all
  const index = buildIndex(all)
  const moving = topmost(index, ids).filter((id) => id !== place.subId)
  if (moving.length === 0) return all
  return moveNodes(all, ctx, moving, { parentId: place.subId ?? place.padId, afterId: null })
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
// archive pad's id and how many lines moved (blank ones not counted). A row whose parent does not change stays
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
  const moved = countLines(descendantIds(buildIndex(out), made.padId).map((id) => out[id]))
  return { rows: out, archiveId: made.padId, moved }
}
