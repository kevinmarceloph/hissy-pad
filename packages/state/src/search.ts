// Search across every pad: the live lines whose text holds every word of the query, in the
// order the pads show them, grouped by pad with the pad on screen first. A pad's name is
// searched too. Asked for, archived lines come last, in a group of their own, newest first. Plain selectors plus the one command that jumps to a hit; both platforms
// draw from this, and nothing here knows about the DOM or React Native.
import { buildIndex, childrenOf, isLive, isPadNode, setCollapsed, type NodeRow, type PadId, type Rows } from '@hissypad/core'
import { applyAll, openPad, revealRow, usePad, zoomTo } from './store'
import { select, stopEditing } from './selection'
import { BATCH_GAP_MS, cmdRestore, foldedAncestors, padOf } from './lists'
import { MAIN_PAD_NAME } from './pads'
import { log } from './log'

export const SEARCH_LIMIT = 60
// A match further into its line than this has the start of the line cut off, so the match
// is on screen in a one-line result.
const LEAD = 28

// A piece of the line shown for a hit; `hit` pieces are the words found.
export interface SearchPart {
  text: string
  hit: boolean
}

export interface SearchHit {
  id: string
  padId: PadId
  isPad: boolean      // the hit is a pad's name, not a line
  archived: boolean   // the line is archived; going to it brings it back
  done: boolean
  path: string[]      // the lines it sits under, outermost first, the pad itself not included
  parts: SearchPart[] // the line of its text that matched
}

export interface SearchGroup {
  padId: PadId
  name: string
  archived: boolean // the group of archived lines, whichever pads they left
  hits: SearchHit[]
}

export interface SearchResult {
  groups: SearchGroup[]
  total: number // every match; `groups` holds the first SEARCH_LIMIT of them
}

const ASCII = /^[\x00-\x7f]*$/
const MARKS = /\p{M}/gu

// Lower case with accents dropped, one character out for each one in, so a position in
// the folded string is the same position in the original.
export function foldText(text: string): string {
  if (ASCII.test(text)) return text.toLowerCase()
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const f = c.normalize('NFD').replace(MARKS, '').toLowerCase()
    out += f.length === 1 ? f : c.toLowerCase().length === 1 ? c.toLowerCase() : c
  }
  return out
}

export function searchTerms(query: string): string[] {
  return [...new Set(foldText(query).split(/\s+/).filter(Boolean))]
}

// The line of `text` to show for these terms (the one with the earliest match), cut into
// plain and matching pieces. Terms that are in another line of the text are not marked.
export function searchParts(text: string, terms: readonly string[]): SearchPart[] {
  const lines = text.split('\n')
  let line = lines.find((l) => l.trim() !== '') ?? ''
  let best = Infinity
  for (const l of lines) {
    const f = foldText(l)
    for (const t of terms) {
      const at = f.indexOf(t)
      if (at !== -1 && at < best) {
        best = at
        line = l
      }
    }
    if (best !== Infinity) break
  }
  const folded = foldText(line)
  const ranges: [number, number][] = []
  for (const t of terms) for (let at = folded.indexOf(t); at !== -1; at = folded.indexOf(t, at + t.length)) ranges.push([at, at + t.length])
  ranges.sort((a, b) => a[0] - b[0])
  // Words that overlap or touch are marked as one piece.
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  const parts: SearchPart[] = []
  const first = merged[0]?.[0] ?? 0
  // Cut at a word start when one is near, so the line does not open mid-word.
  let pos = 0
  if (first > LEAD) {
    const from = first - LEAD
    const space = line.indexOf(' ', from)
    pos = space !== -1 && space < first ? space + 1 : from
    parts.push({ text: '…', hit: false })
  }
  for (const [a, b] of merged) {
    if (a > pos) parts.push({ text: line.slice(pos, a), hit: false })
    parts.push({ text: line.slice(a, b), hit: true })
    pos = b
  }
  if (pos < line.length) parts.push({ text: line.slice(pos), hit: false })
  return parts
}

const firstLineOf = (text: string) => text.split('\n').find((l) => l.trim() !== '')?.trim() ?? ''

