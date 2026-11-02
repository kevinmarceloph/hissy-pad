import { describe, expect, it } from 'vitest'
import { pad, shape, idOf, testCtx } from './testing'
import { createPad, freshStart, listPads, moveToPad, resolveSides, scopePad, sendTo, sideRows, unscopeRow } from './pads'
import { dedent, insertAt, remove, setText } from './ops'
import { changedRows } from './sync/store'

// A table with a main pad (A, B with children) and a second pad "Work" (W1, W2 with a child).
function table() {
  const ctx = testCtx()
  let rows = pad('A\nB\n  B1\n  B2\nC', ctx)
  const made = createPad(rows, ctx, 'Work')
  rows = made.rows
  const w = made.padId
  rows = insertAt(rows, ctx, { parentId: w, afterId: null }, 'W1').rows
  const w2 = insertAt(rows, ctx, { parentId: w, afterId: idOf(rows, 'W1') }, 'W2')
  rows = insertAt(w2.rows, ctx, { parentId: w2.newId, afterId: null }, 'W2a').rows
  return { rows, ctx, w }
}

describe('pads', () => {
  it('a pad is a root row with the flag; listPads finds them in order', () => {
    const { rows, w } = table()
    expect(shape(rows)).toBe('A\nB\n  B1\n  B2\nC\n@Work\n  W1\n  W2\n    W2a')
    expect(listPads(rows).map((r) => r.id)).toEqual([w])
  })

  it('scopePad(main) hides the pads; scopePad(pad) lifts its children to the root', () => {
    const { rows, w } = table()
    expect(shape(scopePad(rows, null))).toBe('A\nB\n  B1\n  B2\nC')
    expect(shape(scopePad(rows, w))).toBe('W1\nW2\n  W2a')
    expect(scopePad(rows, 'nope')).toEqual({})
  })

  it('a scoped view keeps row identity, so a diff sees only what an op touched', () => {
    const { rows, ctx, w } = table()
    const s1 = scopePad(rows, w)
    const s2 = scopePad(rows, w)
    expect(s1[idOf(rows, 'W1')]).toBe(s2[idOf(rows, 'W1')])
    const next = setText(s1, ctx, idOf(rows, 'W2a'), 'W2a!')
    expect(changedRows(s1, next).map((r) => r.text)).toEqual(['W2a!'])
  })

  it('ops run inside a pad: dedent stops at the pad root, and unscopeRow restores the parent', () => {
    const { rows, ctx, w } = table()
    const scoped = scopePad(rows, w)
    const a = idOf(rows, 'W2a')
    const out = dedent(scoped, ctx, [a])
    expect(shape(out)).toBe('W1\nW2\nW2a')
    expect(out[a]!.parentId).toBeNull()
    expect(unscopeRow(out[a]!, w).parentId).toBe(w)
    // A second dedent has nowhere to go: the pad root is the top.
    expect(dedent(out, ctx, [a])).toBe(out)
  })

  it('moveToPad puts the lines at the top of the other pad, main included', () => {
    const { rows, ctx, w } = table()
    let out = moveToPad(rows, ctx, [idOf(rows, 'B'), idOf(rows, 'B1')], w)
    expect(shape(scopePad(out, null))).toBe('A\nC')
    expect(shape(scopePad(out, w))).toBe('B\n  B1\n  B2\nW1\nW2\n  W2a')
    out = moveToPad(out, ctx, [idOf(out, 'W2')], null)
    expect(shape(scopePad(out, null))).toBe('W2\n  W2a\nA\nC')
    expect(moveToPad(out, ctx, [idOf(out, 'A')], 'nope')).toBe(out)
  })

  it('a deleted pad leaves nothing behind in main; its lines are tombstoned with it', () => {
    const { rows, ctx, w } = table()
    const out = remove(rows, ctx, [w])
    expect(listPads(out)).toEqual([])
    expect(shape(scopePad(out, null))).toBe('A\nB\n  B1\n  B2\nC')
    expect(out[idOf(rows, 'W2a')]!.deletedAt).not.toBeNull()
  })
})

