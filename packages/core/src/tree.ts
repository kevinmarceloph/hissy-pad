import type { NodeRow, Rows } from './types'
import { compareRank } from './rank'

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
