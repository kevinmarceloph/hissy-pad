// One row of the `nodes` table. Flat on purpose: the tree is derived from parentId + rank
// (see tree.ts), and every edit is a change to one or more rows, which is what makes
// per-row sync possible (PLAN.md, "Data model").
export interface NodeRow {
  id: string
  parentId: string | null   // null = top level of the pad
  rank: string              // fractional index among siblings (rank.ts); tiebreak by id
  text: string              // plain text, may contain newlines
  done: boolean
  collapsed: boolean        // synced across devices on purpose
  numbered: boolean         // shown as "1." within its run of consecutive numbered siblings
  updatedAt: string         // ISO timestamp from the client that made the change (clock.ts)
  deletedAt: string | null  // tombstone; clients never hard-delete
}

// The client's whole local copy, keyed by id. Ops take one and return a new one with
// structural sharing: only the changed rows are new objects.
export type Rows = Readonly<Record<string, NodeRow>>

// What an op needs from the outside world. Kept injectable so tests are deterministic.
export interface OpCtx {
  now: () => string   // monotonic ISO timestamp, see createClock
  newId: () => string // uuid
}
