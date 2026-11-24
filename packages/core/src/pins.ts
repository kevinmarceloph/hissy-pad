// Pins: a pad's top-level lines can be pinned. Pinned lines sit first in their pad, above a
// divider, and the rest of the pad (the unpinned area) starts under it. Two rules keep it:
//
//   1. Only a pad's top-level line is pinned (its parent is a pad row, or the root).
//   2. Among a pad's top-level lines, every pinned one ranks before every unpinned one.
//
// The ops that move lines know the divider (ops.ts: move to top, move up and down, dedent,
// a new line at the top), so they never cross it. Anything else that breaks a rule (a drag,
// a paste, a line from another device) is put right by settlePins, which the store runs
// after every edit and every sync merge: a pinned line that left the top level is unpinned,
// and pinned lines below the divider go back up to the end of the pinned area, so an
// unpinned line dropped among the pins lands at the top of the unpinned area.
import type { NodeRow, OpCtx, Rows } from './types'
import { buildIndex, childrenOf, isLive, topmost, type FlatRow } from './tree'
import { lastPinned, moveNodes } from './ops'

function isPadRow(r: NodeRow | undefined): boolean {
  return isLive(r) && r.pad && r.parentId === null
}

// Keep the two rules over the whole table. `touched` limits the work to the sibling groups
// those rows are in and the ones under them (a commit passes the rows it changed); left out,
// every group is checked. Returns `all` itself when nothing needed fixing.
export function settlePins(all: Rows, ctx: OpCtx, touched?: Iterable<string>): Rows {
  const index = buildIndex(all)
  const groups = new Set<string | null>()
  if (touched) {
    for (const id of touched) {
      if (!isLive(all[id])) continue
      groups.add(index.parentOf.get(id) ?? null)
      groups.add(id)
    }
  } else {
    for (const k of index.children.keys()) groups.add(k)
  }
  let out = all
  for (const parent of groups) {
    const sibs = childrenOf(index, parent).filter((s) => !s.pad)
    if (sibs.length === 0) continue
    if (parent !== null && !isPadRow(all[parent])) {
      for (const s of sibs) if (s.pinned) out = { ...out, [s.id]: { ...out[s.id]!, pinned: false, updatedAt: ctx.now() } }
      continue
    }
    const first = sibs.findIndex((s) => !s.pinned)
    if (first < 0) continue
    const late = sibs.slice(first).filter((s) => s.pinned).map((s) => s.id)
    if (late.length === 0) continue
    out = moveNodes(out, ctx, late, { parentId: parent, afterId: first > 0 ? sibs[first - 1]!.id : null })
  }
  return out
}

// The pin toolbar action, on a pad as the store shows it (top level = parentId null). Pins
// the targets that are top-level lines and moves them to the very top of the pad, keeping
// their order; when every one of them is pinned already, unpins them instead, and they go
// to the top of the unpinned area, right under the divider.
export function togglePinned(rows: Rows, ctx: OpCtx, ids: Iterable<string>): Rows {
  const index = buildIndex(rows)
  const tops = topmost(index, ids).filter((id) => (index.parentOf.get(id) ?? null) === null && !rows[id]!.pad)
  if (tops.length === 0) return rows
  const pin = !tops.every((id) => rows[id]!.pinned)
  const now = ctx.now()
  let out: Rows = rows
  const flip = tops.filter((id) => rows[id]!.pinned !== pin)
  for (const id of flip) out = { ...out, [id]: { ...out[id]!, pinned: pin, updatedAt: now } }
  if (pin) return moveNodes(out, ctx, flip, { parentId: null, afterId: null })
  return moveNodes(out, ctx, tops, { parentId: null, afterId: lastPinned(out, null, new Set(tops)) })
}

// Where the divider goes: after the last row of the pinned area (a pinned line and what is
// shown under it), or null when the pad has no pins. `flat` is the rows as drawn.
export function pinDivider(flat: readonly FlatRow[], rows: Rows): string | null {
  let end: string | null = null
  for (const f of flat) {
    if (f.depth === 0 && !rows[f.id]?.pinned) break
    end = f.id
  }
  return end
}
