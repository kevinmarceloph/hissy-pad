import { describe, expect, it } from 'vitest'
import {
  dedent, indent, insertAfter, insertAtTop, insertBefore, mergeIntoPrev, moveNodes, moveSibling, moveToBottom, moveToTop,
  remove, removeDone, setCollapsed, setDone, setKind, setNumbered, setText, splitNode, sweepDone, toggleDone, toggleNumbered, ungroup, splitOpen,
  setState, sharedState,
} from './ops'
import { idOf, pad, shape, testCtx } from './testing'
import type { Rows } from './types'
import { insertOutline, parseOutline } from './paste'

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

  it('setState puts lines straight into any of the three states', () => {
    const ctx = testCtx()
    let rows = pad(OUTLINE, ctx)
    const a = idOf(rows, 'A')
    rows = setState(rows, ctx, [a], 'done')
    expect(rows[a]).toMatchObject({ done: true, doing: false })
    expect(rows[a]!.doneAt).not.toBeNull()
    rows = setState(rows, ctx, [a], 'doing')
    expect(rows[a]).toMatchObject({ done: false, doing: true, doneAt: null })
    rows = setState(rows, ctx, [a], 'open')
    expect(rows[a]).toMatchObject({ done: false, doing: false })
  })

  it('sharedState is the state every line has, or null for a mixed set', () => {
    const ctx = testCtx()
    let rows = pad(OUTLINE, ctx)
    const [a, c] = [idOf(rows, 'A'), idOf(rows, 'C')]
    expect(sharedState(rows, [a, c])).toBe('open')
    rows = setState(rows, ctx, [a], 'doing')
    expect(sharedState(rows, [a, c])).toBeNull()
    rows = setState(rows, ctx, [a, c], 'done')
    expect(sharedState(rows, [a, c])).toBe('done')
    expect(sharedState(rows, [])).toBeNull()
  })

  it('crossing out a doing line clears doing, and setState leaves an unchanged line alone', () => {
    const ctx = testCtx()
    let rows = pad(OUTLINE, ctx)
    const a = idOf(rows, 'A')
    rows = setState(rows, ctx, [a], 'doing')
    rows = toggleDone(rows, ctx, [a])
    expect(rows[a]).toMatchObject({ done: true, doing: false })
    const same = setState(rows, ctx, [a], 'done')
    expect(same).toBe(rows)
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

  it('dedent takes the numbering of the level it comes out to', () => {
    const ctx = testCtx()
    const rows = pad('1. A\n1. B\n  C\n  D', ctx)
    expect(shape(dedent(rows, ctx, [idOf(rows, 'C')]))).toBe('1.A\n2.B\n  D\n3.C')
    const plain = pad('A\n  1. B\n  2. C', ctx)
    expect(shape(dedent(plain, ctx, [idOf(plain, 'B')]))).toBe('A\n  1.C\nB')
    // Beside a header it looks past it, to the line after.
    const head = pad('# H\n  1. B\n1. C', ctx)
    expect(shape(dedent(head, ctx, [idOf(head, 'B')]))).toBe('#H\n1.B\n2.C')
  })

  it('indent takes the numbering of the lines it joins', () => {
    const ctx = testCtx()
    const rows = pad('A\n  1. B\n  2. C\nD', ctx)
    expect(shape(indent(rows, ctx, [idOf(rows, 'D')]))).toBe('A\n  1.B\n  2.C\n  3.D')
    const plain = pad('1. A\n  B\n2. C', ctx)
    expect(shape(indent(plain, ctx, [idOf(plain, 'C')]))).toBe('1.A\n  B\n  C')
    // With nothing under the new parent yet, the line keeps its own.
    const alone = pad('1. A\n2. B', ctx)
    expect(shape(indent(alone, ctx, [idOf(alone, 'B')]))).toBe('1.A\n  1.B')
  })

  it('dedent at the root is a no-op', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    expect(shape(dedent(rows, ctx, [idOf(rows, 'A')]))).toBe(shape(rows))
  })
})

describe('moveToTop', () => {
  it('puts the targets first among their siblings, in order, and leaves a group already there', () => {
    const ctx = testCtx()
    const rows = pad('A\nB\n  B1\n  B2\n  B3\nC\nD', ctx)
    expect(shape(moveToTop(rows, ctx, [idOf(rows, 'C'), idOf(rows, 'D')]))).toBe('C\nD\nA\nB\n  B1\n  B2\n  B3')
    expect(shape(moveToTop(rows, ctx, [idOf(rows, 'B3')]))).toBe('A\nB\n  B3\n  B1\n  B2\nC\nD')
    expect(moveToTop(rows, ctx, [idOf(rows, 'A')])).toBe(rows)
  })
})

