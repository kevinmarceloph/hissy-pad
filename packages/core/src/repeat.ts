// Recurring items, after Things (Kevin, 2026-11-27). A line made recurring gets a template:
// a copy of it, with everything under it, kept under Later for good in a section of its own
// below the days of the boomerangs. The template carries the rule in `repeat` (JSON) and is
// "out" forever (`due` is FOREVER), so no pad's own lines count it and Sort never deals it,
// the way they leave out a boomerang. What the user works on are instances: copies of the
// template's tree, each with `origin` set to the template's id. The line that was made
// recurring is the first one.
//
// Two kinds of rule:
//   every  a new instance every n days (weeks, months, years), whatever happened to the
//          last. `keep` says what becomes of one that is still open: 'reuse' brings it back
//          as the new one, 'replace' archives it for a fresh copy, 'add' leaves both.
//   after  a new instance n days after the last one was crossed out (or archived).
//
// Instances are made when a day starts (deliverRepeats, run with the boomerangs' delivery).
// Every device makes them, so what is made has to be the same everywhere: an instance's ids
// come from the template's ids and the day (derivedId), and its rows are stamped with the
// moment that day started, as a boomerang's delivery is.
import type { NodeRow, OpCtx, Rows } from './types'
import { buildIndex, childrenOf, descendantIds, isLive } from './tree'
import { insertAt, lastPinned, moveNodes, remove } from './ops'
import { createPad, findFixedPad } from './pads'
import { slotHours, slotHoursLabel, slotKey, slotOfHours, slotRuns, parseSlot } from './slot'
import { dayStartAt, dueLabel, FOREVER } from './boomerang'
import { settleSchedule } from './schedule'
import { dayOf, shiftDay } from './hours/day'

export type RepeatMode = 'every' | 'after'
export type RepeatUnit = 'd' | 'w' | 'm' | 'y'
export type RepeatKeep = 'reuse' | 'replace' | 'add'

export interface Repeat {
  mode: RepeatMode
  n: number            // every n units, 1 or more
  unit: RepeatUnit
  keep: RepeatKeep     // 'every' only: what becomes of an instance still open when the next is due
  from: string         // 'YYYY-MM-DD': the day the count starts at; 'every' falls on from + k·n units
  next: string         // 'every': the day of the next instance. 'after': the earliest day for one
  slot: string | null  // the hours an instance is put in, as they fall for the day `at`
  at: string           // the day (Hours' day) `slot` is written for
}

