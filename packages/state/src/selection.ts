// What is selected and what is being edited, in the pad shown. Selection is a list of
// row ids in visible order with an anchor (where a shift-range starts) and a focus (where
// it ends); editing is one row id with a caret.
import { buildIndex, childrenOf, flatten, isLive } from '@hissypad/core'
import { log } from './log'
import { usePad, type Caret, type PadState } from './store'

const get = () => usePad.getState()
const set = usePad.setState

export function edit(id: string, caret: Caret = 'end') {
  const cur = get().editing
  log('edit', { id: id.slice(0, 8), caret })
  set({ editing: { id, caret, rev: (cur?.rev ?? 0) + 1 }, selection: [], anchorId: null, focusId: null })
}

// A picker (Hour…, Category…) takes focus, and that ends the edit. holdEditing notes the
// line being edited as the picker opens; resumeEditing, called when the picker has closed,
// puts the caret back in it, unless something else got edited or selected meanwhile.
let held: string | null = null
export function holdEditing() {
  held = get().editing?.id ?? null
}
export function resumeEditing() {
  const id = held
  held = null
  const s = get()
  if (!id || s.editing || s.selection.length > 0 || !isLive(s.rows[id])) return
  edit(id, 'end')
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

// A finger drawn down (or up) the bullets in selection mode: the lines from the bullet it
// started on to the one under it now join `base`, what was selected when it started. Drawn
// back, they leave again.
export function paintSelect(base: readonly string[], fromId: string, toId: string) {
  const vis = visibleIds()
  const a = vis.indexOf(fromId)
  const b = vis.indexOf(toId)
  if (a < 0 || b < 0) return
  const [lo, hi] = a < b ? [a, b] : [b, a]
  select([...base, ...vis.slice(lo, hi + 1)], fromId, toId)
}

// Shift+Up or Shift+Down while editing, with the caret on the line's first or last visual
// line (Kevin, 2026-11-27): the edit ends and the line is selected with its previous or next
// sibling, as a range from the line, so more Shift+arrows carry on from there. With no
// sibling that way, just the line.
export function selectWithSibling(id: string, dir: -1 | 1) {
  const r = get().rows[id]
  if (!r) return
  const sibs = childrenOf(buildIndex(get().rows), r.parentId)
  const sib = sibs[sibs.findIndex((x) => x.id === id) + dir]
  if (!sib) return select([id], id)
  select([id, sib.id], id, sib.id)
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

