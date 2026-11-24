// A line can be assigned to an hour of one day (NodeRow.slot), which is how the pad's
// items show up in Hours, or to a run of hours from there. The slot is a calendar day and
// hour in the device's local time, 'YYYY-MM-DDTHH', the same slot an hour's own row is
// stored under: never a day as drawn on a screen whose day starts at 6am. A run of hours
// adds how many: 'YYYY-MM-DDTHH+3' is that hour and the two after it, and may run past
// midnight into the next day. A single hour never carries '+1'.
import type { NodeRow, Rows } from './types'
import { isBlank, isLive } from './tree'

export const MAX_SLOT_HOURS = 24

export function slotKey(day: string, hour: number, hours = 1): string {
  const base = `${day}T${String(hour).padStart(2, '0')}`
  return hours > 1 ? `${base}+${Math.min(hours, MAX_SLOT_HOURS)}` : base
}

export function parseSlot(slot: string | null | undefined): { day: string; hour: number; hours: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(?:\+(\d{1,2}))?$/.exec(slot ?? '')
  if (!m) return null
  const hour = Number(m[2])
  const hours = m[3] === undefined ? 1 : Number(m[3])
  if (hour < 0 || hour > 23 || hours < 1 || hours > MAX_SLOT_HOURS) return null
  return { day: m[1]!, hour, hours }
}

// A day key moved by whole days, on the calendar (not by 24h, which a DST day breaks).
function addDays(day: string, n: number): string {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d + n)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Every single-hour slot a slot covers, in order: one for an hour, several for a run.
export function slotHours(slot: string | null | undefined): string[] {
  const p = parseSlot(slot)
  if (!p) return []
  const out: string[] = []
  for (let i = 0; i < p.hours; i++) {
    const h = p.hour + i
    out.push(slotKey(addDays(p.day, Math.floor(h / 24)), h % 24))
  }
  return out
}

// Whether a line's slot takes in one hour (a single-hour key, as Hours asks for its rows).
export function slotCovers(slot: string | null | undefined, hourKey: string): boolean {
  if (!slot) return false
  if (slot === hourKey) return true
  return slot.includes('+') && slotHours(slot).includes(hourKey)
}

export interface SlotCount {
  done: number
  open: number
}

// How many assigned lines are crossed out and how many are still open, per hour. Every pad
// counts, blank lines never do, and a line counts for itself only (not for what is under it).
// A line in a run of hours counts in each hour of it.
export function slotCounts(all: Rows): Record<string, SlotCount> {
  const out: Record<string, SlotCount> = {}
  for (const id in all) {
    const r = all[id]!
    if (r.slot === null || !isLive(r) || isBlank(r) || r.pad) continue
    for (const key of slotHours(r.slot)) {
      const c = (out[key] ??= { done: 0, open: 0 })
      if (r.done) c.done++
      else c.open++
    }
  }
  return out
}

// How many lines were crossed out during each hour (by doneAt, device local time) beyond the
// ones assigned to that hour, which slotCounts already has. A line cleared or deleted since
// still counts: the work was done then. Blank lines and pad rows never count, nor a line
// crossed out before doneAt existed.
export function slotDoneExtra(all: Rows): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id in all) {
    const r = all[id]!
    if (!r.done || !r.doneAt || isBlank(r) || r.pad) continue
    const at = new Date(r.doneAt)
    if (Number.isNaN(at.getTime())) continue
    const key = slotKey(todayKey(at), at.getHours())
    if (slotCovers(r.slot, key)) continue
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

// The lines in one hour (a single-hour key), a run of hours that takes it in included: open ones first, then crossed out, each group by rank
// (a line's place among its siblings), which is steady enough across pads.
export function slotLines(all: Rows, slot: string): NodeRow[] {
  const list: NodeRow[] = []
  for (const id in all) {
    const r = all[id]!
    if (slotCovers(r.slot, slot) && isLive(r) && !isBlank(r) && !r.pad) list.push(r)
  }
  return list.sort((a, b) => Number(a.done) - Number(b.done) || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) || (a.id < b.id ? -1 : 1))
}

function hourWord(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${hour < 12 ? 'am' : 'pm'}`
}

// "Mon 23 Nov, 2pm": how a line's hour reads in the pad; a run reads "Mon 23 Nov, 2pm-5pm",
// to the hour it ends at. `today` (a day key) turns its own day into "Today".
export function slotLabel(slot: string, today?: string): string {
  const p = parseSlot(slot)
  if (!p) return ''
  const [y = 1970, m = 1, d = 1] = p.day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const hour = p.hours > 1 ? `${hourWord(p.hour)}-${hourWord((p.hour + p.hours) % 24)}` : hourWord(p.hour)
  if (p.day === today) return `Today ${hour}`
  const day = date.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day}, ${hour}`
}

// Today's calendar day as a day key, device local time.
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