// What the picker sets; the days are worked out.
export type RepeatChoice = Pick<Repeat, 'mode' | 'n' | 'unit' | 'keep'>
export const REPEAT_DEFAULT: RepeatChoice = { mode: 'every', n: 1, unit: 'w', keep: 'reuse' }
export const REPEAT_UNITS: readonly RepeatUnit[] = ['d', 'w', 'm', 'y']
export const REPEAT_KEEPS: readonly RepeatKeep[] = ['reuse', 'replace', 'add']
export const REPEAT_MAX = 999

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function parseRepeat(text: string | null | undefined): Repeat | null {
  if (!text) return null
  let v: Partial<Repeat>
  try {
    v = JSON.parse(text) as Partial<Repeat>
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  if (v.mode !== 'every' && v.mode !== 'after') return null
  if (!REPEAT_UNITS.includes(v.unit as RepeatUnit)) return null
  if (typeof v.n !== 'number' || !Number.isInteger(v.n) || v.n < 1 || v.n > REPEAT_MAX) return null
  if (typeof v.from !== 'string' || !DAY.test(v.from) || typeof v.next !== 'string' || !DAY.test(v.next)) return null
  const slot = typeof v.slot === 'string' && slotRuns(v.slot).length ? v.slot : null
  return {
    mode: v.mode,
    n: v.n,
    unit: v.unit as RepeatUnit,
    keep: REPEAT_KEEPS.includes(v.keep as RepeatKeep) ? (v.keep as RepeatKeep) : 'reuse',
    from: v.from,
    next: v.next,
    slot,
    at: typeof v.at === 'string' && DAY.test(v.at) ? v.at : v.from,
  }
}

// The keys always in this order: two devices that write the same rule write the same text.
export function formatRepeat(r: Repeat): string {
  return JSON.stringify({ mode: r.mode, n: r.n, unit: r.unit, keep: r.keep, from: r.from, next: r.next, slot: r.slot, at: r.at })
}

export function isTemplate(r: NodeRow | undefined): boolean {
  return isLive(r) && !r.pad && parseRepeat(r.repeat) !== null
}

// ---- days --------------------------------------------------------------------------------------

function parts(day: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  return [y, m, d]
}
function key(y: number, m: number, d: number): string {
  const date = new Date(y, m - 1, d)
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
// Whole days from one day to another, on the calendar.
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a)
  const [by, bm, bd] = parts(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}
// A day moved on by n units. A month or a year on from the 31st (or Feb 29) is the last day
// of a shorter month.
export function addUnits(day: string, n: number, unit: RepeatUnit): string {
  const [y, m, d] = parts(day)
  if (unit === 'd') return key(y, m, d + n)
  if (unit === 'w') return key(y, m, d + 7 * n)
  const months = unit === 'm' ? n : 12 * n
  const last = new Date(y, m - 1 + months + 1, 0).getDate()
  return key(y, m - 1 + months + 1, Math.min(d, last))
}
// The k-th day an 'every' rule falls on, counted from `from` so the 31st does not drift.
function nth(r: Pick<Repeat, 'from' | 'n' | 'unit'>, k: number): string {
  return addUnits(r.from, k * r.n, r.unit)
}
// The first day the rule falls on that is not before `day`.
export function onOrAfter(r: Pick<Repeat, 'from' | 'n' | 'unit'>, day: string): string {
  if (day <= r.from) return r.from
  const gone = daysBetween(r.from, day)
  const span = r.unit === 'd' ? r.n : r.unit === 'w' ? 7 * r.n : r.unit === 'm' ? 31 * r.n : 366 * r.n
  let k = Math.max(0, Math.floor(gone / span) - 1)
  while (nth(r, k) < day) k++
  return nth(r, k)
}
// The first day the rule falls on after `day`.
export function nextAfter(r: Pick<Repeat, 'from' | 'n' | 'unit'>, day: string): string {
  return onOrAfter(r, shiftDay(day, 1))
}

// A slot moved by whole days, hour for hour.
export function shiftSlot(slot: string | null, days: number): string | null {
  if (!slot || days === 0) return slot
  return slotOfHours(slotHours(slot).map((k) => {
    const p = parseSlot(k)!
    return slotKey(shiftDay(p.day, days), p.hour)
  }))
}
// The day of Hours a slot starts in: an hour before the day start is still the day before.
export function slotStartDay(slot: string | null, start: number): string | null {
  const first = slotRuns(slot)[0]
  if (!first) return null
  return first.hour < start ? shiftDay(first.day, -1) : first.day
}
// The hours of the instance for a day.
export function repeatSlot(r: Repeat, day: string = r.next): string | null {
  return shiftSlot(r.slot, daysBetween(r.at, day))
}

// ---- words -------------------------------------------------------------------------------------

const UNIT_WORDS: Record<RepeatUnit, [string, string]> = { d: ['day', 'days'], w: ['week', 'weeks'], m: ['month', 'months'], y: ['year', 'years'] }
export function unitWord(unit: RepeatUnit, n: number): string {
  return UNIT_WORDS[unit][n === 1 ? 0 : 1]
}
// "Every week", "Every 2 weeks", "3 days after it is done".
export function repeatLabel(r: Pick<Repeat, 'mode' | 'n' | 'unit'>): string {
  const span = r.n === 1 ? unitWord(r.unit, 1) : `${r.n} ${unitWord(r.unit, r.n)}`
  return r.mode === 'every' ? `Every ${span}` : `${r.n === 1 ? `A ${span}` : span} after it is done`
}
export const KEEP_WORDS: Record<RepeatKeep, string> = { reuse: 'Use it again', replace: 'Replace it', add: 'Add another' }

// ---- the rows ----------------------------------------------------------------------------------

// The template a row belongs to and how: the template itself, or an instance whose template
// still stands. An instance whose template is gone (archived, or no longer recurring) reads
// as an ordinary line.
export interface RepeatLink {
  role: 'template' | 'instance'
  templateId: string
  rule: Repeat
}
export function repeatLink(all: Rows, id: string): RepeatLink | null {
  const r = all[id]
  if (!r || r.pad) return null
  if (isTemplate(r)) return { role: 'template', templateId: r.id, rule: parseRepeat(r.repeat)! }
  const t = r.origin ? all[r.origin] : undefined
  if (isLive(r) && isTemplate(t)) return { role: 'instance', templateId: t!.id, rule: parseRepeat(t!.repeat)! }
  return null
}

// A copy of one line with the live lines under it: open, in no hour, on no pin, out on
// nothing. `idOf` names each copy; a row that is already in the table is left as it is.
function copyTree(all: Rows, src: string, top: Pick<NodeRow, 'id' | 'parentId' | 'rank'>, idOf: (id: string) => string, stamp: string): NodeRow[] {
  const index = buildIndex(all)
  const out: NodeRow[] = []
  const ids = new Map<string, string>([[src, top.id]])
  for (const id of [src, ...descendantIds(index, src)]) {
    const s = all[id]!
    const copyId = id === src ? top.id : idOf(id)
    ids.set(id, copyId)
    out.push({
      ...s,
      id: copyId,
      parentId: id === src ? top.parentId : (ids.get(index.parentOf.get(id) ?? '') ?? top.id),
      rank: id === src ? top.rank : s.rank,
      done: false, doneAt: null, doing: false, pad: false, slot: null, pinned: false, countHidden: false,
      due: null, fresh: false, repeat: null, origin: null,
      updatedAt: stamp, deletedAt: null,
    })
  }
  return out
}

// Make a line recurring: its template goes under Later, at the end, and the line itself is
// the first instance. A line with an hour starts the count on that hour's day and gives
// every instance the same hours; any other starts today. Pad rows and templates are left
// alone. Returns the template's id, '' when nothing was made.
export function makeRepeat(all: Rows, ctx: OpCtx, id: string, choice: RepeatChoice, today: string, start: number): { rows: Rows; templateId: string } {
  const row = all[id]
  if (!isLive(row) || row.pad || row.repeat) return { rows: all, templateId: '' }
  let out = all
  let later = findFixedPad(out, 'Later')?.id
  if (!later) {
    const made = createPad(out, ctx, 'Later')
    out = made.rows
    later = made.padId
  }
  const day = slotStartDay(row.slot, start)
  const from = day && day > today ? day : today
  const base = { ...clean(choice), from }
  const rule: Repeat = { ...base, next: choice.mode === 'every' ? nextAfter(base, from) : from, slot: day ? shiftSlot(row.slot, daysBetween(day, from)) : null, at: from }
  const last = childrenOf(buildIndex(out), later).at(-1)
  const placed = insertAt(out, ctx, { parentId: later, afterId: last?.id ?? null }, row.text)
  out = placed.rows
  const top = out[placed.newId]!
  const stamp = ctx.now()
  const copies = copyTree(out, id, top, () => ctx.newId(), stamp)
  const next: Record<string, NodeRow> = { ...out }
  for (const c of copies) next[c.id] = c
  next[top.id] = { ...next[top.id]!, due: FOREVER, repeat: formatRepeat(rule) }
  // As it is now: placing the template may have re-ranked it, when the line is in Later itself.
  next[id] = { ...next[id]!, origin: top.id, updatedAt: ctx.now() }
  return { rows: next, templateId: top.id }
}

function clean(c: RepeatChoice): RepeatChoice {
  return {
    mode: c.mode === 'after' ? 'after' : 'every',
    n: Math.min(REPEAT_MAX, Math.max(1, Math.round(c.n) || 1)),
    unit: REPEAT_UNITS.includes(c.unit) ? c.unit : 'w',
    keep: REPEAT_KEEPS.includes(c.keep) ? c.keep : 'reuse',
  }
}

function writeRule(all: Rows, ctx: OpCtx, id: string, rule: Repeat): Rows {
  const text = formatRepeat(rule)
  const r = all[id]!
  return r.repeat === text ? all : { ...all, [id]: { ...r, repeat: text, updatedAt: ctx.now() } }
}

// Change a template's rule. The count keeps the day it started at; the next day is the
// first one the new rule falls on after today (or the start, while that is still ahead).
export function setRepeat(all: Rows, ctx: OpCtx, templateId: string, choice: RepeatChoice, today: string): Rows {
  const t = all[templateId]
  const was = isTemplate(t) ? parseRepeat(t!.repeat) : null
  if (!was) return all
  const c = clean(choice)
  const base = { ...was, ...c }
  const next = c.mode === 'every' ? (was.from > today ? was.from : nextAfter(base, today)) : was.from > today ? was.from : today
  return writeRule(all, ctx, templateId, { ...base, next })
}

// The hours a template's instances are put in, from the hour picker: `slot` is where the
// next one goes. A slot on a day still ahead moves the next instance (and the count) to
// that day; null takes the hours off.
export function setRepeatSlot(all: Rows, ctx: OpCtx, templateId: string, slot: string | null, today: string, start: number): Rows {
  const t = all[templateId]
  const was = isTemplate(t) ? parseRepeat(t!.repeat) : null
  if (!was) return all
  const day = slotStartDay(slot, start)
  if (!day) return writeRule(all, ctx, templateId, { ...was, slot: null })
  if (day > today) return writeRule(all, ctx, templateId, { ...was, slot, at: day, from: day, next: day })
  return writeRule(all, ctx, templateId, { ...was, slot, at: day })
}

// A template is an ordinary line of Later again. Its instances stay as they are.
export function stopRepeat(all: Rows, ctx: OpCtx, templateId: string): Rows {
  const t = all[templateId]
  if (!t || !t.repeat) return all
  return { ...all, [templateId]: { ...t, repeat: null, due: t.due === FOREVER ? null : t.due, updatedAt: ctx.now() } }
}

// Instances cut loose from their templates: ordinary lines from here on. An 'after' rule
// counts from today, as if its instance had been done, so the next one still comes.
export function unlinkRepeat(all: Rows, ctx: OpCtx, ids: Iterable<string>, today: string): Rows {
  let out = all
  for (const id of ids) {
    const r = out[id]
    if (!r || !r.origin) continue
    const t = out[r.origin]
    const rule = isTemplate(t) ? parseRepeat(t!.repeat) : null
    out = { ...out, [id]: { ...r, origin: null, updatedAt: ctx.now() } }
    if (rule && rule.mode === 'after' && isLive(r) && !r.done) {
      const next = addUnits(today, rule.n, rule.unit)
      if (next > rule.next) out = writeRule(out, ctx, t!.id, { ...rule, next })
    }
  }
  return out
}

// Keep the templates where they belong. Over the rows given (all of them when none are):
//   1. A template is a top-level line of Later, out for good: `due` is FOREVER, it is in
//      no hour and on no pin. One that is anywhere else (nested, moved to another pad, made
//      a pad) is no template any more: it loses its rule.
//   2. A line out for good with no rule is not out.
// settleBoomerangs then keeps them last under Later, as the group of the furthest day.
// The store runs it before that, after every edit and every sync merge.
export function settleRepeats(all: Rows, ctx: OpCtx, touched?: Iterable<string>): Rows {
  const later = findFixedPad(all, 'Later')?.id
  let out = all
  for (const id of touched ?? Object.keys(all)) {
    const r = out[id]
    if (!r || r.deletedAt !== null) continue
    if (r.repeat) {
      if (r.pad || !later || r.parentId !== later || !parseRepeat(r.repeat)) out = { ...out, [id]: { ...r, repeat: null, due: r.due === FOREVER ? null : r.due, updatedAt: ctx.now() } }
      else if (r.due !== FOREVER || r.slot !== null || r.pinned) out = { ...out, [id]: { ...r, due: FOREVER, slot: null, pinned: false, updatedAt: ctx.now() } }
    } else if (r.due === FOREVER) out = { ...out, [id]: { ...r, due: null, updatedAt: ctx.now() } }
  }
  return out
}

// ---- delivery ----------------------------------------------------------------------------------

// An id made from two strings, the same on every device: a template's row and a day give
// the row of that day's instance. Shaped like a uuid, which is what the server's column is.
export function derivedId(a: string, b: string): string {
  const text = `${a}|${b}`
  const h = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h[0] = Math.imul(h[0]! ^ c, 0x01000193)
    h[1] = Math.imul(h[1]! ^ c, 0x85ebca6b) ^ (h[0]! >>> 13)
    h[2] = Math.imul(h[2]! ^ c, 0xc2b2ae35) ^ (h[1]! >>> 16)
    h[3] = Math.imul(h[3]! ^ c, 0x27d4eb2f) ^ (h[2]! >>> 15)
  }
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 4; i++) {
      let x = h[i]! ^ h[(i + 1) % 4]!
      x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
      x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
      h[i] = x ^ (x >>> 16)
    }
  }
  const hex = h.map((x) => (x! >>> 0).toString(16).padStart(8, '0')).join('')
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

