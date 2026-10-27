import { describe, expect, it } from 'vitest'
import {
  dedent, indent, insertAfter, insertAtTop, insertBefore, mergeIntoPrev, moveNodes, moveSibling,
  remove, setCollapsed, setText, splitNode, sweepDone, toggleDone,
} from './ops'
import { idOf, pad, shape, testCtx } from './testing'

const OUTLINE = `
A
B
  B1
  B2
C
`

describe('insert', () => {
  it('insertAfter adds a sibling below a leaf', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const { rows: out, newId } = insertAfter(rows, ctx, idOf(rows, 'A'), 'A2')
    expect(shape(out)).toBe('A\nA2\nB\n  B1\n  B2\nC')
    expect(out[newId]!.parentId).toBeNull()
  })

  it('insertAfter on an expanded parent adds a first child', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const { rows: out } = insertAfter(rows, ctx, idOf(rows, 'B'), 'B0')
    expect(shape(out)).toBe('A\nB\n  B0\n  B1\n  B2\nC')
  })

  it('insertAfter on a collapsed parent adds a sibling below', () => {
    const ctx = testCtx()
    let rows = pad(OUTLINE, ctx)
    rows = setCollapsed(rows, ctx, idOf(rows, 'B'), true)
    const { rows: out } = insertAfter(rows, ctx, idOf(rows, 'B'), 'B+')
    expect(shape(out)).toBe('A\nB\n  B1\n  B2\nB+\nC')
  })

  it('insertBefore and insertAtTop', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const a = insertBefore(rows, ctx, idOf(rows, 'B2'), 'B1.5').rows
    expect(shape(a)).toBe('A\nB\n  B1\n  B1.5\n  B2\nC')
    const b = insertAtTop(rows, ctx, 'captured').rows
    expect(shape(b)).toBe('captured\nA\nB\n  B1\n  B2\nC')
  })

  it('splitNode keeps the head and moves the tail to the new node', () => {
    const ctx = testCtx()
    const rows = pad('hello world', ctx)
    const { rows: out, newId } = splitNode(rows, ctx, idOf(rows, 'hello world'), 5)
    expect(shape(out)).toBe('hello\n world')
    expect(out[newId]!.text).toBe(' world')
  })
})

describe('text, done, collapse', () => {
  it('setText bumps updatedAt only when the text changed', () => {
    const ctx = testCtx()
    const rows = pad('x', ctx)
    const id = idOf(rows, 'x')
    expect(setText(rows, ctx, id, 'x')).toBe(rows)
    const out = setText(rows, ctx, id, 'y')
    expect(out[id]!.text).toBe('y')
    expect(out[id]!.updatedAt > rows[id]!.updatedAt).toBe(true)
  })

  it('toggleDone marks a mixed selection done and an all-done selection undone', () => {
    const ctx = testCtx()
    let rows = pad(OUTLINE, ctx)
    const ids = [idOf(rows, 'A'), idOf(rows, 'C')]
    rows = toggleDone(rows, ctx, ids)
    expect(shape(rows)).toBe('~A\nB\n  B1\n  B2\n~C')
    rows = toggleDone(rows, ctx, [...ids, idOf(rows, 'B')])
    expect(shape(rows)).toBe('~A\n~B\n  B1\n  B2\n~C')
    rows = toggleDone(rows, ctx, ids)
    expect(shape(rows)).toBe('A\n~B\n  B1\n  B2\nC')
  })
})

describe('remove', () => {
  it('tombstones the subtree and leaves the rows in place for sync', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const b = idOf(rows, 'B')
    const out = remove(rows, ctx, [b, idOf(rows, 'B1')])
    expect(shape(out)).toBe('A\nC')
    expect(Object.keys(out)).toHaveLength(5)
    expect(out[b]!.deletedAt).not.toBeNull()
    expect(out[idOf(rows, 'B2')]!.deletedAt).not.toBeNull()
  })
})

describe('moveNodes', () => {
  it('moves a set in document order to one spot', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const out = moveNodes(rows, ctx, [idOf(rows, 'C'), idOf(rows, 'A')], { parentId: idOf(rows, 'B'), afterId: idOf(rows, 'B1') })
    expect(shape(out)).toBe('B\n  B1\n  A\n  C\n  B2')
  })

  it('refuses to move a node into its own subtree', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    expect(moveNodes(rows, ctx, [idOf(rows, 'B')], { parentId: idOf(rows, 'B1'), afterId: null })).toBe(rows)
    expect(moveNodes(rows, ctx, [idOf(rows, 'B')], { parentId: idOf(rows, 'B'), afterId: null })).toBe(rows)
  })

  it('is a no-op shaped move when dropped next to itself', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const out = moveNodes(rows, ctx, [idOf(rows, 'B')], { parentId: null, afterId: idOf(rows, 'A') })
    expect(shape(out)).toBe(shape(rows))
  })
})

