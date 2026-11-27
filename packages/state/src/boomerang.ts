// Boomerang: send lines out of the pads until a later day (core/boomerang.ts). The commands
// the toolbar and Later's section run, the picker's opener, and the delivery: when a day
// starts (the hour set in Hours), what is due comes back to the top of Later with a dot.
import {
  boomerang, boomerangGroups, clearFresh, comeBack, dayStartAt, deliverDue, deliverRepeats, dueLabel, FOREVER, isBoomeranged, nextRepeatDay, type BoomerangGroup, type Rows,
} from '@hissypad/core'
import { dayOf, shiftDay } from '@hissypad/core/hours'

import { applyAll, applyQuiet, setAfterSettle, usePad } from './store'
import { clearSelection, holdEditing, stopEditing, targets } from './selection'
import { hoursIfOpen, openHours } from './hours'

// The hour a day starts at: Hours' setting, which follows the account.
async function dayStart(): Promise<number> {
  return (await openHours()).day.getState().start
}

// The day this moment belongs to, and the first day a line can be sent out until.
export function boomerangToday(start: number, now: Date = new Date()): string {
  return dayOf(now, start)
}

// Send the targets out until `due`. They leave the view, so the selection and the caret go.
// Returns how many lines it was asked about.
export function cmdBoomerang(due: string, ids: readonly string[] = targets()): number {
  if (ids.length === 0) return 0
  const before = usePad.getState().all
  const after = applyAll((all, ctx) => boomerang(all, ctx, ids, due), { label: 'cmdBoomerang' })
  if (after === before) return 0
  const { rows, selection, editing } = usePad.getState()
  if (selection.some((id) => !(id in rows))) clearSelection()
  if (editing && !(editing.id in rows)) stopEditing()
  return ids.filter((id) => after[id]?.due === due).length
}

// From Later's section: back to the top of Later's own lines now.
export function cmdComeBack(ids: readonly string[]): number {
  const n = ids.filter((id) => isBoomeranged(usePad.getState().all[id])).length
  if (n) applyAll((all, ctx) => comeBack(all, ctx, ids), { label: 'cmdComeBack' })
  return n
}

// The dot before a line that came back was pressed: it has been seen.
export function cmdClearFresh(id: string) {
  applyAll((all, ctx) => clearFresh(all, ctx, [id]), { label: 'cmdClearFresh' })
}

// What Later lists under its own lines.
export function boomerangList(all: Rows = usePad.getState().all): BoomerangGroup[] {
  return boomerangGroups(all)
}

// The day picker is a screen of each app's (the shared BoomerangPicker in packages/ui, in a
// dialog on web and a modal on the phone), as the hour picker is: the toolbar's action only
// asks for it. The lines are taken when the picker opens, since the picker taking focus
// ends the edit before the answer comes back.
let openPicker: ((ids: readonly string[]) => void) | null = null
let picked: string[] = []
export function setBoomerangPickerOpener(open: ((ids: readonly string[]) => void) | null) {
  openPicker = open
}
export function cmdPickBoomerang(ids: readonly string[] = targets()) {
  if (ids.length === 0 || !openPicker) return
  holdEditing()
  picked = [...ids]
  openPicker(picked)
}

// The day the targets are out until, when they share one: what the picker opens on.
export function targetDue(ids: readonly string[] = targets()): string | null {
  const { all } = usePad.getState()
  const days = new Set(ids.map((id) => all[id]?.due ?? null))
  const day = days.size === 1 ? [...days][0]! : null
  // A recurring item's template is out for good, which is no day to open on.
  return day === FOREVER ? null : day
}

// The day a line is out until, in words, counted from the day this moment belongs to: the
// chip on a card (Sort's, the new item's).
export function dueWords(due: string, now: Date = new Date()): string {
  return dueLabel(due, dayOf(now, hoursIfOpen()?.day.getState().start ?? 0))
}

