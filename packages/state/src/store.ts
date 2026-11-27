// The app's state: every row of the table (`all`), the pad being shown as a pad of its own
// (`rows`, see scopePad in core), what is selected or being edited, and the undo stack.
// Every edit goes through `apply`, which runs a core op on the shown pad, pushes undo
// history, and writes the changed rows to the LocalStore as dirty. Undo and redo are in
// history.ts; selection and the editing caret are in selection.ts.
import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import {
  buildIndex, changedRows, childrenOf, createClock, createMemoryStore, fixedPadOf, inheritPadCategory, isPadNode, isTodayPad, scheduledKey, settleBoomerangs, settleRepeats, settleFixedPads, settlePins, settleSchedule,
  insertAt, insertOutline, isLive, newUuid, normalizeRow, parseOutline, parseSlot, sameRow, scopeCategory, scopeNode, scopePad, scopeSlot, unscopeCategory, unscopeRow, unscopeSlot,
  type LocalStore, type NodeRow, type OpCtx, type PadId, type Rows, type SyncStatus, findFixedPad, scopeTodayPart, fitOwnPart, type TodayPart,
} from '@hissypad/core'
import { log, rowBrief } from './log'
import { seedSample } from './sample'
import { takeLegacyHiddenCounts } from './prefs'

export type Caret = number | 'end'

export interface Editing {
  id: string
  caret: Caret
  rev: number // bumped whenever focus should be (re)applied
}

export type LoadState = 'loading' | 'ready' | 'error'

// One undoable step: only the rows the op touched, as they were and as they became. Undo
// puts the `before` values back (a row that did not exist becomes a tombstone) with a
// fresh updatedAt, so the undo itself syncs and never reverts another device's rows.
export interface HistoryEntry {
  label: string
  at: number
  before: Record<string, NodeRow | undefined>
  after: Record<string, NodeRow>
}

export interface PadState {
  all: Rows                 // the whole table, every pad, tombstones included
  rows: Rows                // the current pad, live rows only, scoped (scopePad)
  padId: PadId              // null = the main pad
  zoomId: string | null     // a line shown as a pad of its own: `rows` is what is under it (the new item's card)
  slotId: string | null     // an hour shown as a pad of its own: `rows` is the lines put in it and what is under them (scopeSlot)
  partId: TodayPart | null  // one of Today's two sections shown in place of the pad, from Hours: its own lines, or its lines with an hour (scopeTodayPart)
  catId: string | null      // a category shown in place of the pad: `rows` is its lines from every pad, with what is over and under them (scopeCategory)
  load: LoadState
  storageError: string | null
  editing: Editing | null
  selection: string[] // in visible order
  anchorId: string | null
  focusId: string | null // the end of a shift-extended range
  reveal: { id: string; n: number } | null // a row to scroll to (a jump to a sub-pad); n makes each ask new
  past: HistoryEntry[]
  future: HistoryEntry[]
  session: Session | null   // Supabase auth; null = local only
  sync: SyncStatus | null   // null until the engine runs
}

export const SEED_KEY = 'seed.rows'
export const PAD_KEY = 'pad.current' // which pad this device had open
export const SORT_PAD_KEY = 'sort.pad' // which pad Sort had open: its own, apart from the Pads tab's
export const CAT_KEY = 'category.current' // which category the Categories mode had open

// Sort keeps a pad of its own (Kevin, 2026-11-27): picking a pad to sort does not change the
// pad the Pads tab shows, and back. The store shows one pad at a time, so switching in or out
// of Sort swaps `padId` with the one the other side last had. `sortMode` says which side the
// pad shown belongs to, and so which meta key openPad remembers it under.
let sortMode = false
let otherPad: PadId | undefined // the pad of the side not shown; undefined: none chosen yet
let sortPadMeta: PadId | undefined // Sort's pad as loaded from meta, until Sort is first opened
export const inSortMode = () => sortMode
export function setSortMode(on: boolean) {
  if (on === sortMode || get().load !== 'ready') return
  const was = get().padId
  const want = on ? (otherPad !== undefined ? otherPad : sortPadMeta) : otherPad
  sortMode = on
  otherPad = was
  if (want !== undefined && want !== was && !openPad(want)) openPad(was)
}

export const clock = createClock()
export const ctx: OpCtx = { now: () => clock.tick(), newId: newUuid }

let local: LocalStore = createMemoryStore()
export function configureLocalStore(store: LocalStore) {
  local = store
}
export function getLocalStore(): LocalStore {
  return local
}