// The top rows made from a template, archived ones too.
function instancesOf(all: Rows, templateId: string): NodeRow[] {
  const out: NodeRow[] = []
  for (const id in all) {
    const r = all[id]!
    if (r.origin === templateId && !r.pad && !r.repeat) out.push(r)
  }
  return out
}

// The day an 'after' rule's next instance is for, or null while one is still open: n units
// after the last one was crossed out or archived, and never before the rule's own day.
function afterDay(all: Rows, t: NodeRow, rule: Repeat, start: number): string | null {
  let ended: string | null = null
  for (const r of instancesOf(all, t.id)) {
    if (r.deletedAt === null && !r.done) return null
    const when = r.deletedAt === null ? r.doneAt ?? r.updatedAt : r.done && r.doneAt ? r.doneAt : r.deletedAt
    const day = dayOf(new Date(when), start)
    if (ended === null || day > ended) ended = day
  }
  if (ended === null) return rule.next
  const due = addUnits(ended, rule.n, rule.unit)
  return due > rule.next ? due : rule.next
}

// The earliest day a template has an instance to make, or null: what the delivery's timer
// waits for.
export function nextRepeatDay(all: Rows, start: number): string | null {
  let first: string | null = null
  for (const id in all) {
    const t = all[id]!
    if (!isTemplate(t)) continue
    const rule = parseRepeat(t.repeat)!
    const day = rule.mode === 'every' ? rule.next : afterDay(all, t, rule, start)
    if (day && (first === null || day < first)) first = day
  }
  return first
}

