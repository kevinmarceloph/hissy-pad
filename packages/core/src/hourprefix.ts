// An hour typed in front of a line puts the line in that hour (Kevin, 2026-11-27, as Hissycal
// did): "3pm call mom", "3pm-5pm write", "10-11pm read", "11pm-1am sleep". The hour is eaten
// from the text and becomes the line's slot (slot.ts). The time that ends a range needs its
// am or pm; the one that starts it borrows it when it has none, flipped when that would run
// the long way round ("11-1pm" is 11am to 1pm). A bare "3" or "3:00" is not an hour, and
// minutes other than ":00" are left alone: a slot is whole hours. Dates are not read yet.
//
// Which day: the hours of the day on screen in Hours, which starts at its day start. With
// the day starting at 6am, "11pm-1am" is tonight until 1am tomorrow, and "2am" is the night
// after today, not the one before.
import { isLive } from './tree'
import { slotKey, slotOfHours } from './slot'
import type { OpCtx, Rows } from './types'

const TIME = String.raw`(\d{1,2})(?::00)?\s*(am|pm)?`
const PREFIX = new RegExp(String.raw`^${TIME}(?:\s*-\s*${TIME})?\s+`, 'i')

const to24 = (h: number, m: string) => (h % 12) + (m === 'pm' ? 12 : 0)

// The calendar day `n` days from a day key.
function shiftKey(day: string, n: number): string {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

// The slot and the text left after it, or null when the line does not start with an hour.
// `day` is Hours' day on screen (a day key) and `start` its day start hour.
export function hourPrefix(text: string, day: string, start: number): { slot: string; text: string } | null {
  const m = PREFIX.exec(text)
  if (!m) return null
  const [whole, h1s, m1raw, h2s, m2raw] = m
  const h1 = Number(h1s)
  const m1 = m1raw?.toLowerCase()
  const m2 = m2raw?.toLowerCase()
  if (h1 < 1 || h1 > 12) return null
  let from: number
  let hours = 1
  if (h2s === undefined) {
    if (!m1) return null
    from = to24(h1, m1)
  } else {
    const h2 = Number(h2s)
    if (!m2 || h2 < 1 || h2 > 12) return null
    const end = to24(h2, m2)
    if (m1) from = to24(h1, m1)
    else {
      // Borrow the end's am or pm, or the other one when the start would come after the end.
      from = to24(h1, h1 % 12 > h2 % 12 ? (m2 === 'pm' ? 'am' : 'pm') : m2)
    }
    hours = (end - from + 24) % 24
    if (hours === 0) return null
  }
  // An hour before the day start belongs to the night after the day on screen.
  let date = from >= start ? day : shiftKey(day, 1)
  const keys: string[] = []
  for (let i = 0, h = from; i < hours; i++, h++) {
    if (h === 24) {
      h = 0
      date = shiftKey(date, 1)
    }
    keys.push(slotKey(date, h))
  }
  return { slot: slotOfHours(keys)!, text: text.slice(whole!.length) }
}

// Lines whose text starts with an hour go in it, with the hour taken off the text. A pad
// row is left as it is.
export function slotByPrefix(rows: Rows, ctx: OpCtx, ids: Iterable<string>, day: string, start: number): Rows {
  let out = rows
  for (const id of ids) {
    const r = out[id]
    if (!isLive(r) || (r.pad && r.parentId === null)) continue
    const hit = hourPrefix(r.text, day, start)
    if (hit) out = { ...out, [id]: { ...r, slot: hit.slot, text: hit.text, updatedAt: ctx.now() } }
  }
  return out
}