// The sync layer registers itself here so the store never imports it.
let onLocalChange: (() => void) | null = null
export function setOnLocalChange(fn: (() => void) | null) {
  onLocalChange = fn
}

const UNDO_LIMIT = 200

export const usePad = create<PadState>(() => ({
  all: {},
  rows: {},
  padId: null,
  zoomId: null,
  slotId: null,
  partId: null,
  catId: null,
  load: 'loading',
  storageError: null,
  editing: null,
  selection: [],
  anchorId: null,
  focusId: null,
  reveal: null,
  past: [],
  future: [],
  session: null,
  sync: null,
}))

const get = usePad.getState
const set = usePad.setState

// What `rows` holds: the pad shown, or, while zoomed, the lines under the zoomed one, or,
// while an hour is open, that hour's lines. One of the three at a time: a zoom and an open
// hour each end the other. A category view stands where the pad does: a zoom or an open
// hour is shown over it, and it is there again when they end.
// A part of Today (Hours' Unscheduled and Schedule) stands where the pad does too.
function view(all: Rows, padId: PadId, zoomId: string | null = get().zoomId, slotId: string | null = get().slotId, catId: string | null = get().catId, partId: TodayPart | null = get().partId): Rows {
  if (slotId !== null) return scopeSlot(all, slotId).rows
  if (zoomId !== null && isLive(all[zoomId])) return scopeNode(all, zoomId)
  if (partId !== null) return scopeTodayPart(all, partId)
  return catId !== null ? scopeCategory(all, catId).rows : padView(all, padId)
}

// The category whose view is on screen as itself (not a line zoomed into, not an open hour).
export function categoryShown(s: Pick<PadState, 'catId' | 'zoomId' | 'slotId'> = get()): string | null {
  return s.zoomId === null && s.slotId === null ? s.catId : null
}

// A pad as the store shows it. Later's holds the lines that are out on a boomerang too,
// under its own, as rows (core/boomerang.ts); Sort and the counts read scopePad itself.
function padView(all: Rows, padId: PadId): Rows {
  return scopePad(all, padId, fixedPadOf(all, padId) === 'Later')
}

// Write whatever differs between two versions of the table to local storage as dirty.
export function persist(prev: Rows, next: Rows) {
  const changed = changedRows(prev, next)
  // Undoing an insert leaves the row out of `next` entirely; storage still has it, so
  // write a tombstone (a redo brings it back with a newer updatedAt).
  for (const id in prev) {
    if (!(id in next)) {
      const now = clock.tick()
      changed.push({ ...prev[id]!, deletedAt: now, updatedAt: now })
    }
  }
  if (changed.length === 0) return
  for (const r of changed) clock.observe(r.updatedAt)
  local.upsertMany(changed, { dirty: true }).then(
    () => onLocalChange?.(),
    (e: unknown) => set({ storageError: `Could not save: ${(e as Error).message}` }),
  )
}

// Run an op on the pad being shown. `label` names it in the log and the undo history;
// `coalesce` lets a run of keystrokes on one node share a single undo entry. The op sees
// the scoped pad; its changed rows are put back in table terms before they are saved.
let lastCoalesce: { key: string; at: number } | null = null
// The next edit starts a new undo entry even if it would have merged (after an undo or redo).
export function breakCoalesce() {
  lastCoalesce = null
}
export function apply(fn: (rows: Rows, ctx: OpCtx) => Rows, opts: { label?: string; coalesce?: string } = {}): Rows {
  const { rows, all, padId, zoomId, slotId, catId, partId } = get()
  const zoomed = zoomId !== null && isLive(all[zoomId])
  // A part of Today is Today's own rows: they go back under Today.
  const root = zoomed ? zoomId : partId !== null ? (findFixedPad(all, 'Today')?.id ?? padId) : padId
  const next = fn(rows, ctx)
  const label = opts.label ?? 'op'
  if (next === rows) {
    log(`op:${label}`, { changed: 0 })
    return rows
  }
  // An hour's lines go back to the pads they came from; a pad's or a zoom's to their one root.
  // A category's go back to their pads too, and a new one takes the category.
  const changed = slotId !== null
    ? unscopeSlot(all, slotId, scopeSlot(all, slotId), changedRows(rows, next), padId)
    : catId !== null && !zoomed && partId === null
      ? unscopeCategory(all, catId, scopeCategory(all, catId), changedRows(rows, next), padId)
      : partId === 'own' && !zoomed && root !== null
        ? fitOwnPart(all, root, changedRows(rows, next).map((r) => unscopeRow(r, root)))
        : changedRows(rows, next).map((r) => unscopeRow(r, root))
  for (const id in rows) if (!(id in next)) changed.push(tombstone(all[id]!))
  // An hour's view can leave nothing to write (a move among its lines: it keeps no order).
  if (changed.length === 0) return rows
  const nextAll: Record<string, NodeRow> = { ...all }
  for (const r of changed) nextAll[r.id] = r
  commit(all, nextAll, label, opts.coalesce)
  return get().rows
}

