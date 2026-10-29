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
  header: boolean           // bold, with a "#" for a bullet; never numbered at the same time
  updatedAt: string         // ISO timestamp from the client that made the change (clock.ts)
  deletedAt: string | null  // tombstone; clients never hard-delete
}

// Fill in fields a row written by an older build may lack (a column added later). Any
// row read from local storage goes through this before it is used or pushed.
export function normalizeRow(r: Partial<NodeRow> & { id: string }): NodeRow {
  return {
    id: r.id,
    parentId: r.parentId ?? null,
    rank: r.rank ?? 'a0',
    text: r.text ?? '',
    done: r.done === true,
    collapsed: r.collapsed === true,
    numbered: r.numbered === true,
    header: r.header === true && r.numbered !== true,
    updatedAt: r.updatedAt ?? new Date(0).toISOString(),
    deletedAt: r.deletedAt ?? null,
  }
}

// The three ways a line can look. Stored as two booleans (numbered, header) so the column
// set only ever grows; kindOf/setKind keep them exclusive.
export type NodeKind = 'plain' | 'numbered' | 'header'

export function kindOf(r: Pick<NodeRow, 'numbered' | 'header'>): NodeKind {
  return r.numbered ? 'numbered' : r.header ? 'header' : 'plain'
}

// The client's whole local copy, keyed by id. Ops take one and return a new one with
// structural sharing: only the changed rows are new objects.
export type Rows = Readonly<Record<string, NodeRow>>

// What an op needs from the outside world. Kept injectable so tests are deterministic.
export interface OpCtx {
  now: () => string   // monotonic ISO timestamp, see createClock
  newId: () => string // uuid
}
