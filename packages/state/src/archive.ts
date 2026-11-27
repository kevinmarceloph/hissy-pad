// The Archive screen's list and its one action. Every archived (tombstoned) row is a line
// here, drawn like a pad's: the newest archive first, each archive's lines in the order
// their pad had them, with what was archived under a line still under it. The order is
// fixed. A line says which pad it was in, and unarchiving puts it at the top of that pad:
// where it sat under other lines is not kept (Kevin, 2026-11-25). Pure selectors plus the
// command; both apps draw these, and nothing here knows about the DOM or React Native.
import { compareSiblings, isPadNode, moveToPlace, restore, type NodeRow, type PadId, type Rows } from '@hissypad/core'
import { applyAll, usePad } from './store'
import { MAIN_PAD_NAME } from './pads'

// The screen opens on this many days; older lines are behind "Show older lines". Nothing
// is ever dropped from the table, so the cut is only about what is drawn at first.
export const ARCHIVE_DAYS = 30
// Rows archived this close together count as one archive. `remove` stamps a whole call
// with one timestamp; rows from builds before that are a millisecond or so apart.
export const BATCH_GAP_MS = 1000

export interface ArchiveLine {
  id: string
  row: NodeRow
  depth: number       // 0 for a line the archive took by itself or at the top of what it took
  number: number | null // its place in a numbered run, as the pad drew it; null for a plain line
  deletedAt: string
  isPad: boolean      // a whole pad, archived: it comes back as a tab
  source: string      // the pad it was in, by name; '' for a pad
  sourceLive: boolean // false when that pad is archived too: the line goes to the Inbox then
}

type Dead = NodeRow & { deletedAt: string }
const ms = (iso: string) => Date.parse(iso)
// isPadNode is for live rows only; an archived pad is still a root row with `pad` set.
const padRow = (r: NodeRow): boolean => r.pad && r.parentId === null
const blank = (r: NodeRow) => r.text.trim() === ''

// The pad a row was in: the pad row at the top of its parent chain, archived lines on the
// way included. A chain that ends at the root, or breaks, is the Inbox.
export function sourcePad(all: Rows, id: string): { padId: PadId; name: string; live: boolean } {
  let cur = all[id]
  for (let hops = 0; cur && cur.parentId !== null && hops < 1000; hops++) {
    const p = all[cur.parentId]
    if (!p) break
    if (padRow(p)) return { padId: p.id, name: p.text || 'Untitled pad', live: p.deletedAt === null }
    cur = p
  }
  return { padId: null, name: MAIN_PAD_NAME, live: true }
}

// Archived rows cut into archives: oldest first, a gap wider than BATCH_GAP_MS starts the next.
function batches(all: Rows): Dead[][] {
  const dead = Object.values(all)
    .filter((r): r is Dead => r.deletedAt !== null)
    .sort((a, b) => ms(a.deletedAt) - ms(b.deletedAt) || compareSiblings(a, b))
  const out: Dead[][] = []
  for (const r of dead) {
    const g = out.at(-1)
    if (g && ms(r.deletedAt) - ms(g.at(-1)!.deletedAt) <= BATCH_GAP_MS) g.push(r)
    else out.push([r])
  }
  return out
}