// Every live line, in every pad, whose text holds all the words of the query (any order,
// case and accents ignored). `current` is the pad on screen: its hits come first, then the
// other pads in tab order. Lines under a folded line are found too. With `archived`, the
// archived lines that match follow in one group, newest archive first; their path starts
// with the pad they left.
export function search(all: Rows, query: string, current: PadId = null, limit = SEARCH_LIMIT, archived = false): SearchResult {
  const terms = searchTerms(query)
  if (terms.length === 0) return { groups: [], total: 0 }
  const index = buildIndex(all)
  const byPad = new Map<PadId, SearchHit[]>()
  const order: PadId[] = [null]
  const matches = (text: string) => {
    const f = foldText(text)
    return terms.every((t) => f.includes(t))
  }
  const add = (hit: SearchHit) => {
    const list = byPad.get(hit.padId)
    if (list) list.push(hit)
    else byPad.set(hit.padId, [hit])
  }
  const walk = (parentId: string, padId: PadId, path: string[]) => {
    for (const r of childrenOf(index, parentId)) {
      if (matches(r.text)) add({ id: r.id, padId, isPad: false, archived: false, done: r.done, path, parts: searchParts(r.text, terms) })
      if (childrenOf(index, r.id).length > 0) walk(r.id, padId, [...path, firstLineOf(r.text) || '(blank line)'])
    }
  }
  for (const r of childrenOf(index, null)) {
    // isPadNode is a type guard; used straight in the if, it would narrow the else to never.
    const isPad: boolean = isPadNode(r)
    if (isPad) {
      order.push(r.id)
      if (matches(r.text)) add({ id: r.id, padId: r.id, isPad: true, archived: false, done: false, path: [], parts: searchParts(r.text, terms) })
      walk(r.id, r.id, [])
    } else {
      if (matches(r.text)) add({ id: r.id, padId: null, isPad: false, archived: false, done: r.done, path: [], parts: searchParts(r.text, terms) })
      if (childrenOf(index, r.id).length > 0) walk(r.id, null, [firstLineOf(r.text) || '(blank line)'])
    }
  }
  const pads = [current, ...order.filter((p) => p !== current)]
  const groups: SearchGroup[] = []
  let total = 0
  let room = limit
  for (const padId of pads) {
    const hits = byPad.get(padId)
    if (!hits) continue
    total += hits.length
    if (room <= 0) continue
    groups.push({ padId, name: padId === null ? MAIN_PAD_NAME : all[padId]?.text || 'Untitled pad', archived: false, hits: hits.slice(0, room) })
    room -= hits.length
  }
  if (archived) {
    const hits = archivedHits(all, terms)
    total += hits.length
    if (hits.length > 0 && room > 0) groups.push({ padId: null, name: 'Archive', archived: true, hits: hits.slice(0, room) })
  }
  return { groups, total }
}

// Archived rows whose text holds every term, newest archive first. The path is every line
// above the row, live or archived, under the name of the pad it was in.
// isPadNode is for live rows only; an archived pad is still a root row with `pad` set.
const padRow = (r: NodeRow) => r.pad && r.parentId === null

function archivedHits(all: Rows, terms: readonly string[]): SearchHit[] {
  const dead = Object.values(all)
    .filter((r): r is typeof r & { deletedAt: string } => r.deletedAt !== null && r.text.trim() !== '')
    .filter((r) => {
      const f = foldText(r.text)
      return terms.every((t) => f.includes(t))
    })
    .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt) || a.rank.localeCompare(b.rank) || (a.id < b.id ? -1 : 1))
  return dead.map((r) => {
    const isPad = padRow(r)
    const path: string[] = []
    let pad = MAIN_PAD_NAME
    for (let p = r.parentId === null ? undefined : all[r.parentId]; p; p = p.parentId === null ? undefined : all[p.parentId]) {
      if (padRow(p)) {
        pad = p.text || 'Untitled pad'
        break
      }
      path.unshift(firstLineOf(p.text) || '(blank line)')
    }
    return { id: r.id, padId: null, isPad, archived: true, done: r.done, path: isPad ? [] : [pad, ...path], parts: searchParts(r.text, terms) }
  })
}

// The top of the archive a row went in with: the highest archived ancestor removed in the
// same archive. Bringing that back brings the row back where it was.
function archiveTop(all: Rows, id: string): string {
  let top = all[id]!
  const at = Date.parse(top.deletedAt!)
  for (;;) {
    const p = top.parentId === null ? undefined : all[top.parentId]
    if (!p || p.deletedAt === null || Math.abs(Date.parse(p.deletedAt) - at) > BATCH_GAP_MS) return top.id
    top = p
  }
}

// "3 lines", "1 line", or "the first 60 of 214 lines" when the list was cut short.
export function searchCount(result: SearchResult): string {
  const shown = result.groups.reduce((n, g) => n + g.hits.length, 0)
  if (shown < result.total) return `The first ${shown} of ${result.total} lines`
  return `${shown} ${shown === 1 ? 'line' : 'lines'}`
}

// Go to a hit: open its pad if another one is shown, unfold whatever hides it (one undo
// step, and only when something was folded), select the line and scroll to it. A pad's
// name just opens that pad. An archived line comes back first, with what was archived with
// it, as the Archive's Restore does. Returns false when the row is gone.
export function cmdOpenHit(id: string): boolean {
  const { all } = usePad.getState()
  const row = all[id]
  if (row && row.deletedAt !== null) {
    log('search:restore', { id: id.slice(0, 8) })
    if (cmdRestore([archiveTop(all, id)]).length === 0) return false
    return cmdOpenHit(id)
  }
  if (!isLive(row)) return false
  log('search:open', { id: id.slice(0, 8) })
  stopEditing()
  // A card that is zoomed into (Sort's) gives way to the pad the line is in.
  if (usePad.getState().zoomId !== null) zoomTo(null)
  if (isPadNode(row)) return openPad(id)
  if (foldedAncestors(all, id).length > 0) {
    applyAll((rows, ctx) => foldedAncestors(rows, id).reduce((out, a) => setCollapsed(out, ctx, a, false), rows), { label: 'cmdOpenHit' })
  }
  const after = usePad.getState()
  const target = padOf(after.all, id)
  if (target !== after.padId) openPad(target)
  select([id], id)
  revealRow(id)
  return true
}
