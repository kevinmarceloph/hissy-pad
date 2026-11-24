// The app's side of everything that lives outside it on Apple devices (the home-screen
// widgets, Siri, the watch), without the phone: what they are given to draw (a snapshot
// of every pad's top lines) and what happens to what is done there (a queue of actions,
// applied the next time the app is in front). The widget is a
// separate process that cannot run this code, so the two only ever exchange these two
// JSON values through shared storage (apps/mobile/src/widget.ts writes and reads them,
// targets/widget/*.swift is the other end).
import { buildIndex, countLines, padLines, createPad, descendantIds, insertAt, isLive, isPadNode, listPads, setDone, type PadId, type Rows } from '@hissypad/core'
import { applyAll, usePad } from './store'
import { MAIN_PAD_NAME } from './pads'
import { padOf } from './lists'
import { sendToTarget, sortTarget, useSort, type SortChoice } from './sort'
import { log } from './log'

// The main pad's key in the snapshot (every other pad is keyed by its row id).
export const WIDGET_MAIN = 'main'
export const WIDGET_INBOX_NAME = 'Inbox'
const MAX_ITEMS = 25 // the widget shows a handful; the watch lists them all
const MAX_TEXT = 140

export interface WidgetItem {
  id: string
  text: string // first line, cut to a length a widget can show
  subs: number // how many lines are under it, blank ones not counted
}

export interface WidgetPad {
  id: string // WIDGET_MAIN or a pad's row id
  name: string
  count: number // open top-level lines in the pad, which may be more than `items` holds
  items: WidgetItem[]
}

export interface WidgetSnapshot {
  v: 1
  pads: WidgetPad[]
  inbox: string // the pad a widget shows until one is picked: the pad named "Inbox", else Main
  left: string  // where the left button sends a line, by name
  right: string // where the right and up buttons send it
}

// A button pressed on the widget, or a line added from outside the app (Siri, Shortcuts).
export type WidgetAction =
  | { dir: 'left' | 'right' | 'up'; id: string } // send the line `id`
  | { dir: 'done'; id: string } // cross the line out where it is (the watch)
  | { dir: 'add'; id: string; pad: string; text: string } // a new line, with the id it was given

// The key that means "the pad named Inbox, made on the spot if there is none".
export const WIDGET_INBOX = 'inbox'

const padKey = (id: PadId) => id ?? WIDGET_MAIN
const fromKey = (key: string): PadId => (key === WIDGET_MAIN ? null : key)

// What the widget draws from. Per pad: its open top-level lines, top first, without
// crossed-out lines and blank spacers (the same rule as the Sort queue).
export function widgetSnapshot(all: Rows = usePad.getState().all, choice: { left: SortChoice } = useSort.getState()): WidgetSnapshot {
  const index = buildIndex(all)
  const pad = (id: PadId, name: string): WidgetPad => {
    const open = padLines(index, id, true)
    return {
      id: padKey(id),
      name,
      count: open.length,
      items: open.slice(0, MAX_ITEMS).map((r) => {
        const line = r.text.split('\n')[0]!.trim()
        return { id: r.id, text: line.length > MAX_TEXT ? line.slice(0, MAX_TEXT - 1) + '…' : line, subs: countLines(descendantIds(index, r.id).map((d) => all[d])) }
      }),
    }
  }
  const others = listPads(all)
  const inbox = inboxPad(all)
  return {
    v: 1,
    pads: [pad(null, MAIN_PAD_NAME), ...others.map((p) => pad(p.id, p.text.trim() || 'Untitled pad'))],
    inbox: padKey(inbox?.id ?? null),
    left: sortTarget(all, 'left', choice.left).name,
    right: sortTarget(all, 'right').name,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const inboxPad = (all: Rows) => listPads(all).find((p) => p.text.trim().toLowerCase() === WIDGET_INBOX_NAME.toLowerCase())

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
// home-screen Add button, Siri. `key` is a snapshot pad id, or WIDGET_INBOX for the pad
// named "Inbox", which is made if it does not exist yet; an unknown key falls back to the
// main pad. `id` fixes the new row's id. Returns the new line's id, or '' for blank text.
export function cmdAddToPad(key: string, text: string, id?: string): string {
  const clean = text.trim()
  if (!clean) return ''
  let newId = ''
  applyAll((all, ctx) => {
    let out = all
    let padId: PadId = null
    if (key === WIDGET_INBOX) {
      const inbox = inboxPad(out)
      if (inbox) padId = inbox.id
      else {
        const made = createPad(out, ctx, WIDGET_INBOX_NAME)
        out = made.rows
        padId = made.padId
      }
    } else {
      const wanted = fromKey(key)
      padId = wanted !== null && isPadNode(out[wanted]) ? wanted : null
    }
    const res = insertAt(out, id ? { ...ctx, newId: () => id } : ctx, { parentId: padId, afterId: null }, clean)
    newId = res.newId
    return res.rows
  }, { label: 'widget:add' })
  return newId
}

// The name to show for a snapshot pad key, for the app's "Add to …" prompt.
export function widgetPadName(key: string, all: Rows = usePad.getState().all): string {
  if (key === WIDGET_INBOX) return inboxPad(all)?.text.trim() || WIDGET_INBOX_NAME
  const id = fromKey(key)
  return id !== null && isPadNode(all[id]) ? all[id].text.trim() || 'Untitled pad' : MAIN_PAD_NAME
}
