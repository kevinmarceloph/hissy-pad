// Pad commands: switch, create, rename, delete, move lines across, and the fresh start.
// The data side is core's pads.ts; this file picks targets from the store and lands the
// selection afterwards.
import { buildIndex, createPad, freshStart, lineToPad, padToLine, movePad, topmost, insertAt, isPadNode, listPads, moveToPad, remove, setText, type PadId, type Rows, type Sides } from '@hissypad/core'
import { apply, applyAll, openPad, usePad } from './store'
import { edit, stopEditing, targets } from './selection'
import { log } from './log'

export const MAIN_PAD_NAME = 'Main'

export function padName(all: Rows, padId: PadId): string {
  if (padId === null) return MAIN_PAD_NAME
  return all[padId]?.text || 'Untitled pad'
}

// The pads in switcher order: main first, then the others by root rank.
export function padList(all: Rows): { id: PadId; name: string }[] {
  return [{ id: null, name: MAIN_PAD_NAME }, ...listPads(all).map((r) => ({ id: r.id, name: r.text || 'Untitled pad' }))]
}

// A pad shown with nothing in it gets one blank line to type into (the same rule as
// deleting the last line). Returns that line's id, or null when the pad has lines.
export function ensureLine(): string | null {
  if (Object.keys(usePad.getState().rows).length > 0) return null
  let id = ''
  apply((rows, ctx) => {
    const res = insertAt(rows, ctx, { parentId: null, afterId: null }, '')
    id = res.newId
    return res.rows
  }, { label: 'ensureLine' })
  return id
}

// A new pad, opened at once with its first blank line ready to type into. Returns its id.
export function cmdNewPad(name: string): string {
  let id = ''
  applyAll((all, ctx) => {
    const res = createPad(all, ctx, name.trim() || 'Untitled pad')
    id = res.padId
    return res.rows
  }, { label: 'cmdNewPad' })
  openPad(id)
  const line = ensureLine()
  if (line) edit(line, 0)
  return id
}

export function cmdRenamePad(padId: string, name: string) {
  const text = name.trim()
  if (!text) return
  applyAll((all, ctx) => (isPadNode(all[padId]) ? setText(all, ctx, padId, text) : all), { label: 'cmdRenamePad' })
}

// Move a pad one place left or right in the switcher. Returns false at either end.
export function cmdMovePad(padId: string, dir: -1 | 1): boolean {
  const before = usePad.getState().all
  return applyAll((all, ctx) => (isPadNode(all[padId]) ? movePad(all, ctx, padId, dir) : all), { label: 'cmdMovePad' }) !== before
}

// Delete a pad with everything in it (undo brings it all back). Returns how many lines
// went with it. The main pad cannot be deleted.
export function cmdDeletePad(padId: string): number {
  const { all, padId: current } = usePad.getState()
  if (!isPadNode(all[padId])) return 0
  const before = Object.values(all).filter((r) => r.deletedAt === null).length
  if (current === padId) openPad(null)
  applyAll((rows, ctx) => remove(rows, ctx, [padId]), { label: 'cmdDeletePad' })
  const after = Object.values(usePad.getState().all).filter((r) => r.deletedAt === null).length
  return Math.max(0, before - after - 1)
}

// Move the selection (or the line being edited) to the top of another pad. Returns how
// many lines moved, subtrees included; 0 when the target is the pad shown.
export function cmdMoveToPad(padId: PadId): number {
  const ids = targets()
  const { padId: current, all } = usePad.getState()
  if (ids.length === 0 || padId === current) return 0
  if (padId !== null && !isPadNode(all[padId])) return 0
  stopEditing()
  const liveBefore = Object.keys(usePad.getState().rows).length
  applyAll((rows, ctx) => moveToPad(rows, ctx, ids, padId), { label: 'cmdMoveToPad' })
  usePad.setState({ selection: [], anchorId: null, focusId: null })
  const n = liveBefore - Object.keys(usePad.getState().rows).length
  ensureLine()
  log('pad:move', { n, to: padId?.slice(0, 8) ?? 'main' })
  return n
}

// The one line a "Make pad" would convert: the selection (or the line being edited) when
// it comes down to a single line with its subtree; null otherwise.
export function padCandidate(): string | null {
  const tops = topmost(buildIndex(usePad.getState().rows), targets())
  return tops.length === 1 ? tops[0]! : null
}

// Turn that line into a pad: its text names the pad and its sub items become the pad's
// lines. The pad shown stays open. Returns the new pad's id and name, or null.
export function cmdLineToPad(): { padId: string; name: string } | null {
  const id = padCandidate()
  if (!id) return null
  stopEditing()
  let name = ''
  applyAll((all, ctx) => {
    const res = lineToPad(all, ctx, id)
    if (!res) return all
    name = res.name
    return res.rows
  }, { label: 'cmdLineToPad' })
  if (!name) return null
  usePad.setState({ selection: [], anchorId: null, focusId: null })
  ensureLine()
  log('pad:fromLine', { id: id.slice(0, 8), name })
  return { padId: id, name }
}

// The opposite of Make pad: fold a pad into another pad (null for main) as a line at its
// top, the pad's lines under it. If the folded pad was the one shown, the pad it went into
// opens. Returns the folded pad's name, or null when refused. One undo step.
export function cmdPadToLine(padId: string, into: PadId): string | null {
  const { all, padId: current } = usePad.getState()
  if (!isPadNode(all[padId]) || into === padId || (into !== null && !isPadNode(all[into]))) return null
  const name = padName(all, padId)
  stopEditing()
  if (current === padId) openPad(into)
  applyAll((rows, ctx) => padToLine(rows, ctx, padId, into) ?? rows, { label: 'cmdPadToLine' })
  log('pad:toLine', { id: padId.slice(0, 8), into: into?.slice(0, 8) ?? 'main' })
  return name
}

// "Before 2 Nov 2026", or "Work, before 2 Nov 2026" for a pad of its own.
export function archiveNameFor(all: Rows, padId: PadId, date = new Date()): string {
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return padId === null ? `Before ${day}` : `${padName(all, padId)}, before ${day}`
}

// Commit a fresh start on the pad shown: the right side stays, the left side becomes a
// new pad named `archiveName`. One undo step.
export function cmdFreshStart(sides: Sides, archiveName: string): { archiveId: string; moved: number } {
  const { padId } = usePad.getState()
  stopEditing()
  let out = { archiveId: '', moved: 0 }
  applyAll((all, ctx) => {
    const res = freshStart(all, ctx, padId, sides, archiveName.trim() || archiveNameFor(all, padId))
    out = { archiveId: res.archiveId, moved: res.moved }
    return res.rows
  }, { label: 'cmdFreshStart' })
  usePad.setState({ selection: [], anchorId: null, focusId: null })
  ensureLine()
  log('pad:freshStart', out)
  return out
}
