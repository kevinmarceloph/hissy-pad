// Sort: the lines of the pad shown, one card at a time. Left sends a line to a pad of the
// user's choice ("Later" unless set otherwise, remembered per device), right to "Today",
// up to "Today" crossed out, down to the Archive. Skip leaves a line where it is; Cycle moves
// it to the bottom of the pad and deals it again at the end. The card can be edited and
// given sub items before it goes. This file holds the queue, the targets and the commands;
// the swipe itself is the app's.
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
export type SortDir = SortSide | 'up' | 'down' | 'skip' | 'cycle'

// Where the left side sends its lines: a pad's id, a sub-pad's row id, 'main', or null for
// the default (the pad named "Later", made the first time a line is sent to it). The right
// side has no choice since 2026-11-24: it is always "Today". A `sort.right` meta key left
// on a device from before is not read.
export type SortChoice = string | 'main' | null

export const SORT_DEFAULT_NAME: Record<SortSide, string> = { left: 'Later', right: 'Today' }
const KEY = 'sort.left'

export const useSort = create<{ left: SortChoice }>(() => ({ left: null }))

export async function loadSortTargets(): Promise<void> {
  const left = await getLocalStore().getMeta(KEY)
  useSort.setState({ left: left || null })
}

export function setSortTarget(choice: SortChoice) {
  useSort.setState({ left: choice })
  void getLocalStore().setMeta(KEY, choice ?? '').catch(() => {})
}

// A drag of (dx, dy) as a swipe, or null when it is too short to count. Up and down win
// only when the drag is more vertical than sideways.
export const SWIPE_DISTANCE = 90
export function swipeDir(dx: number, dy: number, threshold = SWIPE_DISTANCE): SortDir | null {
  if (dy < -threshold && -dy > Math.abs(dx)) return 'up'
  if (dy > threshold && dy > Math.abs(dx)) return 'down'
  if (dx > threshold) return 'right'
  if (dx < -threshold) return 'left'
  return null
}

// A new pad made from the sort screen and set as the left target, without leaving the pad
// being sorted. Returns its id ('' for a blank name).
export function cmdSortNewTarget(name: string): string {
  const clean = name.trim()
  if (!clean) return ''
  let id = ''
  applyAll((all, ctx) => {
    const made = createPad(all, ctx, clean)
    id = made.padId
    return made.rows
  }, { label: 'cmdSortNewTarget' })
  setSortTarget(id)
  return id
}

export interface SortTarget {
  padId: PadId      // null = the main pad
  subId: string | null // a sub-pad of that pad, or null for the pad itself
  name: string      // "Today", or "Work → Today" for a sub-pad
  exists: boolean   // false: the default pad, not made yet
  isDefault: boolean
}

// A side's target as things stand. Right is always the default; on the left, a chosen pad
// that is gone (deleted here or on another device) falls back to the default.
export function sortTarget(all: Rows, side: SortSide, leftChoice: SortChoice = useSort.getState().left): SortTarget {
  const choice = side === 'left' ? leftChoice : null
  // 'main' is the root level, the Inbox.
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

// The move itself, on the whole table: `id` goes to the top of the target (a pad, made
// on the spot when it is a default that does not exist yet, or a sub-pad) unless it is already in it,
// and is crossed out when the direction is up. `here` is the pad the line is in now.
export function sendToTarget(all: Rows, ctx: OpCtx, id: string, dir: Exclude<SortDir, 'skip' | 'cycle' | 'down'>, target: SortTarget, here: PadId): { rows: Rows; moved: boolean } {
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
    out = moveNodes(out, ctx, [id], { parentId: parent, afterId: null })
    moved = true
  }
  if (dir === 'up') out = setDone(out, ctx, [id], true)
  return { rows: out, moved }
}

