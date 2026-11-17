// The home-screen widget's side of the app, without the phone: what the widget is given
// to draw (a snapshot of every pad's top lines) and what happens to the buttons pressed
// on it (a queue of actions, applied the next time the app is in front). The widget is a
// separate process that cannot run this code, so the two only ever exchange these two
// JSON values through shared storage (apps/mobile/src/widget.ts writes and reads them,
// targets/widget/*.swift is the other end).
import { buildIndex, childrenOf, descendantIds, insertAt, isLive, isPadNode, listPads, type PadId, type Rows } from '@hissypad/core'
import { applyAll, usePad } from './store'
import { MAIN_PAD_NAME } from './pads'
import { padOf } from './lists'
import { sendToTarget, sortTarget, useSort, type SortChoice, type SortSide } from './sort'
import { log } from './log'

// The main pad's key in the snapshot (every other pad is keyed by its row id).
export const WIDGET_MAIN = 'main'
export const WIDGET_INBOX_NAME = 'Inbox'
const MAX_ITEMS = 12
const MAX_TEXT = 140

export interface WidgetItem {
  id: string
  text: string // first line, cut to a length a widget can show
  subs: number // how many lines are under it
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

export interface WidgetAction {
  id: string // the line
  dir: 'left' | 'right' | 'up'
}

const padKey = (id: PadId) => id ?? WIDGET_MAIN
const fromKey = (key: string): PadId => (key === WIDGET_MAIN ? null : key)

// What the widget draws from. Per pad: its open top-level lines, top first, without
// crossed-out lines and blank spacers (the same rule as the Sort queue).
export function widgetSnapshot(all: Rows = usePad.getState().all, choice: Record<SortSide, SortChoice> = useSort.getState()): WidgetSnapshot {
  const index = buildIndex(all)
  const pad = (id: PadId, name: string): WidgetPad => {
    const open = childrenOf(index, id).filter((r) => !r.pad && !r.done && (r.text.trim() !== '' || childrenOf(index, r.id).length > 0))
    return {
      id: padKey(id),
      name,
      count: open.length,
      items: open.slice(0, MAX_ITEMS).map((r) => {
        const line = r.text.split('\n')[0]!.trim()
        return { id: r.id, text: line.length > MAX_TEXT ? line.slice(0, MAX_TEXT - 1) + '…' : line, subs: descendantIds(index, r.id).length }
      }),
    }
  }
  const others = listPads(all)
  const inbox = others.find((p) => p.text.trim().toLowerCase() === WIDGET_INBOX_NAME.toLowerCase())
  return {
    v: 1,
    pads: [pad(null, MAIN_PAD_NAME), ...others.map((p) => pad(p.id, p.text.trim() || 'Untitled pad'))],
    inbox: padKey(inbox?.id ?? null),
    left: sortTarget(all, 'left', choice.left).name,
    right: sortTarget(all, 'right', choice.right).name,
  }
}

// Apply the buttons pressed on the widget since the app was last in front, oldest first.
// Each is one undo step. A line that is gone, or was pressed twice, is skipped. Returns
// how many were applied.
export function cmdWidgetActions(actions: readonly WidgetAction[]): number {
  let n = 0
  for (const a of actions) {
    const { all } = usePad.getState()
    if (!a || typeof a.id !== 'string' || !isLive(all[a.id]) || !['left', 'right', 'up'].includes(a.dir)) continue
    const here = padOf(all, a.id)
    const target = sortTarget(all, a.dir === 'left' ? 'left' : 'right')
    // Already where it was sent, and nothing else to do: a second press of the same button.
    if (target.exists && target.padId === here && (a.dir !== 'up' || all[a.id]!.done)) continue
    applyAll((rows, ctx) => sendToTarget(rows, ctx, a.id, a.dir, target, here).rows, { label: `widget:${a.dir}` })
    n++
  }
  if (n) log('widget:actions', { n, of: actions.length })
  return n
}

// A new line at the top of a pad, from the widget's + (which opens the app to type it).
// `key` is a snapshot pad id; an unknown one falls back to the main pad. Returns the new
// line's id, or '' for blank text.
export function cmdAddToPad(key: string, text: string): string {
  const clean = text.trim()
  if (!clean) return ''
  let id = ''
  applyAll((all, ctx) => {
    const wanted = fromKey(key)
    const padId = wanted !== null && isPadNode(all[wanted]) ? wanted : null
    const res = insertAt(all, ctx, { parentId: padId, afterId: null }, clean)
    id = res.newId
    return res.rows
  }, { label: 'widget:add' })
  return id
}

// The name to show for a snapshot pad key, for the app's "Add to …" prompt.
export function widgetPadName(key: string, all: Rows = usePad.getState().all): string {
  const id = fromKey(key)
  return id !== null && isPadNode(all[id]) ? all[id].text.trim() || 'Untitled pad' : MAIN_PAD_NAME
}
