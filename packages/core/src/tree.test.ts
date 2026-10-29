import { describe, expect, it } from 'vitest'
import { buildIndex, childrenOf, depthOf, descendantIds, flatten, isAncestor, topmost } from './tree'
import { idOf, pad, shape, testCtx } from './testing'
import type { NodeRow, Rows } from './types'

const OUTLINE = `
IGS Meal Planning
Job Hunt (before 9pm)
Personal Website
  Fix current copy
  Write about Astro
    sub detail
  Project: YTCH clone
Make eggnog
`

function row(partial: Partial<NodeRow> & { id: string }): NodeRow {
  return {
    parentId: null, rank: 'V', text: partial.id, done: false, collapsed: false, numbered: false, header: false,
    updatedAt: '2026-10-28T00:00:00.000Z', deletedAt: null, ...partial,
  }
}

describe('buildIndex / flatten', () => {
  it('derives the tree from parentId + rank', () => {
    const rows = pad(OUTLINE)
    expect(shape(rows)).toBe(OUTLINE.trim())
  })

  it('hides children of collapsed nodes in the visible list only', () => {
    const ctx = testCtx()
    const rows = pad(OUTLINE, ctx)
    const site = idOf(rows, 'Personal Website')
    const collapsed: Rows = { ...rows, [site]: { ...rows[site]!, collapsed: true } }
    expect(shape(collapsed, true)).toBe('IGS Meal Planning\nJob Hunt (before 9pm)\nPersonal Website\nMake eggnog')
    expect(shape(collapsed, false)).toBe(OUTLINE.trim())
  })

  it('hides tombstoned rows and surfaces their live children at the root', () => {
    // ops.remove tombstones whole subtrees, so this only happens after a sync race (one
    // device deleted the parent while another added under it). Never lose the addition.
    const rows = pad(OUTLINE)
    const site = idOf(rows, 'Personal Website')
    const gone: Rows = { ...rows, [site]: { ...rows[site]!, deletedAt: '2026-10-28T01:00:00.000Z' } }
    expect(shape(gone)).toBe(
      'IGS Meal Planning\nFix current copy\nJob Hunt (before 9pm)\nWrite about Astro\n  sub detail\nProject: YTCH clone\nMake eggnog',
    )
  })

  it('orders siblings by rank then id', () => {
    const rows: Rows = {
      b: row({ id: 'b', rank: 'V' }),
      a: row({ id: 'a', rank: 'V' }),
      c: row({ id: 'c', rank: 'U' }),
    }
    expect(flatten(buildIndex(rows), false).map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('shows orphans at the root instead of losing them', () => {
    const rows: Rows = {
      a: row({ id: 'a' }),
      kid: row({ id: 'kid', parentId: 'missing', rank: 'A' }),
      kid2: row({ id: 'kid2', parentId: 'dead', rank: 'B' }),
      dead: row({ id: 'dead', deletedAt: '2026-10-28T01:00:00.000Z' }),
    }
    expect(flatten(buildIndex(rows), false).map((r) => `${r.id}@${r.depth}`)).toEqual(['kid@0', 'kid2@0', 'a@0'])
  })

  it('breaks cycles by cutting one node loose to the root', () => {
    const rows: Rows = {
      a: row({ id: 'a', parentId: 'b' }),
      b: row({ id: 'b', parentId: 'a' }),
      c: row({ id: 'c', parentId: 'a', rank: 'W' }),
    }
    const flat = flatten(buildIndex(rows), false)
    expect(flat).toHaveLength(3)
    expect(flat.filter((r) => r.depth === 0)).toHaveLength(1)
  })
})

describe('helpers', () => {
  const rows = pad(OUTLINE)
  const site = idOf(rows, 'Personal Website')
  const sub = idOf(rows, 'sub detail')
  const index = buildIndex(rows)

  it('childrenOf, descendantIds, isAncestor, depthOf', () => {
    expect(childrenOf(index, site).map((r) => r.text)).toEqual(['Fix current copy', 'Write about Astro', 'Project: YTCH clone'])
    expect(descendantIds(index, site).map((id) => rows[id]!.text)).toEqual(['Fix current copy', 'Write about Astro', 'sub detail', 'Project: YTCH clone'])
    expect(isAncestor(index, site, sub)).toBe(true)
    expect(isAncestor(index, sub, site)).toBe(false)
    expect(depthOf(index, sub)).toBe(2)
    expect(depthOf(index, site)).toBe(0)
  })

  it('topmost drops ids covered by a selected ancestor and keeps document order', () => {
    const eggnog = idOf(rows, 'Make eggnog')
    expect(topmost(index, [sub, eggnog, site, idOf(rows, 'Fix current copy')])).toEqual([site, eggnog])
  })
})
