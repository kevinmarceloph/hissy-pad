// Sort: the lines of the pad shown, one card at a time. Left sends a line to one pad
// ("Later" unless set otherwise), right to another ("Today"), up to the right-hand pad
// crossed out. The card can be edited and given sub items before it goes. This file holds
// the queue, the two targets (remembered per device) and the commands; the swipe itself is
// the app's.
import { create } from 'zustand'
import {
  buildIndex, childrenOf, createPad, insertAt, isLive, isPadNode, isSubPad, listPads, moveNodes, remove, setDone, setText,
  type OpCtx, type PadId, type Rows,
} from '@hissypad/core'
import { apply, applyAll, getLocalStore, usePad } from './store'
import { undo } from './history'
import { stopEditing } from './selection'
import { MAIN_PAD_NAME, ensureLine, placeName } from './pads'
import { log } from './log'

export type SortSide = 'left' | 'right'
export type SortDir = SortSide | 'up' | 'skip'

// Where a side sends its lines: a pad's id, a sub-pad's row id, 'main', or null for the default (the pad
// named "Later" or "Today", made the first time a line is sent to it).
export type SortChoice = string | 'main' | null

export const SORT_DEFAULT_NAME: Record<SortSide, string> = { left: 'Later', right: 'Today' }
const KEY: Record<SortSide, string> = { left: 'sort.left', right: 'sort.right' }

export const useSort = create<Record<SortSide, SortChoice>>(() => ({ left: null, right: null }))

export async function loadSortTargets(): Promise<void> {
  const store = getLocalStore()
  const [left, right] = await Promise.all([store.getMeta(KEY.left), store.getMeta(KEY.right)])
  useSort.setState({ left: left || null, right: right || null })
}

export function setSortTarget(side: SortSide, choice: SortChoice) {
  useSort.setState({ [side]: choice } as Pick<Record<SortSide, SortChoice>, SortSide>)
  void getLocalStore().setMeta(KEY[side], choice ?? '').catch(() => {})
}

// A drag of (dx, dy) as a swipe, or null when it is too short to count. Up wins only
// when the drag is more vertical than sideways.
export const SWIPE_DISTANCE = 90
export function swipeDir(dx: number, dy: number, threshold = SWIPE_DISTANCE): SortDir | null {
  if (dy < -threshold && -dy > Math.abs(dx)) return 'up'
  if (dx > threshold) return 'right'
  if (dx < -threshold) return 'left'
  return null
}

// A new pad made from the sort screen and set as a side's target, without leaving the pad
// being sorted. Returns its id ('' for a blank name).
export function cmdSortNewTarget(side: SortSide, name: string): string {
  const clean = name.trim()
  if (!clean) return ''
  let id = ''
  applyAll((all, ctx) => {
    const made = createPad(all, ctx, clean)
    id = made.padId
    return made.rows
  }, { label: 'cmdSortNewTarget' })
  setSortTarget(side, id)
  return id
}

export interface SortTarget {
  padId: PadId      // null = the main pad
  subId: string | null // a sub-pad of that pad, or null for the pad itself
  name: string      // "Today", or "Work → Today" for a sub-pad
  exists: boolean   // false: the default pad, not made yet
  isDefault: boolean
}

// A side's target as things stand. A chosen pad that is gone (deleted here or on another
// device) falls back to the default.
export function sortTarget(all: Rows, side: SortSide, choice: SortChoice = useSort.getState()[side]): SortTarget {
  if (choice === 'main') return { padId: null, subId: null, name: MAIN_PAD_NAME, exists: true, isDefault: false }
  if (choice !== null && isPadNode(all[choice])) return { padId: choice, subId: null, name: all[choice].text || 'Untitled pad', exists: true, isDefault: false }
  if (choice !== null && isSubPad(all, all[choice])) {
    const place = { padId: all[choice]!.parentId, subId: choice }
    return { ...place, name: placeName(all, place), exists: true, isDefault: false }
  }
  const want = SORT_DEFAULT_NAME[side]
  const hit = listPads(all).find((p) => p.text.trim().toLowerCase() === want.toLowerCase())
  return hit ? { padId: hit.id, subId: null, name: hit.text.trim(), exists: true, isDefault: true } : { padId: null, subId: null, name: want, exists: false, isDefault: true }
}

// What there is to sort in the pad shown: its top-level lines, top to bottom, leaving out
// crossed-out ones and blank spacers with nothing under them.
export function sortQueue(rows: Rows = usePad.getState().rows): string[] {
  const index = buildIndex(rows)
  return childrenOf(index, null)
    .filter((r) => !r.done && (r.text.trim() !== '' || childrenOf(index, r.id).length > 0))
    .map((r) => r.id)
}

export interface SortResult {
  dir: SortDir
  pad: string       // the name of the pad the line is in afterwards
  moved: boolean    // false when it was already there (sorting the Today pad itself)
  undoDepth: number // the undo stack's length before this card; cmdSortBack returns to it
}

// The move itself, on the whole table: `id` goes to the bottom of the target (a pad, made
// on the spot when it is a default that does not exist yet, or a sub-pad) unless it is already in it,
// and is crossed out when the direction is up. `here` is the pad the line is in now.
export function sendToTarget(all: Rows, ctx: OpCtx, id: string, dir: Exclude<SortDir, 'skip'>, target: SortTarget, here: PadId): { rows: Rows; moved: boolean } {
  let out = all
  let padId = target.padId
  let moved = false
  if (!target.exists) {
    const made = createPad(out, ctx, target.name)
    out = made.rows
    padId = made.padId
  }
  // A sub-pad takes the line under its header; it is not sent into itself or sent again.
  const parent = target.subId ?? padId
  const there = target.subId !== null ? id === target.subId || out[id]?.parentId === target.subId : padId === here
  if (!there) {
    const last = childrenOf(buildIndex(out), parent).filter((r) => !r.pad).at(-1)
    out = moveNodes(out, ctx, [id], { parentId: parent, afterId: last?.id ?? null })
    moved = true
  }
  if (dir === 'up') out = setDone(out, ctx, [id], true)
  return { rows: out, moved }
}