// Every archived line, the newest archive first. Blank lines are left out unless something
// is under them: spacers, and the tombstones an undone Enter leaves behind.
export function archiveLines(all: Rows = usePad.getState().all): ArchiveLine[] {
  const out: ArchiveLine[] = []
  for (const g of batches(all).reverse()) {
    const inBatch = new Set(g.map((r) => r.id))
    const kids = new Map<string, Dead[]>()
    const tops: Dead[] = []
    for (const r of g) {
      if (r.parentId !== null && inBatch.has(r.parentId)) {
        const list = kids.get(r.parentId)
        if (list) list.push(r)
        else kids.set(r.parentId, [r])
      } else tops.push(r)
    }
    // Something to read in the row or anywhere under it.
    const worth = (r: Dead): boolean => !blank(r) || (kids.get(r.id) ?? []).some(worth)
    // Lines that were next to each other, in their order, numbered the way a pad numbers a
    // run. The archive's own top lines count as a run only when they had the same parent.
    const walkAll = (list: Dead[], depth: number, source: ((r: Dead) => { name: string; live: boolean })) => {
      let run = 0
      let prev: Dead | null = null
      for (const r of [...list].sort(depth === 0 ? () => 0 : compareSiblings)) {
        run = r.numbered && (!prev || prev.parentId === r.parentId) ? run + 1 : r.numbered ? 1 : 0
        prev = r
        if (!worth(r)) continue
        const isPad = depth === 0 && padRow(r)
        const src = source(r)
        out.push({ id: r.id, row: r, depth, number: r.numbered ? run : null, deletedAt: r.deletedAt, isPad, source: isPad ? '' : src.name, sourceLive: src.live })
        // Under an archived pad, the lines say that pad: it is archived, as they are.
        const under = isPad ? { name: r.text || 'Untitled pad', live: false } : src
        walkAll(kids.get(r.id) ?? [], depth + 1, () => under)
      }
    }
    walkAll(tops, 0, (r) => sourcePad(all, r.id))
  }
  return out
}

// How many of the lines (as archiveLines lists them) are from the last `days` days: the
// part of the list the screen opens with. A line under another goes by the one on top.
export function archiveRecent(lines: readonly ArchiveLine[], days = ARCHIVE_DAYS, now: number = Date.now()): number {
  const cutoff = now - days * 24 * 60 * 60 * 1000
  let n = 0
  while (n < lines.length && (lines[n]!.depth > 0 || ms(lines[n]!.deletedAt) >= cutoff)) n++
  return n
}

// ---- Selection ---------------------------------------------------------------------
// The screen keeps its own: the pad's selection is about the pad on screen.

export interface ArchiveSelection {
  ids: string[]
  anchorId: string | null
}

export const NO_ARCHIVE_SELECTION: ArchiveSelection = { ids: [], anchorId: null }

// A tap on a line: it goes in or out of the selection. With Shift, every line from the
// last one tapped to this one is selected.
export function archiveTap(sel: ArchiveSelection, lines: readonly ArchiveLine[], id: string, shift = false): ArchiveSelection {
  if (shift && sel.anchorId !== null) {
    const a = lines.findIndex((l) => l.id === sel.anchorId)
    const b = lines.findIndex((l) => l.id === id)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      return { ids: lines.slice(lo, hi + 1).map((l) => l.id), anchorId: sel.anchorId }
    }
  }
  const has = sel.ids.includes(id)
  const ids = has ? sel.ids.filter((x) => x !== id) : [...sel.ids, id]
  return { ids, anchorId: has ? (ids.at(-1) ?? null) : id }
}

// The lines under a selected one: they come back with it, so they are drawn in a fainter wash.
export function archiveCovered(lines: readonly ArchiveLine[], ids: readonly string[]): Set<string> {
  const picked = new Set(ids)
  const out = new Set<string>()
  let under = -1 // the depth of the selected line being walked under, or -1
  for (const l of lines) {
    if (under >= 0 && l.depth > under) {
      if (!picked.has(l.id)) out.add(l.id)
      continue
    }
    under = picked.has(l.id) ? l.depth : -1
  }
  return out
}

// A selection with the ids that are no longer archived taken out (another device, an undo).
export function archivePrune(sel: ArchiveSelection, lines: readonly ArchiveLine[]): ArchiveSelection {
  const there = new Set(lines.map((l) => l.id))
  if (sel.ids.every((id) => there.has(id))) return sel
  const ids = sel.ids.filter((id) => there.has(id))
  return { ids, anchorId: sel.anchorId !== null && there.has(sel.anchorId) ? sel.anchorId : (ids.at(-1) ?? null) }
}