describe('moves with one line already at the edge', () => {
  it('top and bottom gather a disjoint selection even when one line is there already', () => {
    const ctx = testCtx()
    const rows = pad('A\nB\nC\nD\nE', ctx)
    const ids = (...t: string[]) => t.map((x) => idOf(rows, x))
    expect(shape(moveToTop(rows, ctx, ids('A', 'C', 'E')))).toBe('A\nC\nE\nB\nD')
    expect(shape(moveToBottom(rows, ctx, ids('A', 'C', 'E')))).toBe('B\nD\nA\nC\nE')
    expect(moveToTop(rows, ctx, ids('A', 'B'))).toBe(rows)
    expect(moveToBottom(rows, ctx, ids('D', 'E'))).toBe(rows)
  })

  it('up and down move the rest of the selection toward the line at the edge', () => {
    const ctx = testCtx()
    const rows = pad('A\nB\nC\nD\nE', ctx)
    const ids = (...t: string[]) => t.map((x) => idOf(rows, x))
    expect(shape(moveSibling(rows, ctx, ids('A', 'C'), 'up'))).toBe('A\nC\nB\nD\nE')
    expect(shape(moveSibling(rows, ctx, ids('A', 'D'), 'up'))).toBe('A\nB\nD\nC\nE')
    expect(shape(moveSibling(rows, ctx, ids('A', 'B', 'D'), 'up'))).toBe('A\nB\nD\nC\nE')
    expect(shape(moveSibling(rows, ctx, ids('C', 'E'), 'down'))).toBe('A\nB\nD\nC\nE')
    expect(shape(moveSibling(rows, ctx, ids('B', 'E'), 'down'))).toBe('A\nC\nB\nD\nE')
    // All of it gathered at the edge: nothing moves.
    expect(moveSibling(rows, ctx, ids('A', 'B'), 'up')).toBe(rows)
    expect(moveSibling(rows, ctx, ids('D', 'E'), 'down')).toBe(rows)
  })
})