// An 'every' rule's missed days are made up one by one only where each is its own item.
const CATCH_UP = 30

// Make the instances whose day has come (`today` is the day that holds this moment, by the
// day start). Each goes to the top of Today, under its pins, marked fresh; one with hours
// goes on to Today's Scheduled section. The rows are stamped with the moment the instance's
// day started and named by derivedId, so every device that makes the delivery writes the
// same rows. Returns `all` itself when nothing was due.
export function deliverRepeats(all: Rows, ctx: OpCtx, today: string, start: number): Rows {
  let out = all
  const templates = Object.values(all).filter(isTemplate).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1))
  // The last one made ends up on top, so the list is walked from its end.
  for (const t of templates.reverse()) {
    const rule = parseRepeat(t.repeat)!
    if (rule.mode === 'after') {
      const day = afterDay(out, t, rule, start)
      if (day && day <= today) out = spawn(out, t, rule, day, start)
      continue
    }
    if (rule.next > today) continue
    const days: string[] = []
    let next = rule.next
    for (let i = 0; next <= today && i < 5000; i++) {
      days.push(next)
      next = nextAfter(rule, next)
    }
    for (const day of rule.keep === 'add' ? days.slice(-CATCH_UP) : days.slice(-1)) {
      const at = stampFor(day, start)
      const open = instancesOf(out, t.id).filter((r) => r.deletedAt === null && !r.done)
      if (rule.keep === 'reuse' && open.length) {
        const today_ = todayPad(out)
        for (const r of open) {
          const stamp = at > r.updatedAt ? at : ctx.now()
          const stamped = { ...ctx, now: () => stamp }
          out = moveNodes(out, stamped, [r.id], { parentId: today_, afterId: lastPinned(out, today_, new Set([r.id])) })
          out = { ...out, [r.id]: { ...out[r.id]!, fresh: true, due: null, slot: repeatSlot(rule, day), updatedAt: stamp } }
        }
        continue
      }
      if (rule.keep === 'replace' && open.length) out = remove(out, { ...ctx, now: () => at }, open.map((r) => r.id))
      out = spawn(out, t, rule, day, start)
    }
    const at = stampFor(days.at(-1)!, start)
    out = writeRule(out, { ...ctx, now: () => (at > t.updatedAt ? at : ctx.now()) }, t.id, { ...rule, next })
  }
  return out === all ? all : settleSchedule(out, ctx)
}

