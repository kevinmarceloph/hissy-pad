import type { NodeRow, Rows } from './types'
import { compareRank, ranksBetween } from './rank'

// Sibling order: rank, then id. The id tiebreak matters when two devices insert at the same
// gap while offline and both pick the same midpoint; the result is deterministic on every
// device instead of depending on arrival order.
export function compareSiblings(a: NodeRow, b: NodeRow): number {
  return compareRank(a.rank, b.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export const ROOT = null

// children[parentId] in sibling order, live rows only. Rows whose parent is missing or
// deleted (an orphan from an out-of-order sync) are shown at the root rather than lost;
// a cycle (a moved under b while b moved under a on another device) is broken the same way.
export interface TreeIndex {
  children: ReadonlyMap<string | null, readonly NodeRow[]>
  parentOf: ReadonlyMap<string, string | null>  // effective parent after orphan/cycle repair
}

export function isLive(row: NodeRow | undefined): row is NodeRow {
  return row !== undefined && row.deletedAt === null
}

export function buildIndex(rows: Rows): TreeIndex {
  const live = Object.values(rows).filter(isLive)
  const byId = new Map(live.map((r) => [r.id, r]))

  const parentOf = new Map<string, string | null>()
  for (const r of live) {
    parentOf.set(r.id, r.parentId !== null && byId.has(r.parentId) ? r.parentId : null)
  }
  // Break cycles: walk up from each node; if we revisit a node on the current path, cut it loose.
  const settled = new Set<string>()
  for (const r of live) {
    const path: string[] = []
    const onPath = new Set<string>()
    let cur: string | null = r.id
    while (cur !== null && !settled.has(cur)) {
      if (onPath.has(cur)) {
        parentOf.set(cur, null)
        break
      }
      onPath.add(cur)
      path.push(cur)
      cur = parentOf.get(cur) ?? null
    }
    for (const id of path) settled.add(id)
  }

  const children = new Map<string | null, NodeRow[]>()
  for (const r of live) {
    const p = parentOf.get(r.id) ?? null
    let list = children.get(p)
    if (!list) children.set(p, (list = []))
    list.push(r)
  }
  for (const list of children.values()) list.sort(compareSiblings)
  return { children, parentOf }
}

export function childrenOf(index: TreeIndex, parentId: string | null): readonly NodeRow[] {
  return index.children.get(parentId) ?? []
}

export function siblingsOf(index: TreeIndex, id: string): readonly NodeRow[] {
  return childrenOf(index, index.parentOf.get(id) ?? null)
}

export interface FlatRow {
  id: string
  depth: number
}

// Depth-first order. `visibleOnly` skips the children of collapsed nodes: that is the list
// the editor renders, and the one keyboard navigation and drag resolution walk.
export function flatten(index: TreeIndex, visibleOnly: boolean, from: string | null = ROOT): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const r of childrenOf(index, parentId)) {
      out.push({ id: r.id, depth })
      if (!visibleOnly || !r.collapsed) walk(r.id, depth + 1)
    }
  }
  walk(from, 0)
  return out
}

export function visibleRows(rows: Rows): FlatRow[] {
  return flatten(buildIndex(rows), true)
}

export function allRows(rows: Rows): FlatRow[] {
  return flatten(buildIndex(rows), false)
}

// ids of every live node under `id`, depth-first, not including `id` itself.
export function descendantIds(index: TreeIndex, id: string): string[] {
  return flatten(index, false, id).map((r) => r.id)
}

export function isAncestor(index: TreeIndex, maybeAncestor: string, id: string): boolean {
  let cur = index.parentOf.get(id) ?? null
  while (cur !== null) {
    if (cur === maybeAncestor) return true
    cur = index.parentOf.get(cur) ?? null
  }
  return false
}

export function depthOf(index: TreeIndex, id: string): number {
  let d = 0
  let cur = index.parentOf.get(id) ?? null
  while (cur !== null) {
    d++
    cur = index.parentOf.get(cur) ?? null
  }
  return d
}

// n ranks that fit after `afterId` (null = at the start) among `siblings`, which are in
// sibling order and already exclude any rows being moved. Siblings can share a rank: two
// devices inserting into the same gap offline both pick the same midpoint, and the id
// tiebreak keeps them ordered. Such a run leaves no room to insert into, so the colliding
// followers are re-ranked along with the new rows (`fixes`), preserving their order.
export function allocateRanks(
  siblings: readonly NodeRow[],
  afterId: string | null,
  n: number,
): { ranks: string[]; fixes: { id: string; rank: string }[] } {
  const i = afterId === null ? -1 : siblings.findIndex((s) => s.id === afterId)
  if (afterId !== null && i < 0) throw new Error(`allocateRanks: ${afterId} is not a sibling`)
  const prev = i < 0 ? null : siblings[i]!.rank
  const following = siblings.slice(i + 1)
  let k = 0
  while (prev !== null && k < following.length && following[k]!.rank <= prev) k++
  const next = following[k]?.rank ?? null
  const all = ranksBetween(prev, next, n + k)
  return {
    ranks: all.slice(0, n),
    fixes: following.slice(0, k).map((s, j) => ({ id: s.id, rank: all[n + j]! })),
  }
}

// 1-based position within a run of consecutive numbered siblings, or null for a plain
// line. A plain sibling breaks the run, so one parent can hold several numbered lists,
// each restarting at 1 (the way Docs numbers paragraphs).
export function listNumbers(index: TreeIndex): Map<string, number> {
  const out = new Map<string, number>()
  for (const kids of index.children.values()) {
    let n = 0
    for (const k of kids) {
      if (k.numbered) out.set(k.id, ++n)
      else n = 0
    }
  }
  return out
}

// Given a set of ids, keep only those with no selected ancestor. Bulk ops (move, indent,
// delete) act on these and carry the rest along as descendants.
export function topmost(index: TreeIndex, ids: Iterable<string>): string[] {
  const set = new Set(ids)
  const out: string[] = []
  for (const id of set) {
    let cur = index.parentOf.get(id) ?? null
    let covered = false
    while (cur !== null) {
      if (set.has(cur)) {
        covered = true
        break
      }
      cur = index.parentOf.get(cur) ?? null
    }
    if (!covered) out.push(id)
  }
  // Return them in document order so callers can place them in sequence.
  const order = new Map(flatten(index, false).map((r, i) => [r.id, i]))
  return out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
}
