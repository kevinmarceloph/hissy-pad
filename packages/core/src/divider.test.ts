// Section dividers: a kind of line that holds nothing and is not an item.
import { describe, expect, it } from 'vitest'
import { indent, mergeIntoPrev, moveNodes, setKind, setState, toggleDone, toggleNumbered } from './ops'
import { insertOutline, parseOutline, toOutline, toOutlineHtml } from './paste'
import { resolveDrop } from './drop'
import { buildIndex, countLines, flatten } from './tree'
import { padCounts } from './pads'
import { kindOf, normalizeRow } from './types'
import { fromWire, toWire } from './sync/wire'
import { idOf, pad, shape, testCtx } from './testing'

describe('section dividers', () => {
  it('converting a line kicks its sub items out to its own level, right after it', () => {
    const ctx = testCtx()
    let rows = pad('A\nB\n  B1\n    B1a\n  B2\nC', ctx)
    rows = setKind(rows, ctx, [idOf(rows, 'B')], 'divider')
    expect(shape(rows)).toBe('A\n=B\nB1\n  B1a\nB2\nC')
    expect(kindOf(rows[idOf(rows, 'B')]!)).toBe('divider')
  })

  it('a done, folded or numbered line becomes an open, unfolded divider, and goes back to a plain line', () => {
    const ctx = testCtx()
    let rows = pad('1. A\n2. B\n  B1', ctx)
    const b = idOf(rows, 'B')
    rows = toggleDone(rows, ctx, [b])
    rows = setKind(rows, ctx, [b], 'divider')
    expect(rows[b]).toMatchObject({ divider: true, numbered: false, header: false, done: false, doneAt: null, collapsed: false })
    rows = setKind(rows, ctx, [b], 'header')
    expect(rows[b]).toMatchObject({ divider: false, header: true })
    rows = setKind(rows, ctx, [b], 'divider')
    rows = toggleNumbered(rows, ctx, [b])
    expect(rows[b]).toMatchObject({ divider: false, numbered: true })
  })

  it('is never done or doing', () => {
    const ctx = testCtx()
    let rows = pad('--- Part one\nA', ctx)
    const d = idOf(rows, 'Part one')
    rows = toggleDone(rows, ctx, [d, idOf(rows, 'A')])
    expect(shape(rows)).toBe('=Part one\n~A')
    rows = setState(rows, ctx, [d], 'doing')
    expect(rows[d]).toMatchObject({ done: false, doing: false })
  })

  it('takes no lines: the line under it does not indent, and nothing is moved or dropped into it', () => {
    const ctx = testCtx()
    const rows = pad('A\n---\nB\nC', ctx)
    const [b, c] = [idOf(rows, 'B'), idOf(rows, 'C')]
    const d = flatten(buildIndex(rows), false)[1]!.id
    expect(indent(rows, ctx, [b])).toBe(rows)
    expect(indent(rows, ctx, [b, c])).toBe(rows)
    expect(shape(indent(rows, ctx, [c]))).toBe('A\n=\nB\n  C') // under B, a line: fine
    expect(moveNodes(rows, ctx, [c], { parentId: d, afterId: null })).toBe(rows)
    // Dragged far to the right in the gap under the divider: still its sibling.
    const layout = flatten(buildIndex(rows), true).map((r, i) => ({ id: r.id, depth: r.depth, top: i * 24, height: 24 }))
    const target = resolveDrop({ rows, index: buildIndex(rows), layout, moving: new Set([c]), pointerY: 48, pointerDepth: 3 })
    expect(target).toMatchObject({ depth: 0, placement: { parentId: null, afterId: d } })
  })

  it('is not folded into the line above by Backspace', () => {
    const ctx = testCtx()
    const rows = pad('A\n--- Part', ctx)
    expect(mergeIntoPrev(rows, ctx, idOf(rows, 'Part'))).toBeNull()
  })

  it('is not counted', () => {
    const rows = pad('A\n--- Part\nB\n---')
    expect(countLines(Object.values(rows))).toBe(2)
    expect(padCounts(rows).get(null)).toBe(2)
  })

  it('reads and writes as a rule in an outline, and a line indented under one comes out beside it', () => {
    expect(parseOutline('---\n--- Part one ---\n— Two\n----\n- --- not one')).toEqual([
      { text: '', depth: 0, divider: true },
      { text: 'Part one', depth: 0, divider: true },
      { text: 'Two', depth: 0, divider: true },
      { text: '', depth: 0, divider: true },
      { text: '--- not one', depth: 0 },
    ])
    const ctx = testCtx()
    const rows = insertOutline({}, ctx, parseOutline('A\n  --- Part\n    B\n      B1\n  C\n---'), { parentId: null, afterId: null }).rows
    expect(shape(rows)).toBe('A\n  =Part\n  B\n    B1\n  C\n=')
    const all = flatten(buildIndex(rows), false).filter((r) => r.depth === 0).map((r) => r.id)
    expect(toOutline(rows, all)).toBe('- A\n  --- Part ---\n  - B\n    - B1\n  - C\n---')
    expect(shape(pad(toOutline(rows, all)))).toBe(shape(rows))
    expect(toOutlineHtml(rows, all)).toContain('<li>--- Part ---</li>')
  })

  it('travels on the wire, and a row from an older build is not one', () => {
    const rows = pad('--- Part')
    const row = rows[idOf(rows, 'Part')]!
    expect(toWire(row).divider).toBe(true)
    expect(fromWire(toWire(row)).row.divider).toBe(true)
    const { divider: _left, ...older } = toWire(row)
    expect(fromWire(older).row.divider).toBe(false)
    expect(normalizeRow({ id: 'x' }).divider).toBe(false)
    expect(normalizeRow({ id: 'x', divider: true, header: true })).toMatchObject({ header: true, divider: false })
  })
})
