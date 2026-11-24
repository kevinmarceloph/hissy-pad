// The row as it travels to and from the `nodes` table (snake_case). Shared by every
// platform's Remote adapter so the mapping lives in one place.
import { normalizeRow, type NodeRow } from '../types'

export interface WireNode {
  id: string
  user_id?: string
  parent_id: string | null
  rank: string
  text: string
  done: boolean
  done_at?: string | null // optional on the wire: rows written before the column existed
  doing?: boolean  // same: added 2026-11-24
  collapsed: boolean
  numbered: boolean
  header?: boolean // optional on the wire: rows written before the column existed
  pad?: boolean    // same: added 2026-11-02
  slot?: string | null // same: added 2026-11-23
  category?: string | null // same: added 2026-11-24
  updated_at: string
  deleted_at: string | null
  synced_at?: string
}

export function toWire(raw: NodeRow): WireNode {
  const r = normalizeRow(raw)
  return {
    id: r.id,
    parent_id: r.parentId,
    rank: r.rank,
    text: r.text,
    done: r.done,
    done_at: r.doneAt,
    doing: r.doing,
    collapsed: r.collapsed,
    numbered: r.numbered,
    header: r.header,
    pad: r.pad,
    slot: r.slot,
    category: r.category,
    updated_at: r.updatedAt,
    deleted_at: r.deletedAt,
  }
}

export function fromWire(w: WireNode): { row: NodeRow; syncedAt: string } {
  return {
    row: {
      id: w.id,
      parentId: w.parent_id,
      rank: w.rank,
      text: w.text,
      done: w.done,
      doneAt: w.done && w.done_at ? new Date(w.done_at).toISOString() : null,
      // The watch crosses a line out without knowing this column, so done wins over doing.
      doing: w.doing === true && !w.done,
      collapsed: w.collapsed,
      numbered: w.numbered,
      header: w.header === true && !w.numbered,
      pad: w.pad === true,
      slot: w.slot ?? null,
      category: w.category ?? null,
      updatedAt: new Date(w.updated_at).toISOString(),
      deletedAt: w.deleted_at === null ? null : new Date(w.deleted_at).toISOString(),
    },
    syncedAt: w.synced_at ?? '',
  }
}
