import { describe, expect, it } from 'vitest'
import { dedent, indent, insertAfter, insertAtTop, insertBefore, moveNodes, moveSibling, moveToBottom, moveToTop } from './ops'
import { pinDivider, settlePins, togglePinned } from './pins'
import { buildIndex, flatten } from './tree'
import { idOf, pad, shape, testCtx } from './testing'
import type { Rows } from './types'

const ctx = testCtx()
function pinned(outline: string, ...texts: string[]): Rows {
  let rows = pad(outline, ctx)
  for (const t of [...texts].reverse()) rows = togglePinned(rows, ctx, [idOf(rows, t)])
  return rows
}

describe('pins', () => {
  it('pinning moves a top-level line to the very top; more pins keep their order', () => {
    let rows = pad('A\nB\nC\nD', ctx)
    rows = togglePinned(rows, ctx, [idOf(rows, 'C')])
    expect(shape(rows)).toBe('^C\nA\nB\nD')
    rows = togglePinned(rows, ctx, [idOf(rows, 'B'), idOf(rows, 'D')])
    expect(shape(rows)).toBe('^B\n^D\n^C\nA')
  })

  it('a sub item is not pinned', () => {
    const rows = pad('A\n  A1', ctx)
    expect(togglePinned(rows, ctx, [idOf(rows, 'A1')])).toBe(rows)
  })

  it('unpinning puts the line at the top of the unpinned area', () => {
    let rows = pinned('A\nB\nC\nD', 'A', 'B')
    expect(shape(rows)).toBe('^A\n^B\nC\nD')
    rows = togglePinned(rows, ctx, [idOf(rows, 'A')])
    expect(shape(rows)).toBe('^B\nA\nC\nD')
  })

  it('move to top stops under the pins; a pin moves to the top of the pins', () => {
    let rows = pinned('A\nB\nC\nD', 'A', 'B')
    rows = moveToTop(rows, ctx, [idOf(rows, 'D')])
    expect(shape(rows)).toBe('^A\n^B\nD\nC')
    rows = moveToTop(rows, ctx, [idOf(rows, 'B')])
    expect(shape(rows)).toBe('^B\n^A\nD\nC')
    // Already at the top of its area: nothing moves.
    expect(moveToTop(rows, ctx, [idOf(rows, 'D')])).toBe(rows)
  })

  it('move to bottom stops above the divider for a pin; an unpinned line goes to the end', () => {
    let rows = pinned('A\nB\nC\nD', 'A', 'B')
    rows = moveToBottom(rows, ctx, [idOf(rows, 'A')])
    expect(shape(rows)).toBe('^B\n^A\nC\nD')
    rows = moveToBottom(rows, ctx, [idOf(rows, 'C')])
    expect(shape(rows)).toBe('^B\n^A\nD\nC')
    // Already at the bottom of its area: nothing moves.
    expect(moveToBottom(rows, ctx, [idOf(rows, 'A')])).toBe(rows)
  })

  it('move up and down stay on their side of the divider', () => {
    let rows = pinned('A\nB\nC\nD', 'A', 'B')
    expect(moveSibling(rows, ctx, [idOf(rows, 'C')], 'up')).toBe(rows)
    expect(moveSibling(rows, ctx, [idOf(rows, 'B')], 'down')).toBe(rows)
    rows = moveSibling(rows, ctx, [idOf(rows, 'B')], 'up')
    expect(shape(rows)).toBe('^B\n^A\nC\nD')
  })

  it('a new line at the top goes under the pins; a line added next to a pin is a pin', () => {
    const rows = pinned('A\nB\nC', 'A', 'B')
    expect(shape(insertAtTop(rows, ctx, 'new').rows)).toBe('^A\n^B\nnew\nC')
    expect(shape(insertAfter(rows, ctx, idOf(rows, 'A'), 'next').rows)).toBe('^A\n^next\n^B\nC')
    expect(shape(insertBefore(rows, ctx, idOf(rows, 'A'), 'above').rows)).toBe('^above\n^A\n^B\nC')
  })

  it('outdenting out of a pinned line lands at the top of the unpinned area, unpinned', () => {
    const rows = pinned('A\n  A1\n  A2\nB\nC', 'A', 'B')
    expect(shape(rows)).toBe('^A\n  A1\n  A2\n^B\nC')
    const out = dedent(rows, ctx, [idOf(rows, 'A1'), idOf(rows, 'A2')])
    expect(shape(out)).toBe('^A\n^B\nA1\nA2\nC')
  })

  it('indenting a pin unpins it', () => {
    const rows = pinned('A\nB\nC', 'A', 'B')
    expect(shape(indent(rows, ctx, [idOf(rows, 'B')]))).toBe('^A\n  B\nC')
  })

  it('settlePins: a line dropped among the pins goes under them; a pin dropped below comes back up', () => {
    let rows = pinned('A\nB\nC\nD', 'A', 'B')
    let moved = moveNodes(rows, ctx, [idOf(rows, 'D')], { parentId: null, afterId: null })
    expect(shape(settlePins(moved, ctx, [idOf(rows, 'D')]))).toBe('^A\n^B\nD\nC')
    moved = moveNodes(rows, ctx, [idOf(rows, 'A')], { parentId: null, afterId: idOf(rows, 'D') })
    expect(shape(settlePins(moved, ctx))).toBe('^B\n^A\nC\nD')
    // Dropped under another line: no longer top-level, so no longer pinned.
    moved = moveNodes(rows, ctx, [idOf(rows, 'A')], { parentId: idOf(rows, 'C'), afterId: null })
    expect(shape(settlePins(moved, ctx, [idOf(rows, 'A')]))).toBe('^B\nC\n  A\nD')
    rows = settlePins(rows, ctx)
    expect(settlePins(rows, ctx)).toBe(rows)
  })

  it('settlePins keeps a pad\'s top-level pins in order and unpins a nested line', () => {
    let rows = pad('P\n  X\n  Y\n    Y1\nZ', ctx)
    const p = idOf(rows, 'P')
    const y = idOf(rows, 'Y')
    const y1 = idOf(rows, 'Y1')
    rows = { ...rows, [p]: { ...rows[p]!, pad: true }, [y]: { ...rows[y]!, pinned: true }, [y1]: { ...rows[y1]!, pinned: true } }
    expect(shape(settlePins(rows, ctx))).toBe('@P\n  ^Y\n    Y1\n  X\nZ')
  })

  it('pinDivider is after the pinned area, sub items included', () => {
    const rows = pinned('A\n  A1\nB\nC', 'A')
    expect(pinDivider(flatten(buildIndex(rows), true), rows)).toBe(idOf(rows, 'A1'))
    const plain = pad('A', ctx)
    expect(pinDivider(flatten(buildIndex(plain), true), plain)).toBeNull()
  })
})
