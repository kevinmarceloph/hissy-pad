// Pad commands: switch, create, rename, delete, move lines across, and the fresh start.
// The data side is core's pads.ts; this file picks targets from the store and lands the
// selection afterwards.
import { buildIndex, countLines, FIXED_PADS, findFixedPad, fixedPadOf, isFixedName, type FixedPad, descendantIds, padCounts, padLines, listSubPads, moveToPlace, placeOf, isPlace, MAIN_PLACE, type Place, createPad, freshStart, lineToPad, padToLine, movePad, topmost, insertAt, isPadNode, listPads, remove, setText, type PadId, type Rows, type Sides } from '@hissypad/core'
import { apply, applyAll, openPad, revealRow, usePad } from './store'
import { edit, stopEditing, targets } from './selection'
import { log } from './log'

// The root level's name. It was Main until 2026-11-24; it is the Inbox tab now.
export const MAIN_PAD_NAME = 'Inbox'

export function padName(all: Rows, padId: PadId): string {
  if (padId === null) return MAIN_PAD_NAME
  return all[padId]?.text || 'Untitled pad'
}

// The pads in switcher order: the fixed three (Today, Inbox, Later; Inbox is the root level),
// then the others by root rank. Today or Later is left out only before the store has settled
// (see settleFixedPads). `count` is the pad's open top-level lines, blank ones left out; the
// switcher shows it when it is not 0. `subs` are the pad's sub-pads (its top-level headers),
// top first, each with its own count. `fixed` names a fixed pad: it cannot be renamed, moved,
// folded in or deleted.
export interface SubPadItem { id: string; name: string; count: number }
export interface PadItem { id: PadId; name: string; count: number; subs: SubPadItem[]; fixed: FixedPad | null }

// A sub-pad's name in a list is its first line up to an em dash: what follows the dash is
// a description, shown on the pad itself only. A line that starts with the dash keeps it all.
export function subName(text: string): string {
  const line = text.split('\n')[0]!.trim()
  return line.split('\u2014')[0]!.trim() || line || 'Untitled'
}

export function padList(all: Rows): PadItem[] {
  const counts = padCounts(all)
  const index = buildIndex(all)
  const subs = (id: PadId): SubPadItem[] => listSubPads(index, id).map((r) => ({ id: r.id, name: subName(r.text), count: padLines(index, r.id, true).length }))
  const item = (id: PadId, name: string, fixed: FixedPad | null): PadItem => ({ id, name, count: counts.get(id) ?? 0, subs: subs(id), fixed })
  const fixed = FIXED_PADS.flatMap((name) => {
    if (name === 'Inbox') return [item(null, name, name)]
    const r = findFixedPad(all, name)
    return r ? [item(r.id, name, name)] : []
  })
  const taken = new Set(fixed.map((p) => p.id))
  return [...fixed, ...listPads(all).filter((r) => !taken.has(r.id)).map((r) => item(r.id, r.text || 'Untitled pad', null))]
}

export function isFixedPad(all: Rows, padId: PadId): boolean {
  return fixedPadOf(all, padId) !== null
}

// Every place a line can be sent to, for any list of pads: each pad, then its sub-pads as
// "Pad → Sub-pad". `key` is one string for the place (a select's value, a stored choice):
// 'main', a pad's id, or a sub-pad's row id.
export const PLACE_ARROW = '→'
export interface PlaceItem extends Place { key: string; label: string; count: number }

export function placeKey(place: Place): string {
  return place.subId ?? place.padId ?? 'main'
}

export function placeFromKey(all: Rows, key: string): Place | null {
  return key === 'main' ? MAIN_PLACE : placeOf(all, key)
}

export function placeName(all: Rows, place: Place): string {
  const pad = padName(all, place.padId)
  return place.subId === null ? pad : `${pad} ${PLACE_ARROW} ${subName(all[place.subId]?.text ?? '')}`
}

export function placeList(all: Rows): PlaceItem[] {
  return padList(all).flatMap((p) => [
    { padId: p.id, subId: null, key: placeKey({ padId: p.id, subId: null }), label: p.name, count: p.count },
    ...p.subs.map((s) => ({ padId: p.id, subId: s.id, key: s.id, label: `${p.name} ${PLACE_ARROW} ${s.name}`, count: s.count })),
  ])
}

// Jump to a sub-pad: open its pad if another one is shown, then scroll to its header.
export function openSubPad(subId: string): boolean {
  const place = placeOf(usePad.getState().all, subId)
  if (!place || place.subId === null) return false
  if (usePad.getState().padId !== place.padId) openPad(place.padId)
  revealRow(subId)
  return true
}

// How many top-level lines a pad holds, crossed-out ones included and blank ones not: what
// "Archive pad" says goes with it.
export function padTopLines(all: Rows, padId: PadId): number {
  return padLines(buildIndex(all), padId).length
}