describe('moveToBottom', () => {
  it('puts the targets last among their siblings, in order, and leaves a group already there', () => {
    const ctx = testCtx()
    const rows = pad('A\nB\n  B1\n  B2\n  B3\nC\nD', ctx)
    expect(shape(moveToBottom(rows, ctx, [idOf(rows, 'A'), idOf(rows, 'B')]))).toBe('C\nD\nA\nB\n  B1\n  B2\n  B3')
    expect(shape(moveToBottom(rows, ctx, [idOf(rows, 'B1')]))).toBe('A\nB\n  B2\n  B3\n  B1\nC\nD')
    expect(moveToBottom(rows, ctx, [idOf(rows, 'D')])).toBe(rows)
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

  it('refuses on the first node', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    expect(mergeIntoPrev(rows, ctx, idOf(rows, 'A'))).toBeNull()
  })

  it('a node with children joins a line above that has none, and its children move under it', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const res = mergeIntoPrev(rows, ctx, idOf(rows, 'B'))!
    expect(shape(res.rows)).toBe('AB\n  B1\n  B2\nC')
    expect(res.prevId).toBe(idOf(rows, 'A'))
    expect(res.caret).toBe(1)
    const deep = pad('A\n  A1\nB\n  B1\n    B1a', ctx) // the line above is a leaf further in
    expect(shape(mergeIntoPrev(deep, ctx, idOf(deep, 'B'))!.rows)).toBe('A\n  A1B\n    B1\n      B1a')
  })

  it('the line above takes the fold of the node it swallows', () => {
    const ctx = testCtx()
    let rows = pad(OUTLINE, ctx)
    rows = setCollapsed(rows, ctx, idOf(rows, 'B'), true)
    const res = mergeIntoPrev(rows, ctx, idOf(rows, 'B'))!
    expect(res.rows[idOf(rows, 'A')]!.collapsed).toBe(true)
    expect(shape(res.rows)).toContain('AB\n  B1\n  B2')
  })

  it('refuses a node with children when the line above has children folded away', () => {
    const ctx = testCtx()
    let rows = pad('A\n  A1\nB\n  B1', ctx)
    rows = setCollapsed(rows, ctx, idOf(rows, 'A'), true)
    expect(mergeIntoPrev(rows, ctx, idOf(rows, 'B'))).toBeNull()
  })

  it('refuses a node with children under a divider', () => {
    const ctx = testCtx()
    const rows = pad('--- Part\nB\n  B1', ctx)
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

describe('numbered lists', () => {
  it('numbering one line numbers its plain siblings; un-numbering one un-numbers them', () => {
    const ctx = testCtx()
    let rows = pad('a\n  a1\n  a2\nb\nc', ctx)
    rows = toggleNumbered(rows, ctx, [idOf(rows, 'b')])
    expect(shape(rows)).toBe('1.a\n  a1\n  a2\n2.b\n3.c')
    rows = toggleNumbered(rows, ctx, [idOf(rows, 'a1')])
    expect(shape(rows)).toBe('1.a\n  1.a1\n  2.a2\n2.b\n3.c')
    rows = toggleNumbered(rows, ctx, [idOf(rows, 'c')])
    expect(shape(rows)).toBe('a\n  1.a1\n  2.a2\nb\nc')
  })

  it('a header keeps its look and splits the run; pad rows are left alone', () => {
    const ctx = testCtx()
    let rows = pad('a\nb\nc\nd', ctx)
    rows = setKind(rows, ctx, [idOf(rows, 'c')], 'header')
    rows = setNumbered(rows, ctx, [idOf(rows, 'a')], true)
    expect(shape(rows)).toBe('1.a\n2.b\n#c\n1.d')
    rows = setKind(rows, ctx, [idOf(rows, 'd')], 'plain')
    expect(shape(rows)).toBe('a\nb\n#c\nd')
    const padRow = { ...rows[idOf(rows, 'd')]!, pad: true }
    rows = setNumbered({ ...rows, [padRow.id]: padRow }, ctx, [idOf(rows, 'a')], true)
    expect(rows[padRow.id]!.numbered).toBe(false)
  })

  it('Enter continues a numbered list; a new first child starts plain', () => {
    const ctx = testCtx()
    let rows = pad('a\n  a1\nb', ctx)
    rows = setNumbered(rows, ctx, [idOf(rows, 'a'), idOf(rows, 'b')], true)
    rows = insertAfter(rows, ctx, idOf(rows, 'b'), 'c').rows
    rows = insertAfter(rows, ctx, idOf(rows, 'a'), 'a0').rows // first child of expanded a
    rows = insertBefore(rows, ctx, idOf(rows, 'a'), 'z').rows
    expect(shape(rows)).toBe('1.z\n2.a\n  a0\n  a1\n3.b\n4.c')
  })

  it('setKind switches between plain, header and numbered, never both flags', () => {
    const ctx = testCtx()
    let rows = pad('a\nb\nc', ctx)
    rows = setKind(rows, ctx, [idOf(rows, 'a'), idOf(rows, 'b')], 'header')
    expect(shape(rows)).toBe('#a\n#b\nc')
    rows = setKind(rows, ctx, [idOf(rows, 'b')], 'numbered')
    expect(shape(rows)).toBe('#a\n1.b\n2.c')
    expect(rows[idOf(rows, 'b')]!.header).toBe(false)
    rows = setKind(rows, ctx, [idOf(rows, 'c')], 'header')
    expect(shape(rows)).toBe('#a\n1.b\n#c')
    const same = setKind(rows, ctx, [idOf(rows, 'a')], 'header')
    expect(same).toBe(rows)
    rows = setKind(rows, ctx, [idOf(rows, 'a'), idOf(rows, 'b'), idOf(rows, 'c')], 'plain')
    expect(shape(rows)).toBe('a\nb\nc')
  })

  it('Enter after a header starts a plain line', () => {
    const ctx = testCtx()
    let rows = pad('h\nx', ctx)
    rows = setKind(rows, ctx, [idOf(rows, 'h')], 'header')
    rows = insertAfter(rows, ctx, idOf(rows, 'h'), 'next').rows
    expect(shape(rows)).toBe('#h\nnext\nx')
  })

  it('removeDone deletes every crossed-out line with its subtree', () => {
    const ctx = testCtx()
    let rows = pad('a\n  a1\nb\n  b1\nc', ctx)
    rows = setDone(rows, ctx, [idOf(rows, 'a'), idOf(rows, 'b1')], true)
    expect(shape(removeDone(rows, ctx))).toBe('b\nc')
    const clean = pad('x', ctx)
    expect(removeDone(clean, ctx)).toBe(clean)
  })
})

describe('colliding ranks', () => {
  // Two devices created "the first line" offline: both picked rank a0. Inserting between
  // them must re-rank instead of throwing, and keep their id order.
  function twins(): Rows {
    const base = { parentId: null, text: '', done: false, doneAt: null, doing: false, collapsed: false, numbered: false, header: false, divider: false, pad: false, slot: null, category: null, pinned: false, countHidden: false, due: null, fresh: false, repeat: null, origin: null, updatedAt: '2026-10-28T00:00:00.000Z', deletedAt: null }
    return {
      a: { ...base, id: 'a', rank: 'a0', text: 'A' },
      b: { ...base, id: 'b', rank: 'a0', text: 'B' },
      c: { ...base, id: 'c', rank: 'a0', text: 'C' },
    }
  }

  it('insertAfter the first of three equal ranks re-ranks the followers', () => {
    const ctx = testCtx()
    const { rows } = insertAfter(twins(), ctx, 'a', 'new')
    expect(shape(rows)).toBe('A\nnew\nB\nC')
    const ranks = Object.values(rows).map((r) => r.rank)
    expect(new Set(ranks).size).toBe(4)
  })

  it('insertBefore, split, move and paste all survive equal ranks', () => {
    const ctx = testCtx()
    expect(shape(insertBefore(twins(), ctx, 'b', 'x').rows)).toBe('A\nx\nB\nC')
    expect(shape(splitNode(twins(), ctx, 'b', 1).rows)).toBe('A\nB\n\nC')
    expect(shape(moveNodes(twins(), ctx, ['c'], { parentId: null, afterId: 'a' }))).toBe('A\nC\nB')
    expect(shape(moveSibling(twins(), ctx, ['c'], 'up'))).toBe('A\nC\nB')
    expect(shape(insertOutline(twins(), ctx, parseOutline('p\n  q'), { parentId: null, afterId: 'a' }).rows)).toBe('A\np\n  q\nB\nC')
  })
})

describe('ungroup', () => {
  const rows = () => pad('A\nB\n  B1\n    B1a\n  B2\nC\n  C1')
  it("brings a line's children out to its own level, right after it, in order", () => {
    const r = rows()
    const out = ungroup(r, testCtx(), [idOf(r, 'B')])
    expect(shape(out)).toBe('A\nB\nB1\n  B1a\nB2\nC\n  C1')
    expect(ungroup(out, testCtx(), [idOf(out, 'A'), idOf(out, 'B')])).toBe(out) // no children: nothing changes
  })
  it('works a level down, and a line with one of its children flattens both levels', () => {
    const r = rows()
    expect(shape(ungroup(r, testCtx(), [idOf(r, 'B1')]))).toBe('A\nB\n  B1\n  B1a\n  B2\nC\n  C1')
    expect(shape(ungroup(r, testCtx(), [idOf(r, 'B'), idOf(r, 'B1'), idOf(r, 'C')]))).toBe('A\nB\nB1\nB1a\nB2\nC\nC1')
  })
})

describe('splitOpen', () => {
  const rows = () => {
    const ctx = testCtx()
    const r = pad('A\nB\n  B1\n    B1a\n  B2\n  B3\n    B3a\nC', ctx)
    return { ctx, r: setDone(r, ctx, [idOf(r, 'B2'), idOf(r, 'B3a')], true) }
  }
  it('a copy right below takes the open sub items with all they hold; the done ones stay', () => {
    const { ctx, r } = rows()
    const done = setDone(r, ctx, [idOf(r, 'B')], true)
    const { rows: out, newIds } = splitOpen(done, ctx, [idOf(r, 'B')])
    expect(shape(out)).toBe('A\n~B\n  ~B2\nB\n  B1\n    B1a\n  B3\n    ~B3a\nC')
    expect(newIds).toHaveLength(1)
    expect(out[newIds[0]!]!.done).toBe(false)
    expect(out[newIds[0]!]!.slot).toBeNull()
  })
  it('keeps the kind and category, not the hour', () => {
    const { ctx, r } = rows()
    let s = setKind(r, ctx, [idOf(r, 'B')], 'header')
    s = { ...s, [idOf(r, 'B')]: { ...s[idOf(r, 'B')]!, category: 'cat1', slot: '2026-11-24T15' } }
    const { rows: out, newIds } = splitOpen(s, ctx, [idOf(r, 'B')])
    const copy = out[newIds[0]!]!
    expect([copy.header, copy.category, copy.slot]).toEqual([true, 'cat1', null])
  })
  it('leaves a line alone without both done and open sub items', () => {
    const { ctx, r } = rows()
    expect(splitOpen(r, ctx, [idOf(r, 'A'), idOf(r, 'B1'), idOf(r, 'B3')]).rows).toBe(r)
  })
})
