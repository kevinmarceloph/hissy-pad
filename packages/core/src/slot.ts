// A line can be assigned to one hour of one day (NodeRow.slot), which is how the pad's
// items show up in Hours. The slot is a calendar day and hour in the device's local time,
// 'YYYY-MM-DDTHH', the same slot an hour's own row is stored under: never a day as drawn
// on a screen whose day starts at 6am.
import type { NodeRow, Rows } from './types'
import { isBlank, isLive } from './tree'

export function slotKey(day: string, hour: number): string {
  return `${day}T${String(hour).padStart(2, '0')}`
}

export function parseSlot(slot: string | null | undefined): { day: string; hour: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/.exec(slot ?? '')
  if (!m) return null
  const hour = Number(m[2])
  return hour >= 0 && hour <= 23 ? { day: m[1]!, hour } : null
}

export interface SlotCount {
  done: number
  open: number
}

// How many assigned lines are crossed out and how many are still open, per slot. Every pad
// counts, blank lines never do, and a line counts for itself only (not for what is under it).
export function slotCounts(all: Rows): Record<string, SlotCount> {
  const out: Record<string, SlotCount> = {}
  for (const id in all) {
    const r = all[id]!
    if (r.slot === null || !isLive(r) || isBlank(r) || r.pad) continue
    const c = (out[r.slot] ??= { done: 0, open: 0 })
    if (r.done) c.done++
    else c.open++
  }
  return out
}

// The lines assigned to one slot: open ones first, then crossed out, each group by rank
// (a line's place among its siblings), which is steady enough across pads.
export function slotLines(all: Rows, slot: string): NodeRow[] {
  const list: NodeRow[] = []
  for (const id in all) {
    const r = all[id]!
    if (r.slot === slot && isLive(r) && !isBlank(r) && !r.pad) list.push(r)
  }
  return list.sort((a, b) => Number(a.done) - Number(b.done) || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) || (a.id < b.id ? -1 : 1))
}

// "Mon 23 Nov, 2pm": how a line's hour reads in the pad. `today` (a day key) turns its
// own day into "Today".
export function slotLabel(slot: string, today?: string): string {
  const p = parseSlot(slot)
  if (!p) return ''
  const [y = 1970, m = 1, d = 1] = p.day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12
  const hour = `${h}${p.hour < 12 ? 'am' : 'pm'}`
  if (p.day === today) return `Today ${hour}`
  const day = date.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day}, ${hour}`
}

// Today's calendar day as a day key, device local time.
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