// The lines the app counts among `ids`: blank ones are left out.
export function countOf(ids: Iterable<string>, rows: Rows = usePad.getState().rows): number {
  let n = 0
  for (const id of ids) n += countLines([rows[id]])
  return n
}

// A pad shown with nothing in it gets one blank line to type into (the same rule as
// deleting the last line). Returns that line's id, or null when the pad has lines.
export function ensureLine(): string | null {
  // An open hour may be empty: a line made for it would land in Today, in the hour.
  if (usePad.getState().slotId !== null) return null
  if (Object.keys(usePad.getState().rows).length > 0) return null
  let id = ''
  apply((rows, ctx) => {
    const res = insertAt(rows, ctx, { parentId: null, afterId: null }, '')
    id = res.newId
    return res.rows
  }, { label: 'ensureLine' })
  return id
}

// A new pad, opened at once with its first blank line ready to type into. Returns its id. A
// fixed pad's name opens that pad instead ('' for the Inbox, which is the root level).
export function cmdNewPad(name: string): string {
  const hit = isFixedName(name) ? FIXED_PADS.find((n) => n.toLowerCase() === name.trim().toLowerCase())! : null
  const existing = hit === 'Inbox' ? '' : hit ? findFixedPad(usePad.getState().all, hit)?.id : undefined
  if (existing !== undefined) {
    openPad(existing || null)
    return existing
  }
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
  if (!text || isFixedName(text) || isFixedPad(usePad.getState().all, padId)) return
  applyAll((all, ctx) => (isPadNode(all[padId]) ? setText(all, ctx, padId, text) : all), { label: 'cmdRenamePad' })
}

// Move a pad one place left or right in the switcher. Returns false at either end.
export function cmdMovePad(padId: string, dir: -1 | 1): boolean {
  const before = usePad.getState().all
  if (isFixedPad(before, padId)) return false
  return applyAll((all, ctx) => (isPadNode(all[padId]) ? movePad(all, ctx, padId, dir) : all), { label: 'cmdMovePad' }) !== before
}

// Archive a pad with everything in it (undo or the Archive panel brings it all back). Returns how many lines
// went with it (blank ones not counted). The fixed pads cannot be archived.
export function cmdDeletePad(padId: string): number {
  const { all, padId: current } = usePad.getState()
  if (!isPadNode(all[padId]) || isFixedPad(all, padId)) return 0
  const n = countOf(descendantIds(buildIndex(all), padId), all)
  if (current === padId) openPad(null)
  applyAll((rows, ctx) => remove(rows, ctx, [padId]), { label: 'cmdDeletePad' })
  return n
}

// Move the selection (or the line being edited) to the top of another pad. Returns how
// many lines moved, subtrees included; 0 when the target is the pad shown.
export function cmdMoveToPad(padId: PadId): number {
  return cmdMoveTo({ padId, subId: null })
}

// The same for any place: a pad, or a sub-pad (one of the pad shown included). Returns how
// many lines moved, subtrees included and blank ones not counted; 0 when nothing moved.
export function cmdMoveTo(place: Place): number {
  const { padId: current, all, rows, slotId } = usePad.getState()
  // In an open hour the lines come from any pad, the open one included.
  if (!isPlace(all, place) || (slotId === null && place.subId === null && place.padId === current)) return 0
  const index = buildIndex(rows)
  const ids = topmost(index, targets()).filter((id) => place.subId === null || (id !== place.subId && rows[id]?.parentId !== place.subId))
  if (ids.length === 0) return 0
  stopEditing()
  const n = countOf(ids.flatMap((id) => [id, ...descendantIds(index, id)]), rows)
  applyAll((table, ctx) => moveToPlace(table, ctx, ids, place), { label: 'cmdMoveTo' })
  usePad.setState({ selection: [], anchorId: null, focusId: null })
  ensureLine()
  log('pad:move', { n, to: placeKey(place).slice(0, 8) })
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

// The opposite of Make pad: fold a pad into another place (a pad or a sub-pad) as a line at
// its top, the pad's lines under it. If the folded pad was the one shown, the pad it went into
// opens. Returns the folded pad's name, or null when refused. One undo step.
export function cmdPadToLine(padId: string, into: Place): string | null {
  const { all, padId: current } = usePad.getState()
  if (!isPadNode(all[padId]) || isFixedPad(all, padId) || into.padId === padId || !isPlace(all, into)) return null
  const name = padName(all, padId)
  stopEditing()
  if (current === padId) openPad(into.padId)
  applyAll((rows, ctx) => padToLine(rows, ctx, padId, into) ?? rows, { label: 'cmdPadToLine' })
  log('pad:toLine', { id: padId.slice(0, 8), into: placeKey(into).slice(0, 8) })
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
