// The web app's state: the rows (from core), what is selected or being edited, and the
// undo stack. Every edit goes through `apply`, which runs a core op, pushes undo history,
// and writes the changed rows to the LocalStore as dirty.
import { create } from 'zustand'
import {
  buildIndex, changedRows, childrenOf, createClock, createMemoryStore, flatten,
  insertAt, insertOutline, newUuid, parseOutline, type LocalStore, type NodeRow, type OpCtx, type Rows,
} from '@hissypad/core'

export type Caret = number | 'end'

export interface Editing {
  id: string
  caret: Caret
  rev: number // bumped whenever focus should be (re)applied
}

export type LoadState = 'loading' | 'ready' | 'error'

export interface PadState {
  rows: Rows
  load: LoadState
  storageError: string | null
  editing: Editing | null
  selection: string[] // in visible order
  anchorId: string | null
  focusId: string | null // the end of a shift-extended range
  past: Rows[]
  future: Rows[]
}

const clock = createClock()
export const ctx: OpCtx = { now: () => clock.tick(), newId: newUuid }

let local: LocalStore = createMemoryStore()
export function configureLocalStore(store: LocalStore) {
  local = store
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
  local.upsertMany(changed, { dirty: true }).catch((e: unknown) => {
    set({ storageError: `Could not save: ${(e as Error).message}` })
  })
}

// Run an op. `coalesce` lets a run of keystrokes on one node share a single undo entry.
let lastCoalesce: { key: string; at: number } | null = null
export function apply(fn: (rows: Rows, ctx: OpCtx) => Rows, opts: { coalesce?: string } = {}): Rows {
  const { rows, past } = get()
  const next = fn(rows, ctx)
  if (next === rows) return rows
  const now = Date.now()
  const merge = opts.coalesce !== undefined && lastCoalesce?.key === opts.coalesce && now - lastCoalesce.at < 1500
  lastCoalesce = opts.coalesce !== undefined ? { key: opts.coalesce, at: now } : null
  set({ rows: next, past: merge ? past : [...past.slice(-UNDO_LIMIT + 1), rows], future: [] })
  persist(rows, next)
  return next
}

export function undo() {
  const { rows, past, future } = get()
  const prev = past.at(-1)
  if (!prev) return
  lastCoalesce = null
  set({ rows: prev, past: past.slice(0, -1), future: [rows, ...future], editing: null, selection: [] })
  persist(rows, prev)
}

export function redo() {
  const { rows, past, future } = get()
  const next = future[0]
  if (!next) return
  lastCoalesce = null
  set({ rows: next, past: [...past, rows], future: future.slice(1), editing: null, selection: [] })
  persist(rows, next)
}

export async function loadPad() {
  try {
    const list = await local.getAll()
    const rows: Record<string, NodeRow> = {}
    for (const r of list) {
      rows[r.id] = r
      clock.observe(r.updatedAt)
    }
    let state: Rows = rows
    const live = Object.values(rows).some((r) => r.deletedAt === null)
    if (!live) {
      // A pad always has at least one line to type into.
      const res = insertAt(rows, ctx, { parentId: null, afterId: null }, '')
      state = res.rows
      await local.upsertMany(changedRows(rows, state), { dirty: true })
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
  set({ editing: { id, caret, rev: (cur?.rev ?? 0) + 1 }, selection: [], anchorId: null, focusId: null })
}

export function stopEditing() {
  set({ editing: null })
}

export function visibleIds(state: PadState = get()): string[] {
  return flatten(buildIndex(state.rows), true).map((r) => r.id)
}

export function select(ids: string[], anchorId: string | null, focusId: string | null = anchorId) {
  const order = new Map(visibleIds().map((id, i) => [id, i]))
  const sorted = [...new Set(ids)].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!)
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
  })
  return ids
}

export function dismissStorageError() {
  set({ storageError: null })
}