describe('fresh start', () => {
  const none = { right: new Set<string>(), left: new Set<string>() }

  it('sides: a line follows its nearest explicit ancestor; sending clears choices under it', () => {
    const rows = pad('A\n  A1\n    A1a\n  A2\nB')
    const a = idOf(rows, 'A'), a1 = idOf(rows, 'A1'), a1a = idOf(rows, 'A1a')
    let s = sendTo(rows, none, [a], 'right')
    expect([...resolveSides(rows, s).entries()].filter(([, v]) => v === 'right').map(([k]) => rows[k]!.text)).toEqual(['A', 'A1', 'A1a', 'A2'])
    s = sendTo(rows, s, [a1], 'left')
    expect(resolveSides(rows, s).get(a1)).toBe('left')
    expect(resolveSides(rows, s).get(a1a)).toBe('left')
    s = sendTo(rows, s, [a1a], 'right')
    expect(resolveSides(rows, s).get(a1a)).toBe('right')
    // Sending A again clears A1 and A1a's own choices: the whole subtree follows.
    s = sendTo(rows, s, [a], 'left')
    expect(s.right.size).toBe(0)
    expect(s.left.has(a1)).toBe(false)
  })

  it('sideRows rebuilds each side with depth from the nearest same-side ancestor', () => {
    const rows = pad('A\n  A1\n    A1a\n  A2\nB')
    const s = sendTo(rows, sendTo(rows, none, [idOf(rows, 'A')], 'right'), [idOf(rows, 'A1')], 'left')
    const r = resolveSides(rows, s)
    expect(sideRows(rows, r, 'right').map((x) => `${'  '.repeat(x.depth)}${rows[x.id]!.text}`)).toEqual(['A', '  A2'])
    expect(sideRows(rows, r, 'left').map((x) => `${'  '.repeat(x.depth)}${rows[x.id]!.text}`)).toEqual(['A1', '  A1a', 'B'])
  })

  it('the common case: kept lines stay put, the rest move to a new pad in order', () => {
    const ctx = testCtx()
    const rows = pad('A\nB\n  B1\nC\nD', ctx)
    const s = sendTo(rows, none, [idOf(rows, 'B'), idOf(rows, 'D')], 'right')
    const res = freshStart(rows, ctx, null, s, 'Before today')
    expect(shape(scopePad(res.rows, null))).toBe('B\n  B1\nD')
    expect(shape(scopePad(res.rows, res.archiveId))).toBe('A\nC')
    expect(res.rows[res.archiveId]!.text).toBe('Before today')
    expect(res.moved).toBe(2)
    // B, B1 and D were not written: only the archived roots and the new pad changed.
    expect(changedRows(rows, res.rows).map((r) => r.text).sort()).toEqual(['A', 'Before today', 'C'])
  })

  it('a kept child under an archived parent comes up to the pad root; an archived child under a kept parent goes down', () => {
    const ctx = testCtx()
    const rows = pad('P\n  keep\n  drop\nQ\n  q1\n    deep', ctx)
    let s = sendTo(rows, none, [idOf(rows, 'keep')], 'right')
    s = sendTo(rows, s, [idOf(rows, 'Q')], 'right')
    s = sendTo(rows, s, [idOf(rows, 'q1')], 'left')
    s = sendTo(rows, s, [idOf(rows, 'deep')], 'right')
    const res = freshStart(rows, ctx, null, s, 'old')
    expect(shape(scopePad(res.rows, null))).toBe('keep\nQ\n  deep')
    expect(shape(scopePad(res.rows, res.archiveId))).toBe('P\n  drop\nq1')
    expect(res.moved).toBe(3)
  })

  it('works inside a second pad and leaves the other pads alone', () => {
    const { rows, ctx, w } = table()
    const s = sendTo(scopePad(rows, w), none, [idOf(rows, 'W2')], 'right')
    const res = freshStart(rows, ctx, w, s, 'Work, before')
    expect(shape(scopePad(res.rows, w))).toBe('W2\n  W2a')
    expect(shape(scopePad(res.rows, res.archiveId))).toBe('W1')
    expect(shape(scopePad(res.rows, null))).toBe('A\nB\n  B1\n  B2\nC')
    expect(listPads(res.rows).map((r) => r.text)).toEqual(['Work', 'Work, before'])
  })

  it('nothing kept: the whole pad is archived and the pad is left empty', () => {
    const ctx = testCtx()
    const rows = pad('A\nB', ctx)
    const res = freshStart(rows, ctx, null, none, 'all of it')
    expect(shape(scopePad(res.rows, null))).toBe('')
    expect(shape(scopePad(res.rows, res.archiveId))).toBe('A\nB')
  })
})
