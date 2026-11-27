// One row of the `nodes` table. Flat on purpose: the tree is derived from parentId + rank
// (see tree.ts), and every edit is a change to one or more rows, which is what makes
// per-row sync possible (PLAN.md, "Data model").
export interface NodeRow {
  id: string
  parentId: string | null   // null = top level of the pad
  rank: string              // fractional index among siblings (rank.ts); tiebreak by id
  text: string              // plain text, may contain newlines
  done: boolean
  doneAt: string | null     // when `done` last flipped on; null when not done or done before the column existed
  doing: boolean            // being worked on: the middle of open, doing, done; never true on a done line
  collapsed: boolean        // synced across devices on purpose
  numbered: boolean         // shown as "1." within its run of consecutive numbered siblings
  header: boolean           // bold, with a "#" for a bullet; never numbered at the same time
  divider: boolean          // a section divider: a rule across the pad with its text, if any, centered and gray; never has lines under it, never done
  pad: boolean              // a root-level node that is a pad of its own (pads.ts); its subtree is that pad
  slot: string | null       // the hour this line is assigned to in Hours, 'YYYY-MM-DDTHH' (a calendar day and hour, device local time; slot.ts)
  category: string | null   // the id of one of Hours' categories (hour_categories.id); drawn as its icon before the text
  pinned: boolean           // kept at the top of its pad, above a divider (pins.ts); only ever true on a pad's top-level line
  countHidden: boolean      // a pad row whose tab leaves out its count of open lines (set from the pad's sheet; synced)
  due: string | null        // boomeranged: out of the pads until this day, 'YYYY-MM-DD' (boomerang.ts); kept under Later meanwhile
  fresh: boolean            // came back to the Inbox from a boomerang and has not been touched since: drawn with a dot
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
    doneAt: r.done === true ? (r.doneAt ?? null) : null,
    doing: r.doing === true && r.done !== true,
    collapsed: r.collapsed === true,
    numbered: r.numbered === true,
    header: r.header === true && r.numbered !== true,
    divider: r.divider === true && r.numbered !== true && r.header !== true,
    pad: r.pad === true,
    slot: r.slot ?? null,
    category: r.category ?? null,
    pinned: r.pinned === true,
    countHidden: r.countHidden === true,
    due: r.due ?? null,
    fresh: r.fresh === true,
    updatedAt: r.updatedAt ?? new Date(0).toISOString(),
    deletedAt: r.deletedAt ?? null,
  }
}

// Every column of a row, listed once. The Record type makes the compiler insist that a
// new NodeRow field is added here too, which is what keeps sameRow honest.
const ROW_FIELDS: Record<keyof NodeRow, true> = {
  id: true, parentId: true, rank: true, text: true, done: true, doneAt: true, doing: true, collapsed: true,
  numbered: true, header: true, divider: true, pad: true, slot: true, category: true, pinned: true, countHidden: true, due: true, fresh: true, updatedAt: true, deletedAt: true,
}
export const ROW_KEYS = Object.keys(ROW_FIELDS) as (keyof NodeRow)[]

// True when two rows hold the same value in every column.
export function sameRow(a: Partial<NodeRow>, b: Partial<NodeRow>): boolean {
  return ROW_KEYS.every((k) => a[k] === b[k])
}

// The four ways a line can look. Stored as three booleans (numbered, header, divider) so the column
// set only ever grows; kindOf/setKind keep them exclusive.
export type NodeKind = 'plain' | 'numbered' | 'header' | 'divider'

// The three states a line goes through: open (•), doing (a dot in a ring), done (×). Stored
// as two booleans (done, doing) so `done` keeps meaning what it always has everywhere else.
export type LineState = 'open' | 'doing' | 'done'

export function stateOf(r: Pick<NodeRow, 'done' | 'doing'>): LineState {
  return r.done ? 'done' : r.doing ? 'doing' : 'open'
}

export function kindOf(r: Pick<NodeRow, 'numbered' | 'header'> & { divider?: boolean }): NodeKind {
  return r.numbered ? 'numbered' : r.header ? 'header' : r.divider ? 'divider' : 'plain'
}

// The client's whole local copy, keyed by id. Ops take one and return a new one with
// structural sharing: only the changed rows are new objects.
export type Rows = Readonly<Record<string, NodeRow>>

// What an op needs from the outside world. Kept injectable so tests are deterministic.
export interface OpCtx {
  now: () => string   // monotonic ISO timestamp, see createClock
  newId: () => string // uuid
}