// Send one card on its way: one undo step, the default pad made on the spot if needed.
// The line goes to the bottom of its new pad, so a run of cards arrives in the order it
// was sorted.
export function cmdSortSend(id: string, dir: SortDir): SortResult | null {
  const state = usePad.getState()
  if (!isLive(state.rows[id])) return null
  const undoDepth = state.past.length
  const here = state.padId
  if (dir === 'skip') return { dir, pad: '', moved: false, undoDepth }
  stopEditing()
  const side: SortSide = dir === 'left' ? 'left' : 'right'
  const target = sortTarget(state.all, side)
  let moved = false
  applyAll((all, ctx) => {
    const res = sendToTarget(all, ctx, id, dir, target, here)
    moved = res.moved
    return res.rows
  }, { label: `cmdSortSend:${dir}` })
  usePad.setState({ selection: [], anchorId: null, focusId: null })
  ensureLine() // the last line may have just left the pad
  log('sort:send', { id: id.slice(0, 8), dir, to: target.name, moved })
  return { dir, pad: target.name, moved, undoDepth }
}

// Take back the last card: undo everything since it came up (the send, and any edits made
// to the card after it).
export function cmdSortBack(result: SortResult) {
  let guard = 0
  while (usePad.getState().past.length > result.undoDepth && guard++ < 500) undo()
  usePad.setState({ selection: [], anchorId: null, focusId: null })
}

// ---- editing the card ---------------------------------------------------------------

export function cmdSortSetText(id: string, text: string) {
  apply((rows, ctx) => (isLive(rows[id]) ? setText(rows, ctx, id, text) : rows), { label: 'cmdSortSetText', coalesce: `text:${id}` })
}

// A new sub item at the bottom of `parentId`'s children. Returns its id ('' when the
// text is blank).
export function cmdSortAddSub(parentId: string, text: string): string {
  const clean = text.trim()
  if (!clean) return ''
  let id = ''
  apply((rows, ctx) => {
    if (!isLive(rows[parentId])) return rows
    const last = childrenOf(buildIndex(rows), parentId).at(-1)
    const res = insertAt(rows, ctx, { parentId, afterId: last?.id ?? null }, clean)
    id = res.newId
    // Sub items under a collapsed line would be hidden back in the pad: open it.
    return res.rows[parentId]!.collapsed ? { ...res.rows, [parentId]: { ...res.rows[parentId]!, collapsed: false, updatedAt: ctx.now() } } : res.rows
  }, { label: 'cmdSortAddSub' })
  return id
}

export function cmdSortRemoveSub(id: string) {
  apply((rows, ctx) => (isLive(rows[id]) ? remove(rows, ctx, [id]) : rows), { label: 'cmdSortRemoveSub' })
}

// ---- a sort session -----------------------------------------------------------------
//
// What a sort screen holds while it is open: the queue as it was when it opened, where
// the user is in it and what has been sent so far. Plain values and functions, so web
// and the phone keep one in component state and share every rule about it.

export interface SortSent extends SortResult { id: string }

export interface SortSession {
  queue: readonly string[]
  pos: number
  sent: readonly SortSent[]
}

export function sortSessionStart(rows: Rows = usePad.getState().rows): SortSession {
  return { queue: sortQueue(rows), pos: 0, sent: [] }
}

// The card to show: the next queued line that is still a top-level line of this pad (a
// sync or an undo can take one away mid-sort). `index` is its place in the queue, which
// is queue.length when nothing is left.
export function sortSessionCard(session: SortSession, rows: Rows = usePad.getState().rows): { id: string | null; index: number } {
  let i = session.pos
  while (i < session.queue.length) {
    const r = rows[session.queue[i]!]
    if (isLive(r) && r.parentId === null) return { id: r.id, index: i }
    i++
  }
  return { id: null, index: session.queue.length }
}

// Send the current card and move on. Returns the session unchanged when there is no card.
export function sortSessionSend(session: SortSession, dir: SortDir): SortSession {
  const { id, index } = sortSessionCard(session)
  if (!id) return session
  const res = cmdSortSend(id, dir)
  if (!res) return session
  return { ...session, pos: index + 1, sent: [...session.sent, { ...res, id }] }
}

// Take the last card back and show it again.
export function sortSessionBack(session: SortSession): SortSession {
  const last = session.sent.at(-1)
  if (!last) return session
  cmdSortBack(last)
  return { ...session, pos: session.queue.indexOf(last.id), sent: session.sent.slice(0, -1) }
}

// "2 to Today, 1 done, 1 to Later, 1 skipped", for the end of a sort.
export function sortSummary(session: SortSession, left: string, right: string): string {
  const n = (dir: SortDir) => session.sent.filter((s) => s.dir === dir).length
  return [
    n('right') && `${n('right')} to ${right}`,
    n('up') && `${n('up')} done`,
    n('left') && `${n('left')} to ${left}`,
    n('skip') && `${n('skip')} skipped`,
  ].filter(Boolean).join(', ')
}
