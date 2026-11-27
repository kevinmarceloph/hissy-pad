// The app's side of everything that lives outside it on Apple devices (the home-screen
// widgets, Siri, the watch), without the phone: what they are given to draw (a snapshot
// of every pad's top lines) and what happens to what is done there (a queue of actions,
// applied the next time the app is in front). The widget is a
// separate process that cannot run this code, so the two only ever exchange these two
// JSON values through shared storage (apps/mobile/src/widget.ts writes and reads them,
// targets/widget/*.swift is the other end).
import {
  buildIndex, childrenOf, countLines, padLines, descendantIds, insertAt, isBlank, isLive, isPadNode, setDone, slotHours, slotKey,
  slotTops, stateOf, todayKey,
  type LineState, type NodeRow, type PadId, type Rows, type TreeIndex,
} from '@hissypad/core'
import { applyAll, usePad } from './store'
import { doingState } from './commands'
import { MAIN_PAD_NAME, padList } from './pads'
import { padOf } from './lists'
import { sendToTarget, sortTarget, useSort, type SortChoice } from './sort'
import { log } from './log'

// The root level's key in the snapshot, the Inbox (every other pad is keyed by its row id).
export const WIDGET_MAIN = 'main'
export const WIDGET_INBOX_NAME = MAIN_PAD_NAME
const MAX_ITEMS = 25 // open lines per pad: the widget shows a handful; the watch lists them all
const MAX_LINES = 50 // lines per pad, the crossed-out ones among them included
const MAX_TEXT = 140
const MAX_HOUR_ITEMS = 30 // an hour's lines and what is under them
const MAX_DEPTH = 4 // how far the widget indents
const HOURS_AHEAD = 7 * 24 // the app may not run for days: the widget keeps turning the hour

export interface WidgetItem {
  id: string
  text: string // first line, cut to a length a widget can show
  subs: number // how many lines are under it, blank ones not counted
  state?: 'doing' | 'done' // left out for an open line
  depth?: number // in an hour: how far under one of the hour's lines; left out for the line itself
}

export interface WidgetPad {
  id: string // WIDGET_MAIN or a pad's row id
  name: string
  count: number // open top-level lines in the pad, which may be more than `items` holds
  // The pad's top-level lines as the pad reads, the crossed-out ones still in place (Kevin,
  // 2026-11-25: a line marked done stays on the widget). The watch and the Inbox widget's
  // top line take the open ones.
  items: WidgetItem[]
}

// A category as a widget can draw it: the widget has no palette of its own.
export interface WidgetCategory {
  label: string
  icon: string // one emoji, or ''
  light: string // its color, as hex, per scheme
  dark: string
}

// One hour of a day: the lines put in it, each followed by what is under it.
export interface WidgetHour {
  items: WidgetItem[]
  category?: WidgetCategory // the category of the hour's first line, if it has one
}

export interface WidgetSnapshot {
  v: 1
  pads: WidgetPad[]
  inbox: string // the pad a widget shows until one is picked: the Inbox, WIDGET_MAIN
  left: string  // where the left button sends a line, by name
  right: string // where the right and up buttons send it
  // The hours from this one on that have lines, by slot key ('YYYY-MM-DDTHH', device local
  // time). The widget picks the one the clock is in.
  hours: Record<string, WidgetHour>
}

// What the app knows that the rows do not say.
export interface WidgetExtras {
  now?: Date
  category?: (id: string) => WidgetCategory | undefined
}

// A button pressed on the widget, or a line added from outside the app (Siri, Shortcuts).
export type WidgetAction =
  | { dir: 'left' | 'right' | 'up'; id: string } // send the line `id`
  | { dir: 'done'; id: string } // cross the line out where it is (the watch)
  | { dir: 'state'; id: string; state: LineState } // a bullet tapped on a widget: open, doing or done
  | { dir: 'add'; id: string; pad: string; text: string } // a new line, with the id it was given

// The key that means "the Inbox", from before the Inbox was the root level: the same as
// WIDGET_MAIN now. Siri and older widgets still send it.
export const WIDGET_INBOX = 'inbox'

const padKey = (id: PadId) => id ?? WIDGET_MAIN
const fromKey = (key: string): PadId => (key === WIDGET_MAIN ? null : key)

// What the widget draws from. Per pad: its open top-level lines, top first, without
// crossed-out lines and blank spacers (the same rule as the Sort queue).
export function widgetSnapshot(
  all: Rows = usePad.getState().all,
  choice: { left: SortChoice; right: SortChoice } = useSort.getState(),
  extras: WidgetExtras = {},
): WidgetSnapshot {
  const index = buildIndex(all)
  const item = (r: NodeRow, depth = 0): WidgetItem => {
    const line = r.text.split('\n')[0]!.trim()
    const state = stateOf(r)
    return {
      id: r.id,
      text: line.length > MAX_TEXT ? line.slice(0, MAX_TEXT - 1) + '…' : line,
      subs: countLines(descendantIds(index, r.id).map((d) => all[d])),
      ...(state === 'open' ? null : { state }),
      ...(depth > 0 ? { depth } : null),
    }
  }
  const pad = (id: PadId, name: string): WidgetPad => {
    const lines = padLines(index, id)
    const items: WidgetItem[] = []
    let open = 0
    for (const r of lines) {
      if (items.length >= MAX_LINES || open >= MAX_ITEMS) break
      if (!r.done) open++
      items.push(item(r))
    }
    return { id: padKey(id), name, count: lines.filter((r) => !r.done).length, items }
  }
  // The pads in tab order: Today, Inbox (the root), Later, then the others.
  return {
    v: 1,
    pads: padList(all).map((p) => pad(p.id, p.name)),
    inbox: WIDGET_MAIN,
    left: sortTarget(all, 'left', choice.left).name,
    right: sortTarget(all, 'right', choice.right).name,
    hours: widgetHours(all, index, item, extras),
  }
}

