// The web app's state: the rows (from core), what is selected or being edited, and the
// undo stack. Every edit goes through `apply`, which runs a core op, pushes undo history,
// and writes the changed rows to the LocalStore as dirty.
import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import {
  buildIndex, changedRows, childrenOf, createClock, createMemoryStore, flatten,
  insertAt, insertOutline, newUuid, normalizeRow, parseOutline, type LocalStore, type NodeRow, type OpCtx, type Rows, type SyncStatus,
} from '@hissypad/core'
import { log, rowBrief } from './log'
import { seedSample } from './sample'

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
  rows: Rows
  load: LoadState
  storageError: string | null
  editing: Editing | null
  selection: string[] // in visible order
  anchorId: string | null
  focusId: string | null // the end of a shift-extended range
  past: HistoryEntry[]
  future: HistoryEntry[]
  session: Session | null   // Supabase auth; null = local only
  sync: SyncStatus | null   // null until the engine runs
}

export const SEED_KEY = 'seed.rows'

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
  rows: {},
  load: 'loading',
  storageError: null,
  editing: null,
  selection: [],
  anchorId: null,
  focusId: null,
  past: [],
  future: [],
  session: null,
  sync: null,
}))

const get = usePad.getState
const set = usePad.setState

function persist(prev: Rows, next: Rows) {
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

// Run an op. `label` names it in the log and the undo history; `coalesce` lets a run of
// keystrokes on one node share a single undo entry.
let lastCoalesce: { key: string; at: number } | null = null
export function apply(fn: (rows: Rows, ctx: OpCtx) => Rows, opts: { label?: string; coalesce?: string } = {}): Rows {
  const { rows, past } = get()
  const next = fn(rows, ctx)
  const label = opts.label ?? 'op'
  if (next === rows) {
    log(`op:${label}`, { changed: 0 })
    return rows
  }
  const now = Date.now()
  const changed = changedRows(rows, next)
  for (const id in rows) if (!(id in next)) changed.push({ ...rows[id]!, deletedAt: rows[id]!.deletedAt ?? 'removed' })
  const merge = opts.coalesce !== undefined && lastCoalesce?.key === opts.coalesce && now - lastCoalesce.at < 1500 && past.length > 0
  lastCoalesce = opts.coalesce !== undefined ? { key: opts.coalesce, at: now } : null
  let entry: HistoryEntry
  if (merge) {
    const last = past.at(-1)!
    entry = { ...last, at: now, after: { ...last.after } }
    for (const r of changed) {
      if (!(r.id in entry.before)) entry.before[r.id] = rows[r.id]
      entry.after[r.id] = next[r.id] ?? { ...r }
    }
  } else {
    entry = { label, at: now, before: {}, after: {} }
    for (const r of changed) {
      entry.before[r.id] = rows[r.id]
      entry.after[r.id] = next[r.id] ?? { ...r }
    }
  }
  const newPast = merge ? [...past.slice(0, -1), entry] : [...past.slice(-UNDO_LIMIT + 1), entry]
  set({ rows: next, past: newPast, future: [] })
  log(`op:${label}`, {
    changed: changed.map((r) => ({ before: rowBrief(rows[r.id]), after: rowBrief(next[r.id]) })),
    merged: merge,
    undoDepth: newPast.length,
  })
  persist(rows, next)
  return next
}

// Restore one side of an entry onto the current rows. Rows that did not exist on that
// side become tombstones (an undone insert). Everything restored gets a fresh updatedAt.
function restore(side: Record<string, NodeRow | undefined>, ids: string[]): { rows: Rows; touched: string[] } {
  const cur = get().rows
  const out: Record<string, NodeRow> = { ...cur }
  const touched: string[] = []
  for (const id of ids) {
    const want = side[id]
    const now = ctx.now()
    if (want) out[id] = { ...want, updatedAt: now }
    else if (cur[id]) out[id] = { ...cur[id]!, deletedAt: now, updatedAt: now }
    else continue
    touched.push(id)
  }
  return { rows: out, touched }
}

function afterHistoryMove(rows: Rows, touched: string[]) {
  // Land on what changed: select the restored rows that are live and visible.
  const vis = new Set(flatten(buildIndex(rows), true).map((r) => r.id))
  const sel = touched.filter((id) => vis.has(id))
  set({ rows, editing: null, selection: sel, anchorId: sel[0] ?? null, focusId: sel.at(-1) ?? null })
}

export function undo() {
  const { rows, past, future } = get()
  const entry = past.at(-1)
  if (!entry) {
    log('undo', { nothing: true })
    return
  }
  lastCoalesce = null
  const ids = Object.keys(entry.before)
  const r = restore(entry.before, ids)
  afterHistoryMove(r.rows, r.touched)
  set({ past: past.slice(0, -1), future: [entry, ...future] })
  log('undo', { label: entry.label, rows: r.touched.map((id) => rowBrief(r.rows[id])), undoDepth: past.length - 1 })
  persist(rows, r.rows)
}

export function redo() {
  const { rows, past, future } = get()
  const entry = future[0]
  if (!entry) {
    log('redo', { nothing: true })
    return
  }
  lastCoalesce = null
  const ids = Object.keys(entry.after)
  const r = restore(entry.after, ids)
  afterHistoryMove(r.rows, r.touched)
  set({ past: [...past, entry], future: future.slice(1) })
  log('redo', { label: entry.label, rows: r.touched.map((id) => rowBrief(r.rows[id])) })
  persist(rows, r.rows)
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
      if (r.numbered !== raw.numbered || r.collapsed !== raw.collapsed || r.done !== raw.done) upgraded.push(r)
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
    set({ rows: state, load: 'ready' })
  } catch (e) {
    // Keep working in memory so the pad is still usable; the banner says edits won't stick.
    local = createMemoryStore()
    const res = insertAt({}, ctx, { parentId: null, afterId: null }, '')
    set({ rows: res.rows, load: 'ready', storageError: `Local storage is unavailable (${(e as Error).message}). Edits will be lost when you close this tab.` })
  }
}

