// Random op sequences must keep the pad well formed: unique ranks per parent, no cycles,
// no orphans among live rows, every live row reachable exactly once, updatedAt monotonic.
// No fast-check: a seeded PRNG and a few hundred runs are enough to shake out an off-by-one.
import { describe, expect, it } from 'vitest'
import { buildIndex, flatten } from './tree'
import {
  dedent, indent, insertAfter, insertBefore, mergeIntoPrev, moveNodes, moveSibling, remove,
  setCollapsed, splitNode, toggleDone, sweepDone,
} from './ops'
import { insertOutline, parseOutline } from './paste'
import { isValidRank } from './rank'
import { pad, testCtx } from './testing'
import type { Rows } from './types'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function check(rows: Rows) {
  const index = buildIndex(rows)
  const live = Object.values(rows).filter((r) => r.deletedAt === null)
  const flat = flatten(index, false)
  expect(flat.length).toBe(live.length)
  expect(new Set(flat.map((r) => r.id)).size).toBe(live.length)
  for (const r of live) {
    expect(isValidRank(r.rank)).toBe(true)
    // live parents only, and the stored parent is the effective one (no repair was needed)
    if (r.parentId !== null) {
      expect(rows[r.parentId]?.deletedAt).toBeNull()
      expect(index.parentOf.get(r.id)).toBe(r.parentId)
    }
  }
  for (const [, kids] of index.children) {
    const ranks = kids.map((k) => k.rank)
    expect(new Set(ranks).size).toBe(ranks.length)
  }
}

describe('random op sequences keep the pad well formed', () => {
  it('500 runs x 40 ops', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const rand = rng(seed)
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!
      const ctx = testCtx()
      let rows = pad('A\nB\n  B1\n  B2\nC\n  C1\n    C1a\nD', ctx)
      let lastTs = ''
      for (let step = 0; step < 40; step++) {
        const live = Object.values(rows).filter((r) => r.deletedAt === null).map((r) => r.id)
        if (live.length === 0) {
          rows = insertOutline(rows, ctx, parseOutline('seed'), { parentId: null, afterId: null }).rows
          continue
        }
        const some = () => {
          const n = 1 + Math.floor(rand() * 3)
          return Array.from({ length: n }, () => pick(live))
        }
        const op = Math.floor(rand() * 12)
        try {
          switch (op) {
            case 0: rows = insertAfter(rows, ctx, pick(live), `n${step}`).rows; break
            case 1: rows = insertBefore(rows, ctx, pick(live), `n${step}`).rows; break
            case 2: rows = splitNode(rows, ctx, pick(live), 1).rows; break
            case 3: rows = remove(rows, ctx, some()); break
            case 4: {
              const parent = rand() < 0.3 ? null : pick(live)
              const kids = buildIndex(rows).children.get(parent) ?? []
              const afterId = kids.length && rand() < 0.7 ? pick(kids).id : null
              rows = moveNodes(rows, ctx, some(), { parentId: parent, afterId })
              break
            }
            case 5: rows = indent(rows, ctx, some()); break
            case 6: rows = dedent(rows, ctx, some()); break
            case 7: rows = moveSibling(rows, ctx, some(), rand() < 0.5 ? 'up' : 'down'); break
            case 8: rows = mergeIntoPrev(rows, ctx, pick(live))?.rows ?? rows; break
            case 9: rows = toggleDone(rows, ctx, some()); break
            case 10: rows = setCollapsed(rows, ctx, pick(live), rand() < 0.5); break
            case 11: rows = sweepDone(rows, ctx); break
          }
        } catch (e) {
          throw new Error(`seed ${seed} step ${step} op ${op}: ${(e as Error).message}`)
        }
        try {
          check(rows)
        } catch (e) {
          throw new Error(`seed ${seed} step ${step} op ${op} broke an invariant: ${(e as Error).message}`)
        }
        const maxTs = Object.values(rows).reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), '')
        expect(maxTs >= lastTs).toBe(true)
        lastTs = maxTs
      }
    }
  })
})