// The hour a moment is in, as a slot key.
export function widgetHourKey(now: Date = new Date()): string {
  return slotKey(todayKey(now), now.getHours())
}

// Each hour from this one on that has lines: the lines put in it (in the hour's own order,
// slotTops), each followed by what is under it as the pad shows it (nothing under a
// collapsed line, no blank lines). Crossed-out lines stay. No summary and no flags: the
// widget is about the lines.
function widgetHours(all: Rows, index: TreeIndex, item: (r: NodeRow, depth?: number) => WidgetItem, extras: WidgetExtras): Record<string, WidgetHour> {
  const now = extras.now ?? new Date()
  const from = widgetHourKey(now)
  const to = widgetHourKey(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + HOURS_AHEAD))
  const keys = new Set<string>()
  for (const id in all) {
    const r = all[id]!
    if (r.slot === null || !isLive(r) || r.pad) continue
    for (const key of slotHours(r.slot)) if (key >= from && key <= to) keys.add(key)
  }
  const out: Record<string, WidgetHour> = {}
  for (const key of [...keys].sort()) {
    const tops = slotTops(all, key).filter((r) => isLive(r))
    if (tops.length === 0) continue
    const items: WidgetItem[] = []
    const take = (r: NodeRow, depth: number) => {
      if (items.length >= MAX_HOUR_ITEMS) return
      items.push(item(r, Math.min(depth, MAX_DEPTH)))
      if (r.collapsed) return
      for (const child of childrenOf(index, r.id)) if (!isBlank(child) || childrenOf(index, child.id).length > 0) take(child, depth + 1)
    }
    for (const top of tops) take(top, 0)
    const category = tops[0]!.category ? extras.category?.(tops[0]!.category) : undefined
    out[key] = category ? { items, category } : { items }
  }
  return out
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Apply what happened outside the app since it was last in front, oldest first: buttons
// pressed on the widget, lines added through Siri. Each is one undo step. A line that is
// gone, a press repeated, or anything malformed is skipped. Returns how many were applied.
export function cmdWidgetActions(actions: readonly WidgetAction[]): number {
  let n = 0
  for (const a of actions) {
    if (!a || typeof a.id !== 'string') continue
    const { all } = usePad.getState()
    if (a.dir === 'add') {
      // The id was made outside the app so the widget could show the line at once; use it
      // only if it is a real, unused uuid.
      const id = UUID.test(a.id) && !all[a.id] ? a.id : undefined
      if (typeof a.text !== 'string' || (UUID.test(a.id) && all[a.id])) continue
      if (cmdAddToPad(typeof a.pad === 'string' ? a.pad : WIDGET_INBOX, a.text, id)) n++
      continue
    }
    if (a.dir === 'done') {
      if (!isLive(all[a.id]) || all[a.id]!.done) continue
      const { id } = a
      applyAll((rows, ctx) => setDone(rows, ctx, [id], true), { label: 'widget:done' })
      n++
      continue
    }
    if (a.dir === 'state') {
      const { id, state } = a
      if (!isLive(all[id]) || !['open', 'doing', 'done'].includes(state) || stateOf(all[id]!) === state) continue
      applyAll((rows, ctx) => doingState(rows, ctx, [id], state), { label: `widget:${state}` })
      n++
      continue
    }
    if (!isLive(all[a.id]) || !['left', 'right', 'up'].includes(a.dir)) continue
    const here = padOf(all, a.id)
    const target = sortTarget(all, a.dir === 'left' ? 'left' : 'right')
    // Already where it was sent, and nothing else to do: a second press of the same button.
    if (target.exists && target.subId === null && target.padId === here && (a.dir !== 'up' || all[a.id]!.done)) continue
    const { id, dir } = a
    applyAll((rows, ctx) => sendToTarget(rows, ctx, id, dir, target, here).rows, { label: `widget:${dir}` })
    n++
  }
  if (n) log('widget:actions', { n, of: actions.length })
  return n
}

// A new line at the top of a pad: the widget's + (which opens the app to type it), the
// home-screen Add button, Siri. `key` is a snapshot pad id; WIDGET_MAIN, WIDGET_INBOX and a
// pad that is gone all mean the Inbox (the root). `id` fixes the new row's id. Returns the
// new line's id, or '' for blank text.
export function cmdAddToPad(key: string, text: string, id?: string): string {
  const clean = text.trim()
  if (!clean) return ''
  let newId = ''
  applyAll((all, ctx) => {
    const wanted = fromKey(key)
    const padId = wanted !== null && isPadNode(all[wanted]) ? wanted : null
    const res = insertAt(all, id ? { ...ctx, newId: () => id } : ctx, { parentId: padId, afterId: null }, clean)
    newId = res.newId
    return res.rows
  }, { label: 'widget:add' })
  return newId
}

// The name to show for a snapshot pad key, for the app's "Add to …" prompt.
export function widgetPadName(key: string, all: Rows = usePad.getState().all): string {
  const id = fromKey(key)
  return id !== null && isPadNode(all[id]) ? all[id].text.trim() || 'Untitled pad' : MAIN_PAD_NAME
}
