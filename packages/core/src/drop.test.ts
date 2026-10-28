import { describe, expect, it } from 'vitest'
import { buildIndex, descendantIds, flatten } from './tree'
import { resolveDrop, type LayoutRow } from './drop'
import { moveNodes } from './ops'
import { idOf, pad, shape, testCtx } from './testing'

const OUTLINE = `
A
  A1
  A2
    A2a
B
C
`
const ROW = 24

function layoutOf(rows: ReturnType<typeof pad>): LayoutRow[] {
  return flatten(buildIndex(rows), true).map((r, i) => ({ id: r.id, depth: r.depth, top: i * ROW, height: ROW }))
}

function movingSet(rows: ReturnType<typeof pad>, ids: string[]) {
  const index = buildIndex(rows)
  const set = new Set(ids)
  for (const id of ids) for (const d of descendantIds(index, id)) set.add(d)
  return set
}

function drop(rows: ReturnType<typeof pad>, ids: string[], pointerY: number, pointerDepth: number) {
  const index = buildIndex(rows)
  return resolveDrop({ rows, index, layout: layoutOf(rows), moving: movingSet(rows, ids), pointerY, pointerDepth })
}

describe('resolveDrop', () => {
  it('picks the gap by row midpoints and the depth by x', () => {
    const rows = pad(OUTLINE)
    const c = idOf(rows, 'C')
    // Above A (gap 0): only depth 0 is possible.
    let t = drop(rows, [c], 2, 3)!
    expect(t.placement).toEqual({ parentId: null, afterId: null })
    expect(t.depth).toBe(0)
    expect(t.indicatorY).toBe(0)
    // Between A and A1: depth 1 = first child of A.
    t = drop(rows, [c], ROW - 1, 1)!
    expect(t.placement).toEqual({ parentId: idOf(rows, 'A'), afterId: null })
    // Same gap but pointer far left: clamped up to A1's depth (1), never 0.
    t = drop(rows, [c], ROW - 1, 0)!
    expect(t.depth).toBe(1)
  })

  it('lets a row land after an ancestor of the row above at a shallower depth', () => {
    const rows = pad(OUTLINE)
    const c = idOf(rows, 'C')
    // Gap between A2a (depth 2) and B (depth 0): depths 0..3 allowed.
    const y = 4 * ROW - 1
    expect(drop(rows, [c], y, 3)!.placement).toEqual({ parentId: idOf(rows, 'A2a'), afterId: null })
    expect(drop(rows, [c], y, 2)!.placement).toEqual({ parentId: idOf(rows, 'A2'), afterId: idOf(rows, 'A2a') })
    expect(drop(rows, [c], y, 1)!.placement).toEqual({ parentId: idOf(rows, 'A'), afterId: idOf(rows, 'A2') })
    expect(drop(rows, [c], y, 0)!.placement).toEqual({ parentId: null, afterId: idOf(rows, 'A') })
    expect(drop(rows, [c], y, 9)!.depth).toBe(3)
  })

  it('ignores the moving subtree as an anchor and refuses to drop inside it', () => {
    const rows = pad(OUTLINE)
    const a = idOf(rows, 'A')
    // Dragging A (with A1, A2, A2a): the anchors are just B and C.
    const t = drop(rows, [a], ROW * 4.6, 0)! // below B's midpoint when A's rows are gone? layout keeps original tops
    expect(t.placement.afterId).toBe(idOf(rows, 'B'))
    expect(drop(rows, [a], ROW * 1.5, 1)!.placement).toEqual({ parentId: null, afterId: null })
  })

  it('applies through moveNodes and keeps multi-row order', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const b = idOf(rows, 'B')
    const c = idOf(rows, 'C')
    const t = drop(rows, [b, c], ROW - 1, 1)! // between A and A1, as children of A
    const out = moveNodes(rows, ctx, [b, c], t.placement)
    expect(shape(out)).toBe('A\n  B\n  C\n  A1\n  A2\n    A2a')
  })

  it('past the last row drops at the end, at any depth up to the last row + 1', () => {
    const rows = pad(OUTLINE)
    const a1 = idOf(rows, 'A1')
    const t = drop(rows, [a1], 999, 1)!
    expect(t.placement).toEqual({ parentId: idOf(rows, 'C'), afterId: null })
    expect(drop(rows, [a1], 999, 0)!.placement).toEqual({ parentId: null, afterId: idOf(rows, 'C') })
    expect(t.indicatorY).toBe(6 * ROW)
  })
})