// ---- selection / editing ----------------------------------------------------------

export function edit(id: string, caret: Caret = 'end') {
  const cur = get().editing
  log('edit', { id: id.slice(0, 8), caret })
  set({ editing: { id, caret, rev: (cur?.rev ?? 0) + 1 }, selection: [], anchorId: null, focusId: null })
}

export function stopEditing() {
  if (get().editing) log('edit:stop')
  set({ editing: null })
}

export function visibleIds(state: PadState = get()): string[] {
  return flatten(buildIndex(state.rows), true).map((r) => r.id)
}

export function select(ids: string[], anchorId: string | null, focusId: string | null = anchorId) {
  const order = new Map(visibleIds().map((id, i) => [id, i]))
  const sorted = [...new Set(ids)].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!)
  log('select', { n: sorted.length, ids: sorted.slice(0, 6).map((i) => i.slice(0, 8)) })
  set({ selection: sorted, anchorId, focusId, editing: null })
}

export function clearSelection() {
  set({ selection: [], anchorId: null, focusId: null })
}

// Tap on a bullet. Shift ranges from the anchor. Once anything is selected, a plain tap
// toggles the line in or out (no modifier needed, so it works on a phone); the toolbar's
// × or Esc clears. With nothing selected a tap selects just that line.
export function clickSelect(id: string, mods: { shift: boolean; meta: boolean }) {
  const { selection, anchorId } = get()
  if (mods.shift && anchorId) return selectRange(anchorId, id)
  if (mods.meta || selection.length > 0) {
    const has = selection.includes(id)
    const next = has ? selection.filter((x) => x !== id) : [...selection, id]
    return select(next, has ? (next.at(-1) ?? null) : id)
  }
  select([id], id)
}

export function selectRange(anchorId: string, focusId: string) {
  const vis = visibleIds()
  const a = vis.indexOf(anchorId)
  const b = vis.indexOf(focusId)
  if (a < 0 || b < 0) return select([focusId], focusId)
  const [lo, hi] = a < b ? [a, b] : [b, a]
  select(vis.slice(lo, hi + 1), anchorId, focusId)
}

export function selectAll() {
  const vis = visibleIds()
  select(vis, vis[0] ?? null, vis.at(-1) ?? null)
}

// Arrow keys in selection mode.
export function stepSelection(dir: -1 | 1, extend: boolean) {
  const { focusId, anchorId, selection } = get()
  const vis = visibleIds()
  const cur = focusId ?? selection.at(dir > 0 ? -1 : 0) ?? null
  const i = cur ? vis.indexOf(cur) : -1
  const next = vis[Math.min(vis.length - 1, Math.max(0, i + dir))]
  if (!next) return
  if (extend && anchorId) selectRange(anchorId, next)
  else select([next], next)
}

// The ids an action applies to: the selection, else the node being edited.
export function targets(): string[] {
  const { selection, editing } = get()
  if (selection.length > 0) return selection
  return editing ? [editing.id] : []
}

export function neighbor(id: string, dir: -1 | 1): string | null {
  const vis = visibleIds()
  const i = vis.indexOf(id)
  return i < 0 ? null : (vis[i + dir] ?? null)
}

// Multi-line paste or the Import dialog: lines land after `afterId` at its depth, or at the
// top/bottom of the pad. Returns the ids created.
export function importOutline(text: string, where: { afterId: string } | 'top' | 'bottom'): string[] {
  const lines = parseOutline(text)
  if (lines.length === 0) return []
  let ids: string[] = []
  apply((rows, ctx) => {
    const index = buildIndex(rows)
    let placement
    if (where === 'top') placement = { parentId: null, afterId: null }
    else if (where === 'bottom') placement = { parentId: null, afterId: childrenOf(index, null).at(-1)?.id ?? null }
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