// The same for an op that spans pads (move to another pad, a new pad, a fresh start): it
// sees and returns the whole table.
export function applyAll(fn: (all: Rows, ctx: OpCtx) => Rows, opts: { label?: string; coalesce?: string } = {}): Rows {
  const { all } = get()
  const next = fn(all, ctx)
  const label = opts.label ?? 'op'
  if (next === all) {
    log(`op:${label}`, { changed: 0 })
    return all
  }
  const nextAll: Record<string, NodeRow> = { ...next }
  for (const id in all) if (!(id in next)) nextAll[id] = tombstone(all[id]!)
  commit(all, nextAll, label, opts.coalesce)
  return get().all
}

// An op never drops a row, but if one did, storage still has it: write a tombstone.
function tombstone(r: NodeRow): NodeRow {
  const now = clock.tick()
  return { ...r, deletedAt: now, updatedAt: now }
}

// The rows an edit placed somewhere (new, moved, pinned or unpinned, made or unmade a pad,
// archived): the ones whose sibling groups settlePins has to look at. A text edit has none.
function placed(all: Rows, nextAll: Rows): string[] {
  const out: string[] = []
  for (const r of changedRows(all, nextAll)) {
    const b = all[r.id]
    if (!b || b.parentId !== r.parentId || b.rank !== r.rank || b.pinned !== r.pinned || b.pad !== r.pad || b.deletedAt !== r.deletedAt) out.push(r.id)
  }
  return out
}

// What reads the front of a typed line: a leading emoji into a category, a leading hour into
// a slot. Set by the hours side, which has the categories and the day start; one per `key`.
type Classifier = (all: Rows, ctx: OpCtx, ids: string[]) => Rows
const classifiers = new Map<string, Classifier>()
export function setClassifier(fn: Classifier | null, key = 'emoji') {
  if (fn) classifiers.set(key, fn)
  else classifiers.delete(key)
}

function commit(all: Rows, edited: Rows, label: string, coalesce?: string) {
  const { past, padId } = get()
  // Pins stay first in their pad, and only a pad's top-level line stays pinned (pins.ts):
  // a drag or a paste that breaks that is put right in the same step, so one undo takes it back.
  const moved = placed(all, edited)
  let nextAll = moved.length ? settlePins(edited, ctx, moved) : edited
  // A line moved into a pad that has a category takes it, in the same step.
  if (moved.length) nextAll = inheritPadCategory(all, nextAll, ctx, moved)
  // A line typed (or made) with a category's emoji in front goes in that category, and one
  // with an hour in front in that hour, in the same step (classifyByEmoji in core; the category list is Hours', handed in from there).
  if (classifiers.size) {
    const typed = changedRows(all, nextAll).filter((r) => r.text !== all[r.id]?.text).map((r) => r.id)
    // Twice, so either one can come first: "3pm 💻 call" and "💻 3pm call" both read.
    if (typed.length) for (let pass = 0; pass < 2; pass++) for (const fn of classifiers.values()) nextAll = fn(nextAll, ctx, typed)
  }
  // Lines out on a boomerang stay in their day's group under Later, the same way.
  const dued = changedRows(all, nextAll).filter((r) => r.due || all[r.id]?.due).map((r) => r.id)
  // A recurring item's template first: it is out for good under Later, or it is no template (repeat.ts).
  if (moved.length || dued.length) nextAll = settleBoomerangs(settleRepeats(nextAll, ctx, [...moved, ...dued]), ctx, all, [...moved, ...dued])
  // Today's lines with an hour stay in its Scheduled section, in the order of their hours.
  if (moved.length || changedRows(all, nextAll).some((r) => r.slot !== (all[r.id]?.slot ?? null))) nextAll = settleSchedule(nextAll, ctx, all)
  // A line that came back from a boomerang keeps its dot until it is touched: any edit to
  // the row takes the dot off, in the same step.
  for (const r of changedRows(all, nextAll)) {
    if (r.fresh && all[r.id]?.fresh) nextAll = { ...nextAll, [r.id]: { ...r, fresh: false } }
  }
  const now = Date.now()
  const changed = changedRows(all, nextAll)
  const merge = coalesce !== undefined && lastCoalesce?.key === coalesce && now - lastCoalesce.at < 1500 && past.length > 0
  lastCoalesce = coalesce !== undefined ? { key: coalesce, at: now } : null
  let entry: HistoryEntry
  if (merge) {
    const last = past.at(-1)!
    entry = { ...last, at: now, after: { ...last.after } }
    for (const r of changed) {
      if (!(r.id in entry.before)) entry.before[r.id] = all[r.id]
      entry.after[r.id] = r
    }
  } else {
    entry = { label, at: now, before: {}, after: {} }
    for (const r of changed) {
      entry.before[r.id] = all[r.id]
      entry.after[r.id] = r
    }
  }
  const newPast = merge ? [...past.slice(0, -1), entry] : [...past.slice(-UNDO_LIMIT + 1), entry]
  set({ all: nextAll, rows: view(nextAll, padId), past: newPast, future: [] })
  log(`op:${label}`, {
    changed: changed.map((r) => ({ before: rowBrief(all[r.id]), after: rowBrief(nextAll[r.id]) })),
    merged: merge,
    undoDepth: newPast.length,
  })
  persist(all, nextAll)
}