// Send one card on its way: one undo step, the default pad made on the spot if needed.
// The line goes to the top of its new pad, so the card sorted last is the first line there.
export function cmdSortSend(id: string, dir: SortDir): SortResult | null {
  const state = usePad.getState()
  if (!isLive(state.rows[id])) return null
  const undoDepth = state.past.length
  const here = state.padId
  if (dir === 'skip') return { dir, pad: '', moved: false, undoDepth }
  stopEditing()
  if (dir === 'cycle') {
    // Cycle: the line goes to the bottom of the pad it is in (one undo step), and the
    // session deals it again at the end of the queue.
    let moved = false
    apply((rows, ctx) => {
      const last = childrenOf(buildIndex(rows), null).filter((r) => !r.pad).at(-1)
      if (!last || last.id === id) return rows
      moved = true
      return moveNodes(rows, ctx, [id], { parentId: null, afterId: last.id })
    }, { label: 'cmdSortSend:cycle' })
    usePad.setState({ selection: [], anchorId: null, focusId: null })
    log('sort:send', { id: id.slice(0, 8), dir, moved })
    return { dir, pad: '', moved, undoDepth }
  }
  if (dir === 'down') {
    // Down deletes: the line and what is under it go to the Archive, one undo step, so Back
    // (or the Archive itself) brings them back.
    apply((rows, ctx) => remove(rows, ctx, [id]), { label: 'cmdSortSend:down' })
    usePad.setState({ selection: [], anchorId: null, focusId: null })
    ensureLine()
    log('sort:send', { id: id.slice(0, 8), dir })
    return { dir, pad: '', moved: false, undoDepth }
  }
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

// `index` is the card's place in the queue when it was sent, where Back shows it again.
export interface SortSent extends SortResult { id: string; index: number }

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
// A cycled card is queued again at the end, so it comes round once the rest are seen.
export function sortSessionSend(session: SortSession, dir: SortDir): SortSession {
  const { id, index } = sortSessionCard(session)
  if (!id) return session
  const res = cmdSortSend(id, dir)
  if (!res) return session
  const queue = dir === 'cycle' ? [...session.queue, id] : session.queue
  return { queue, pos: index + 1, sent: [...session.sent, { ...res, id, index }] }
}

// Pick a new left target and send the current card there in the same go. With no card left
// it only sets the target.
export function sortSessionSendLeftTo(session: SortSession, choice: SortChoice): SortSession {
  setSortTarget(choice)
  return sortSessionSend(session, 'left')
}

// The same with a pad made on the spot; the session is unchanged for a blank name.
export function sortSessionSendLeftToNew(session: SortSession, name: string): SortSession {
  if (!cmdSortNewTarget(name)) return session
  return sortSessionSend(session, 'left')
}

// Take the last card back and show it again. Backs come off in the order the sends went
// on, so a cycled card's copy is the last one queued.
export function sortSessionBack(session: SortSession): SortSession {
  const last = session.sent.at(-1)
  if (!last) return session
  cmdSortBack(last)
  const queue = last.dir === 'cycle' ? session.queue.slice(0, -1) : session.queue
  return { queue, pos: last.index, sent: session.sent.slice(0, -1) }
}

// Where the sort stands, counted in lines rather than queue places: a cycled line is in the
// queue twice but is one line still to go. `at` is the card's number ("2 of 5"), `total`
// the lines dealt, `left` the lines not yet sent, skipped or deleted.
export function sortSessionProgress(session: SortSession, rows: Rows = usePad.getState().rows): { at: number; total: number; left: number } {
  const { index } = sortSessionCard(session, rows)
  const total = new Set(session.queue).size
  const left = new Set(session.queue.slice(index)).size
  return { at: total - left + 1, total, left }
}

// "2 to Today, 1 done, 1 to Later, 1 to Someday, 1 archived, 1 skipped", for the end of a
// sort. Sends are counted by the pad each went to, since the left target can change
// mid-sort. Cycles are not counted: a cycled card comes round again.
export function sortSummary(session: SortSession): string {
  const n = (dir: SortDir) => session.sent.filter((s) => s.dir === dir).length
  const byPad = (dir: SortDir) => {
    const counts = new Map<string, number>()
    for (const s of session.sent) if (s.dir === dir) counts.set(s.pad, (counts.get(s.pad) ?? 0) + 1)
    return [...counts].map(([pad, c]) => `${c} to ${pad}`)
  }
  return [
    ...byPad('right'),
    n('up') && `${n('up')} done`,
    ...byPad('left'),
    n('down') && `${n('down')} archived`,
    n('skip') && `${n('skip')} skipped`,
  ].filter(Boolean).join(', ')
}
