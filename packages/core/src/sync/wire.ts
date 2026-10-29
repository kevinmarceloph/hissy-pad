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
  collapsed: boolean
  numbered: boolean
  header?: boolean // optional on the wire: rows written before the column existed
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
    collapsed: r.collapsed,
    numbered: r.numbered,
    header: r.header,
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
      collapsed: w.collapsed,
      numbered: w.numbered,
      header: w.header === true && !w.numbered,
      updatedAt: new Date(w.updated_at).toISOString(),
      deletedAt: w.deleted_at === null ? null : new Date(w.deleted_at).toISOString(),
    },
    syncedAt: w.synced_at ?? '',
  }
}