// Idempotent: StrictMode runs effects twice in dev, and two early callers must never both
// decide the pad is empty and each create "the first line".
let loading: Promise<void> | null = null
export function loadPad(): Promise<void> {
  return (loading ??= loadPadOnce().finally(() => {
    loading = null
  }))
}

async function loadPadOnce() {
  try {
    const list = await local.getAll()
    const rows: Record<string, NodeRow> = {}
    const upgraded: NodeRow[] = []
    for (const raw of list) {
      const r = normalizeRow(raw)
      if (!sameRow(r, raw)) upgraded.push(r)
      rows[r.id] = r
      clock.observe(r.updatedAt)
    }
    // Rows from an older build get their missing columns written back (and pushed).
    if (upgraded.length) await local.upsertMany(upgraded, { dirty: true })
    let state: Rows = rows
    const live = Object.values(rows).some((r) => r.deletedAt === null)
    if (!live) {
      // First visit on this device: a welcome pad. Its rows are remembered with their
      // stamps so sync can drop the untouched ones if a real pad arrives from the account.
      const res = seedSample(rows, ctx)
      state = res.rows
      await local.upsertMany(changedRows(rows, state), { dirty: true })
      await local.setMeta(SEED_KEY, JSON.stringify(Object.fromEntries(res.ids.map((id) => [id, state[id]!.updatedAt]))))
      log('seed', { n: res.ids.length })
    }
    // Reopen the pad this device had open, if it still exists; else the Inbox (the root).
    const remembered = await local.getMeta(PAD_KEY)
    const padId = remembered && isPadNode(state[remembered]) ? remembered : null
    const sortPad = await local.getMeta(SORT_PAD_KEY)
    sortPadMeta = sortPad === null || sortPad === undefined ? undefined : sortPad === '' ? null : sortPad
    sortMode = false
    otherPad = undefined
    lastCat = (await local.getMeta(CAT_KEY)) || null
    set({ all: state, rows: padView(state, padId), padId, load: 'ready' })
    settleFixed()
    adoptLegacyCounts()
  } catch (e) {
    // Keep working in memory so the pad is still usable; the banner says edits won't stick.
    local = createMemoryStore()
    const res = insertAt({}, ctx, { parentId: null, afterId: null }, '')
    set({ all: res.rows, rows: scopePad(res.rows, null), padId: null, load: 'ready', storageError: `Local storage is unavailable (${(e as Error).message}). Edits will be lost when you close this tab.` })
    settleFixed()
  }
}

