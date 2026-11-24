// Undo and redo. An entry (HistoryEntry in store.ts) holds only the rows one op touched,
// as they were and as they became. Undo puts the `before` values back with a fresh
// updatedAt, so the undo itself syncs and never reverts rows another device changed since.
import { buildIndex, flatten, type NodeRow, type Rows } from '@hissypad/core'
import { log, rowBrief } from './log'
import { breakCoalesce, ctx, persist, setAll, usePad } from './store'

const get = () => usePad.getState()
const set = usePad.setState

// Restore one side of an entry onto the table. Rows that did not exist on that side
// become tombstones (an undone insert). Everything restored gets a fresh updatedAt.
// An undone insert also loses its hour: Hours lists archived lines, and this one never was
// a line to archive (a redo puts the slot back with the rest of the row).
function restore(side: Record<string, NodeRow | undefined>, ids: string[]): { rows: Rows; touched: string[] } {
  const cur = get().all
  const out: Record<string, NodeRow> = { ...cur }
  const touched: string[] = []
  for (const id of ids) {
    const want = side[id]
    const now = ctx.now()
    if (want) out[id] = { ...want, updatedAt: now }
    else if (cur[id]) out[id] = { ...cur[id]!, slot: null, deletedAt: now, updatedAt: now }
    else continue
    touched.push(id)
  }
  return { rows: out, touched }
}

function afterHistoryMove(all: Rows, touched: string[]) {
  // Land on what changed: select the restored rows that are live and visible in the pad
  // being shown (an undo of a move to another pad lands on nothing, and that is fine).
  // Redoing a pad's deletion while it is open falls back to the main pad (setAll).
  setAll(all, { editing: null })
  const { rows } = get()
  const vis = new Set(flatten(buildIndex(rows), true).map((r) => r.id))
  const sel = touched.filter((id) => vis.has(id))
  set({ selection: sel, anchorId: sel[0] ?? null, focusId: sel.at(-1) ?? null })
}

export function undo() {
  const { all: rows, past, future } = get()
  const entry = past.at(-1)
  if (!entry) {
    log('undo', { nothing: true })
    return
  }
  breakCoalesce()
  const ids = Object.keys(entry.before)
  const r = restore(entry.before, ids)
  afterHistoryMove(r.rows, r.touched)
  set({ past: past.slice(0, -1), future: [entry, ...future] })
  log('undo', { label: entry.label, rows: r.touched.map((id) => rowBrief(r.rows[id])), undoDepth: past.length - 1 })
  persist(rows, r.rows)
}

// Take the last op back as if it had never happened: its rows go back, there is nothing to
// redo, and editing and selection stay where they are. For a new line that was opened and
// left without a word typed.
export function dropLastOp() {
  const { all: rows, past } = get()
  const entry = past.at(-1)
  if (!entry) return
  breakCoalesce()
  const r = restore(entry.before, Object.keys(entry.before))
  setAll(r.rows)
  set({ past: past.slice(0, -1) })
  log('drop', { label: entry.label, rows: r.touched.map((id) => rowBrief(r.rows[id])) })
  persist(rows, r.rows)
}

export function redo() {
  const { all: rows, past, future } = get()
  const entry = future[0]
  if (!entry) {
    log('redo', { nothing: true })
    return
  }
  breakCoalesce()
  const ids = Object.keys(entry.after)
  const r = restore(entry.after, ids)
  afterHistoryMove(r.rows, r.touched)
  set({ past: [...past, entry], future: future.slice(1) })
  log('redo', { label: entry.label, rows: r.touched.map((id) => rowBrief(r.rows[id])) })
  persist(rows, r.rows)
}

