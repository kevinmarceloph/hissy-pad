// Where a drag lands. Pure: takes the visible rows with their on-screen boxes and the
// pointer, returns a Placement plus where to draw the indicator. Both the web and the
// mobile drag UIs call this, so the rules live in one place:
//
//   - the pointer's y picks a gap between two visible rows (by their midpoints)
//   - the pointer's x picks a depth, clamped to what the gap allows:
//       at least the depth of the row below (anything shallower would cut it off from its
//       parent), at most one deeper than the row above (become its child)
//   - rows being moved, and everything under them, are not anchors
import type { Rows } from './types'
import type { TreeIndex } from './tree'
import type { Placement } from './ops'

export interface LayoutRow {
  id: string
  depth: number
  top: number    // px, any consistent coordinate space
  height: number
}

export interface DropTarget {
  placement: Placement
  depth: number       // where the moved rows will sit
  indicatorY: number  // y of the gap, same space as LayoutRow.top
  gapIndex: number    // 0 = before the first anchor row
}

export interface DropInput {
  rows: Rows
  index: TreeIndex
  layout: readonly LayoutRow[] // visible rows in document order
  moving: ReadonlySet<string>  // topmost moved ids plus all their descendants
  pointerY: number
  pointerDepth: number // fractional depth from the pointer's x
}

export function resolveDrop(input: DropInput): DropTarget | null {
  const anchors = input.layout.filter((r) => !input.moving.has(r.id))
  let gap = 0
  while (gap < anchors.length && anchors[gap]!.top + anchors[gap]!.height / 2 < input.pointerY) gap++
  const prev = gap > 0 ? anchors[gap - 1]! : null
  const next = gap < anchors.length ? anchors[gap]! : null

  const maxDepth = prev ? prev.depth + 1 : 0
  const minDepth = next ? next.depth : 0
  const depth = Math.max(minDepth, Math.min(maxDepth, Math.round(input.pointerDepth)))

  let placement: Placement
  if (!prev) {
    placement = { parentId: null, afterId: null }
  } else if (depth === prev.depth + 1) {
    placement = { parentId: prev.id, afterId: null }
  } else {
    // The anchor row at this depth, at or above prev: the sibling we land after.
    let sib: LayoutRow | null = null
    for (let i = gap - 1; i >= 0; i--) {
      if (anchors[i]!.depth === depth) {
        sib = anchors[i]!
        break
      }
      if (anchors[i]!.depth < depth) break
    }
    if (!sib) return null
    placement = { parentId: input.index.parentOf.get(sib.id) ?? null, afterId: sib.id }
  }
  if (placement.parentId !== null && input.moving.has(placement.parentId)) return null

  const indicatorY = prev ? prev.top + prev.height : next ? next.top : 0
  return { placement, depth, indicatorY, gapIndex: gap }
}