// Keep Today and Later there once each and no pad named Inbox beside the root (see
// settleFixedPads in core), and pins first in their pads (settlePins: a line another device
// added at the top lands under them). Run after load and after every sync merge, never inside an op,
// and left out of the undo history: undoing it would only bring back a duplicate. If the pad
// shown was folded away, the Inbox (the root) opens.
export function settleFixed() {
  const { all, padId, load } = get()
  if (load !== 'ready') return
  const next = settleSchedule(settleBoomerangs(settleRepeats(settlePins(settleFixedPads(all, ctx), ctx), ctx), ctx), ctx)
  if (next === all) return afterSettle?.()
  log('pad:settle', { changed: changedRows(all, next).length })
  const shown = padId === null || isPadNode(next[padId]) ? padId : null
  set({ all: next, padId: shown, rows: view(next, shown) })
  if (shown !== padId) void local.setMeta(sortMode ? SORT_PAD_KEY : PAD_KEY, '').catch(() => {})
  persist(all, next)
  afterSettle?.()
}

// A change to the table that is the app's own doing, not an edit (a boomerang coming back
// when its day starts): written and synced like settleFixed's, and left out of undo.
export function applyQuiet(fn: (all: Rows, ctx: OpCtx) => Rows, label: string): boolean {
  const { all, padId, load } = get()
  if (load !== 'ready') return false
  const next = fn(all, ctx)
  if (next === all) return false
  log(label, { changed: changedRows(all, next).map((r) => rowBrief(r)) })
  set({ all: next, rows: view(next, padId) })
  persist(all, next)
  return true
}

// Called after every settleFixed (after load and after each sync merge), whether or not it
// changed anything: boomerang.ts hangs its delivery here so the store never imports it.
let afterSettle: (() => void) | null = null
export function setAfterSettle(fn: (() => void) | null) {
  afterSettle = fn
}

// The pads this device hid the count of before the choice synced (kept in its prefs until
// 2026-11-25) become `countHidden` on their rows, once. Like settleFixed, left out of undo.
function adoptLegacyCounts() {
  const ids = takeLegacyHiddenCounts()
  const { all, padId } = get()
  let next = all
  for (const id of ids) {
    const r = next[id]
    if (isPadNode(r) && !r.countHidden && fixedPadOf(next, id) === null) next = { ...next, [id]: { ...r, countHidden: true, updatedAt: clock.tick() } }
  }
  if (next === all) return
  log('pad:adopt-counts', { changed: changedRows(all, next).length })
  set({ all: next, rows: view(next, padId) })
  persist(all, next)
}

// Show another pad. Selection and editing belong to the pad they were in, so they clear.
// The choice is remembered per device. Returns false when the pad does not exist.
export function openPad(padId: PadId): boolean {
  const { all } = get()
  if (padId !== null && !isPadNode(all[padId])) return false
  log('pad:open', { padId: padId?.slice(0, 8) ?? 'main' })
  set({ padId, zoomId: null, slotId: null, partId: null, catId: null, rows: padView(all, padId), editing: null, selection: [], anchorId: null, focusId: null })
  void local.setMeta(sortMode ? SORT_PAD_KEY : PAD_KEY, padId ?? '').catch(() => {})
  return true
}

// Show a category in place of the pad: its lines from every pad, in groups by pad, with the
// lines over and under them (scopeCategory in core). The pad's own commands then edit them.
// It is what the Categories mode shows: each app opens one on the way into the mode and
// closes it on the way out, and opening any pad ends it (the apps then go to the Pad mode).
// Editing and selection belong to what was shown, so they clear. The choice is remembered
// per device.
let lastCat: string | null = null
export const lastCategory = () => lastCat
export function openCategory(catId: string) {
  const { all, padId } = get()
  log('category:open', { catId: catId.slice(0, 8) })
  lastCat = catId
  set({ catId, zoomId: null, slotId: null, partId: null, rows: view(all, padId, null, null, catId, null), editing: null, selection: [], anchorId: null, focusId: null })
  void local.setMeta(CAT_KEY, catId).catch(() => {})
}
export function closeCategory() {
  const { all, padId, catId } = get()
  if (catId === null) return
  set({ catId: null, zoomId: null, slotId: null, rows: view(all, padId, null, null, null), editing: null, selection: [], anchorId: null, focusId: null })
}

// Show the lines under one line as if it were a pad (null: back to the pad). Editing and
// selection belong to what was shown, so they clear. The pad that is open stays the same.
export function zoomTo(id: string | null) {
  const { all, padId } = get()
  const zoomId = id !== null && isLive(all[id]) ? id : null
  set({ zoomId, slotId: null, rows: view(all, padId, zoomId, null), editing: null, selection: [], anchorId: null, focusId: null })
}