// ---- Unarchive ---------------------------------------------------------------------

// A row plus every archived row under it from the same archive. A sub item archived
// earlier on its own is not part of it and stays archived.
export function batchSubtree(all: Rows, id: string): string[] {
  const root = all[id]
  if (!root || root.deletedAt === null) return []
  const at = ms(root.deletedAt)
  const byParent = new Map<string | null, NodeRow[]>()
  for (const r of Object.values(all)) {
    if (r.deletedAt === null || Math.abs(ms(r.deletedAt) - at) > BATCH_GAP_MS) continue
    const list = byParent.get(r.parentId)
    if (list) list.push(r)
    else byParent.set(r.parentId, [r])
  }
  const out: string[] = []
  const walk = (pid: string) => {
    out.push(pid)
    for (const c of byParent.get(pid) ?? []) walk(c.id)
  }
  walk(id)
  return out
}

export interface Unarchived {
  ids: string[]     // the lines asked for that came back (not the ones under them)
  count: number     // every line that came back, blank ones not counted
  places: string[]  // the pads they went to, by name, each once
  pads: string[]    // the pads that came back as tabs, by name
}

// Bring archived lines back: each to the top of the pad it was in, with what was archived
// under it, whatever it sat under before. A line whose pad is archived goes to the Inbox.
// An archived pad comes back as a tab with its lines. One undo step. The screen is left
// where it is.
export function cmdUnarchive(ids: readonly string[]): Unarchived {
  const out: Unarchived = { ids: [], count: 0, places: [], pads: [] }
  const before = usePad.getState().all
  const asked = ids.filter((id) => before[id] && before[id]!.deletedAt !== null)
  // A line under another one asked for comes back with it, where it is.
  const carried = new Set<string>()
  for (const id of asked) for (const d of batchSubtree(before, id)) if (d !== id) carried.add(d)
  const tops = asked.filter((id) => !carried.has(id))
  if (tops.length === 0) return out
  const places = new Set<string>()
  applyAll((all, ctx) => {
    let next = all
    // Pads first, so a line of one that is asked for too finds it back.
    const pads = tops.filter((id) => padRow(all[id]!))
    const lines = tops.filter((id) => !padRow(all[id]!))
    for (const id of pads) {
      next = restore(next, ctx, batchSubtree(next, id))
      out.pads.push(next[id]!.text || 'Untitled pad')
    }
    // Last to first, each to the top: they end in the order they were listed.
    for (const id of [...lines].reverse()) {
      const src = sourcePad(next, id)
      const padId = src.live && (src.padId === null || isPadNode(next[src.padId])) ? src.padId : null
      next = restore(next, ctx, batchSubtree(next, id))
      next = moveToPlace(next, ctx, [id], { padId, subId: null })
      places.add(padId === null ? MAIN_PAD_NAME : src.name)
    }
    return next
  }, { label: 'cmdUnarchive' })
  const after = usePad.getState().all
  out.ids = tops.filter((id) => after[id]?.deletedAt === null)
  out.count = Object.values(after).filter((r) => r.deletedAt === null && before[r.id]?.deletedAt != null && !blank(r) && !padRow(r)).length
  out.places = [...places].reverse() // the lines were walked last to first
  return out
}

// What a toast says after it: "Unarchived 2 lines to Today." / "Unarchived the pad Work with 3 lines."
export function unarchivedLabel(u: Unarchived): string {
  if (u.ids.length === 0) return 'Nothing to unarchive.'
  const lines = `${u.count} ${u.count === 1 ? 'line' : 'lines'}`
  const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)
  if (u.pads.length > 0) {
    const pads = `the ${u.pads.length === 1 ? 'pad' : 'pads'} ${list(u.pads)}`
    return u.count > 0 ? `Unarchived ${pads} with ${lines}.` : `Unarchived ${pads}.`
  }
  return `Unarchived ${lines} to ${list(u.places)}.`
}
