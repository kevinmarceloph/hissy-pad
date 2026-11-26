// Today has two sections (Kevin, 2026-11-27): its own lines, in the order they are given,
// and under them "Scheduled": the top-level lines put in an hour, always in the order of
// their hours, so a line given an hour goes to its place by itself. It is built the way
// Later keeps its days (boomerang.ts): by the order of the pad's top-level lines.
//
// A pinned line stays with the pins whatever its hour, and only a top-level line counts: a
// line under another rides with it. A line in several hours goes by the first.
import type { NodeRow, OpCtx, Rows } from './types'
import { buildIndex, childrenOf, isLive, type FlatRow } from './tree'
import { findFixedPad } from './pads'
import { slotKey, slotRuns } from './slot'
import { joins, keepGroups } from './boomerang'

// What a top-level line of Today is ordered by: '' for one of the pad's own (and a pin),
// else the first hour it is in ('YYYY-MM-DDTHH').
export function scheduledKey(r: NodeRow | undefined): string {
  if (!r || r.pinned || !r.slot) return ''
  const first = slotRuns(r.slot)[0]
  return first ? slotKey(first.day, first.hour) : ''
}

// Whether a pad row is Today. By name alone, so it is cheap enough for a selector; a
// duplicate is folded away by settleFixedPads.
export function isTodayPad(all: Rows, padId: string | null): boolean {
  const r = padId === null ? undefined : all[padId]
  return isLive(r) && r.pad && r.parentId === null && r.text.trim().toLowerCase() === 'today'
}

// Keep Today's sections. Over its top-level lines:
//
//   1. A line with no hour that sits among the scheduled ones takes the hour of the line
//      above it, if it is new or came from inside a scheduled line (Enter in the section, a
//      sub item dedented). `prev` is the table before the edit; without it (after a sync
//      merge) nothing joins.
//   2. The pad's own lines rank first, then the scheduled ones, earliest first. A line
//      found out of place goes to the near edge of where it belongs: a scheduled line
//      dragged goes back among its hour's, and one of the pad's own dropped in the section
//      goes back to the end of its own.
//
// The store runs it after every edit that moves a line or changes an hour (in the same
// undo step) and after every sync merge. Returns `all` itself when nothing needed fixing.
export function settleSchedule(all: Rows, ctx: OpCtx, prev?: Rows): Rows {
  const today = findFixedPad(all, 'Today')?.id
  if (!today) return all
  let out = all
  let sibs = childrenOf(buildIndex(out), today).filter((s) => !s.pad)
  if (!sibs.some((s) => scheduledKey(s))) return out
  if (prev) {
    let slot: string | null = null
    for (const s of sibs) {
      if (scheduledKey(s)) slot = s.slot
      else if (slot && !s.pinned && !s.slot && joins(prev, s.id, today, (r) => !!scheduledKey(r))) out = { ...out, [s.id]: { ...out[s.id]!, slot, updatedAt: ctx.now() } }
    }
    sibs = sibs.map((s) => out[s.id]!)
  }
  return keepGroups(out, ctx, today, sibs, scheduledKey)
}

// Where the section's heading goes in Today's view: the id of the first scheduled
// top-level row, or null. `flat` is the rows as drawn.
export function scheduleHead(flat: readonly Pick<FlatRow, 'id' | 'depth'>[], rows: Rows): string | null {
  for (const f of flat) if (f.depth === 0 && scheduledKey(rows[f.id])) return f.id
  return null
}