function stampFor(day: string, start: number): string {
  return dayStartAt(day, start).toISOString()
}
function todayPad(all: Rows): string | null {
  return findFixedPad(all, 'Today')?.id ?? null
}

// One instance of a template for a day. A row of that name already in the table (another
// device made it, or it was made and then cut loose) is not made again.
function spawn(all: Rows, t: NodeRow, rule: Repeat, day: string, start: number): Rows {
  const id = derivedId(t.id, day)
  if (all[id]) return all
  const at = stampFor(day, start)
  const pad = todayPad(all)
  const placed = insertAt(all, { now: () => at, newId: () => id }, { parentId: pad, afterId: lastPinned(all, pad) }, t.text)
  const top = placed.rows[id]!
  const next: Record<string, NodeRow> = { ...placed.rows }
  for (const c of copyTree(placed.rows, t.id, top, (src) => derivedId(src, day), at)) if (c.id === id || !all[c.id]) next[c.id] = c
  next[id] = { ...next[id]!, origin: t.id, fresh: true, slot: repeatSlot(rule, day) }
  return next
}

// "Every 2 weeks, next Fri, Dec 11 at 9am" for a template's row and the picker: the rule, the
// day of the next instance, and the hours its instances are put in, if it has any.
export function repeatNote(all: Rows, templateId: string, today: string, start: number): string {
  const t = all[templateId]
  const rule = isTemplate(t) ? parseRepeat(t!.repeat) : null
  if (!rule) return ''
  const day = rule.mode === 'every' ? rule.next : afterDay(all, t!, rule, start)
  const hours = slotHoursLabel(rule.slot)
  if (!day) return hours ? `${repeatLabel(rule)}, at ${hours}` : repeatLabel(rule)
  const label = day <= today ? 'today' : dueLabel(day, today)
  return `${repeatLabel(rule)}, next ${label === 'Tomorrow' ? 'tomorrow' : label}${hours ? ` at ${hours}` : ''}`
}