// Show one hour's lines as if the hour were a pad (null: back to the pad): the lines put in
// it, from whichever pads, each with what is under it. The pad's own commands then edit
// them. `slot` is one hour, 'YYYY-MM-DDTHH'; a run of hours is not a view. Editing and
// selection belong to what was shown, so they clear, and a zoom ends. The pad that is open
// stays the same. Returns false for a slot that is not one hour.
export function openSlot(slot: string | null): boolean {
  const { all, padId } = get()
  if (slot !== null && parseSlot(slot)?.hours !== 1) return false
  if (slot === get().slotId) return true
  log('slot:open', { slot: slot ?? 'none' })
  set({ slotId: slot, zoomId: null, rows: view(all, padId, null, slot), editing: null, selection: [], anchorId: null, focusId: null })
  return true
}
export const closeSlot = () => void openSlot(null)

// Show one of Today's two sections as a pad of its own (null: back to what was shown):
// 'own' is its own lines, pins included; 'scheduled' its lines with an hour. Hours' focus
// screen opens them ("Unscheduled", "Schedule"). The pad's own commands edit them. An open
// hour and a zoom end; the pad that is open in the Pads tab stays the same.
export function openPart(part: TodayPart | null) {
  const { all, padId, catId } = get()
  if (part === get().partId && get().slotId === null && get().zoomId === null) return
  log('part:open', { part: part ?? 'none' })
  set({ partId: part, zoomId: null, slotId: null, rows: view(all, padId, null, null, catId, part), editing: null, selection: [], anchorId: null, focusId: null })
}
export const closePart = () => void openPart(null)

// Ask the pad on screen to scroll to a row. The apps watch `reveal` and do the scrolling.
export function revealRow(id: string) {
  set({ reveal: { id, n: (get().reveal?.n ?? 0) + 1 } })
}

// Rows shown as `rows` again after `all` changed from outside an op (a sync merge).
export function setAll(all: Rows, extra: Partial<PadState> = {}) {
  const { padId } = get()
  // The open pad may have been deleted on another device: fall back to the Inbox.
  const stillThere = padId === null || isPadNode(all[padId])
  const nextPad = stillThere ? padId : null
  // The same for a zoomed line (an undo can take a new item away while its card is open).
  const zoomId = get().zoomId !== null && isLive(all[get().zoomId!]) ? get().zoomId : null
  set({ all, padId: nextPad, zoomId, rows: view(all, nextPad, zoomId), ...extra })
  if (!stillThere) void local.setMeta(sortMode ? SORT_PAD_KEY : PAD_KEY, '').catch(() => {})
}

// Whether the pad on screen is Today as itself (not a line zoomed into, not an open hour):
// the view that has the Scheduled section.
export function todayShown(s: Pick<PadState, 'all' | 'padId' | 'zoomId' | 'slotId' | 'catId' | 'partId'> = get()): boolean {
  return s.zoomId === null && s.slotId === null && s.catId === null && s.partId === null && isTodayPad(s.all, s.padId)
}

// The last of the shown pad's own top-level lines: in Later, above the lines that are out
// on a boomerang; in Today, above the Scheduled section. "At the end of the pad" means
// after this one, or a new line there would join a day or an hour.
export function lastOwn(rows: Rows): NodeRow | undefined {
  const today = todayShown()
  return childrenOf(buildIndex(rows), null).filter((r) => !r.due && !(today && scheduledKey(r))).at(-1)
}

// Multi-line paste or the Import dialog: lines land after `afterId` at its depth, or at the
// top/bottom of the pad. Returns the ids created.
export function importOutline(text: string, where: { afterId: string } | { parentId: string | null; afterId: string | null } | 'top' | 'bottom'): string[] {
  const lines = parseOutline(text)
  if (lines.length === 0) return []
  let ids: string[] = []
  apply((rows, ctx) => {
    const index = buildIndex(rows)
    let placement
    if (where === 'top') placement = { parentId: null, afterId: null }
    else if (where === 'bottom') placement = { parentId: null, afterId: lastOwn(rows)?.id ?? null }
    else if ('parentId' in where) placement = where
    else placement = { parentId: index.parentOf.get(where.afterId) ?? null, afterId: where.afterId }
    const res = insertOutline(rows, ctx, lines, placement)
    ids = res.ids
    return res.rows
  }, { label: 'importOutline' })
  return ids
}

export function dismissStorageError() {
  set({ storageError: null })
}