// What the picker's answer does, with the line the app shows afterwards. `today` is the day
// the picker counted from. null is the picker's "Back now", offered for lines already out.
export function cmdApplyBoomerang(due: string | null, today: string): string {
  const ids = picked.length ? picked : targets()
  picked = []
  if (due === null) return cmdComeBack(ids) ? 'Back in Later.' : ''
  const n = cmdBoomerang(due, ids)
  void armDelivery()
  if (n === 0) return ''
  const label = dueLabel(due, today)
  return `${n} ${n === 1 ? 'line is' : 'lines are'} out until ${label === 'Tomorrow' ? 'tomorrow' : label}.`
}

// The quick choices the picker leads with, counted from the day this moment belongs to.
export function boomerangChoices(today: string): { label: string; due: string }[] {
  const [y = 1970, m = 1, d = 1] = today.split('-').map(Number)
  const weekday = new Date(y, m - 1, d).getDay()
  // The Monday after today; a Sunday's is tomorrow, so it gives the one a week on.
  const toMonday = ((8 - weekday) % 7 || 7) + (weekday === 0 ? 7 : 0)
  return [
    { label: 'Tomorrow', due: shiftDay(today, 1) },
    { label: 'In 3 days', due: shiftDay(today, 3) },
    { label: 'Next Monday', due: shiftDay(today, toMonday) },
    { label: 'In a month', due: shiftDay(today, 30) },
  ]
}

// ---- delivery ---------------------------------------------------------------------------------

// Bring back every line whose day has started, and make the instances of the recurring
// items whose day has come (core/repeat.ts). Run after load, after every sync merge, when
// the app comes to the front (refresh) and by a timer set for the next day start that has
// something due. Left out of undo: it is not an edit. Returns how many came back.
export async function deliverBoomerangs(now: Date = new Date()): Promise<number> {
  if (boomerangGroups(usePad.getState().all).length === 0) return 0
  const start = await dayStart()
  const out = () => boomerangGroups(usePad.getState().all).reduce((n, g) => n + (g.due === FOREVER ? 0 : g.lines.length), 0)
  const before = out()
  const today = boomerangToday(start, now)
  applyQuiet((all, ctx) => deliverDue(all, ctx, today, start), 'boomerang:deliver')
  applyQuiet((all, ctx) => deliverRepeats(all, ctx, today, start), 'repeat:deliver')
  arm(start, now)
  return before - out()
}

// One timer, for the moment the earliest day still out starts: a boomerang's day, or the
// day a recurring item is next due. With a template in the table it never waits past the
// next day start, since crossing an instance out can make the day after one. A timer cannot
// wait longer than about 24 days, so a day further off is looked at again when that runs out.
let timer: ReturnType<typeof setTimeout> | null = null
const LONGEST = 2 ** 31 - 1
function arm(start: number, now: Date = new Date()) {
  if (timer !== null) clearTimeout(timer)
  timer = null
  const { all } = usePad.getState()
  const groups = boomerangGroups(all)
  const days = [groups.find((g) => g.due !== FOREVER)?.due, nextRepeatDay(all, start), groups.some((g) => g.due === FOREVER) ? shiftDay(boomerangToday(start, now), 1) : null]
  // Only a day still ahead: what is due already was just delivered, or cannot be.
  const today = boomerangToday(start, now)
  const first = days.filter((d): d is string => !!d && d > today).sort()[0]
  if (!first) return
  const wait = Math.max(1000, dayStartAt(first, start).getTime() - Date.now() + 500)
  timer = setTimeout(() => {
    timer = null
    void deliverBoomerangs()
  }, Math.min(wait, LONGEST))
}
export async function armDelivery() {
  if (boomerangGroups(usePad.getState().all).length) arm(await dayStart())
}

// Tests: no timer left behind.
export function stopBoomerangTimer() {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

setAfterSettle(() => void deliverBoomerangs().catch(() => {}))