describe('indent / dedent', () => {
  it('indent nests under the previous sibling and expands it', () => {
    const ctx = testCtx()
    let rows = pad(OUTLINE, ctx)
    rows = setCollapsed(rows, ctx, idOf(rows, 'B'), true)
    const out = indent(rows, ctx, [idOf(rows, 'C')])
    expect(shape(out)).toBe('A\nB\n  B1\n  B2\n  C')
    expect(out[idOf(rows, 'B')]!.collapsed).toBe(false)
  })

  it('indent of the first sibling is a no-op', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    expect(shape(indent(rows, ctx, [idOf(rows, 'A')]))).toBe(shape(rows))
    expect(shape(indent(rows, ctx, [idOf(rows, 'B1')]))).toBe(shape(rows))
  })

  it('indent of a run of siblings puts them all under the same node in order', () => {
    const ctx = testCtx()
    const rows = pad('A\nB\nC\nD', ctx)
    const out = indent(rows, ctx, [idOf(rows, 'B'), idOf(rows, 'C')])
    expect(shape(out)).toBe('A\n  B\n  C\nD')
  })

  it('dedent moves after the parent and leaves following siblings alone', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const out = dedent(rows, ctx, [idOf(rows, 'B1')])
    expect(shape(out)).toBe('A\nB\n  B2\nB1\nC')
  })

  it('dedent of several siblings keeps their order', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const out = dedent(rows, ctx, [idOf(rows, 'B1'), idOf(rows, 'B2')])
    expect(shape(out)).toBe('A\nB\nB1\nB2\nC')
  })

  it('dedent at the root is a no-op', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    expect(shape(dedent(rows, ctx, [idOf(rows, 'A')]))).toBe(shape(rows))
  })
})

describe('moveSibling', () => {
  it('moves a block up and down past unselected siblings', () => {
    const ctx = testCtx()
    const rows = pad('A\nB\nC\nD', ctx)
    const sel = [idOf(rows, 'B'), idOf(rows, 'C')]
    expect(shape(moveSibling(rows, ctx, sel, 'up'))).toBe('B\nC\nA\nD')
    expect(shape(moveSibling(rows, ctx, sel, 'down'))).toBe('A\nD\nB\nC')
    expect(shape(moveSibling(rows, ctx, [idOf(rows, 'A')], 'up'))).toBe('A\nB\nC\nD')
    expect(shape(moveSibling(rows, ctx, [idOf(rows, 'D')], 'down'))).toBe('A\nB\nC\nD')
  })

  it('takes children along', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    expect(shape(moveSibling(rows, ctx, [idOf(rows, 'B')], 'up'))).toBe('B\n  B1\n  B2\nA\nC')
  })
})

describe('mergeIntoPrev', () => {
  it('folds text into the visible node above', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const res = mergeIntoPrev(rows, ctx, idOf(rows, 'C'))!
    expect(shape(res.rows)).toBe('A\nB\n  B1\n  B2C')
    expect(res.prevId).toBe(idOf(rows, 'B2'))
    expect(res.caret).toBe(2)
  })

  it('refuses on the first node or a node with children', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    expect(mergeIntoPrev(rows, ctx, idOf(rows, 'A'))).toBeNull()
    expect(mergeIntoPrev(rows, ctx, idOf(rows, 'B'))).toBeNull()
  })
})

describe('sweepDone', () => {
  it('creates a collapsed Done node at the bottom and moves done roots under it', () => {
    const ctx = testCtx()
    let rows = pad(OUTLINE, ctx)
    rows = toggleDone(rows, ctx, [idOf(rows, 'A'), idOf(rows, 'B1')])
    const out = sweepDone(rows, ctx)
    expect(shape(out)).toBe('B\n  ~B1\n  B2\nC\nDone\n  ~A')
    expect(out[idOf(out, 'Done')]!.collapsed).toBe(true)
  })

  it('reuses an existing Done node and appends', () => {
    const ctx = testCtx()
    let rows = pad('A\nB\nDone\n  old', ctx)
    rows = toggleDone(rows, ctx, [idOf(rows, 'B')])
    expect(shape(sweepDone(rows, ctx))).toBe('A\nDone\n  old\n  ~B')
    const clean = pad('A', ctx)
    expect(sweepDone(clean, ctx)).toBe(clean)
  })
})
