// Editor commands shared by the textarea key handler (Row) and the selection-mode key
// handler (Pad). Each one picks its targets from the store and decides where the caret or
// selection goes afterwards.
import {
  buildIndex, childrenOf, countLines, setCollapsed, dedent, indent, insertAfter, insertAt, insertAtTop, insertBefore, mergeIntoPrev, moveSibling, remove, removeDone, ungroup,
  setKind, setText as setTextOp, splitNode, toggleCollapsed, toggleDone, toggleNumbered, toOutline, toOutlineHtml, type NodeKind, type Placement, type Rows,
} from '@hissypad/core'
// The platform registers how text reaches the clipboard (web: navigator.clipboard with a
// dialog fallback; mobile: expo-clipboard). `html` is the same outline as nested lists,
// for apps that paste rich text; it is absent when the copy is a single line.
export type ClipboardWriter = (text: string, html?: string) => Promise<boolean>
let copyText: ClipboardWriter = async () => false
export function setClipboard(fn: ClipboardWriter) {
  copyText = fn
}
import { apply, importOutline, usePad } from './store'
import { dropLastOp } from './history'
import { edit, neighbor, select, stopEditing, targets, visibleIds } from './selection'

export function cmdSplit(id: string, caret: number) {
  let newId = ''
  apply((rows, ctx) => {
    const res = splitNode(rows, ctx, id, caret)
    newId = res.newId
    return res.rows
  }, { label: 'cmdSplit' })
  edit(newId, 0)
}

// Enter at the very start of a non-empty line: a blank line appears above and takes the
// caret, so the next thing typed goes in front. Anywhere else, the line splits at the caret.
export function cmdEnter(id: string, caret: number) {
  const row = usePad.getState().rows[id]
  if (row && caret === 0 && row.text.length > 0) {
    let newId = ''
    apply((rows, ctx) => {
      const res = insertBefore(rows, ctx, id, '')
      newId = res.newId
      return res.rows
    }, { label: 'cmdEnter' })
    edit(newId, 0)
    return
  }
  cmdSplit(id, caret)
}

// Toolbar "+ above" / "+ below": a new blank line next to the current one (the first or
// last of a selection), ready to type into.
export function cmdAddAbove() {
  const ids = targets()
  const id = ids[0]
  if (!id) return
  let newId = ''
  apply((rows, ctx) => {
    const res = insertBefore(rows, ctx, id, '')
    newId = res.newId
    return res.rows
  }, { label: 'cmdAddAbove' })
  edit(newId, 0)
}

export function cmdAddBelow() {
  const ids = targets()
  const id = ids.at(-1)
  if (!id) return
  let newId = ''
  apply((rows, ctx) => {
    const res = insertAfter(rows, ctx, id, '')
    newId = res.newId
    return res.rows
  }, { label: 'cmdAddBelow' })
  edit(newId, 0)
}

// The floating +: a new blank line at the very top of the pad, ready to type into.
// Returns its id.
export function cmdAddAtTop(): string {
  let newId = ''
  apply((rows, ctx) => {
    const res = insertAtTop(rows, ctx, '')
    newId = res.newId
    return res.rows
  }, { label: 'cmdAddAtTop' })
  edit(newId, 0)
  openedBlank(newId)
  return newId
}

// The floating + dragged onto the pad and dropped: a new blank line at that spot, ready to
// type into. Returns its id.
export function cmdAddAt(placement: Placement): string {
  let newId = ''
  apply((rows, ctx) => {
    const res = insertAt(rows, ctx, placement, '')
    newId = res.newId
    return res.rows
  }, { label: 'cmdAddAt' })
  edit(newId, 0)
  openedBlank(newId)
  return newId
}

// A tap on the space under a header's group: a new blank line as the header's last sub
// item, ready to type into. A folded header opens first. Returns the new line's id.
export function cmdAddUnder(id: string): string {
  if (!usePad.getState().rows[id]) return ''
  let newId = ''
  apply((rows, ctx) => {
    const open = setCollapsed(rows, ctx, id, false)
    const last = childrenOf(buildIndex(open), id).at(-1)
    const res = insertAt(open, ctx, { parentId: id, afterId: last?.id ?? null }, '')
    newId = res.newId
    return res.rows
  }, { label: 'cmdAddUnder' })
  edit(newId, 0)
  openedBlank(newId)
  return newId
}

export function cmdSetText(id: string, text: string) {
  apply((rows, ctx) => setTextOp(rows, ctx, id, text), { label: 'cmdSetText', coalesce: `text:${id}` })
}

// Backspace at the start of a node.
export function cmdBackspaceAtStart(id: string) {
  const prev = neighbor(id, -1)
  const row = usePad.getState().rows[id]
  if (!row) return
  if (row.text === '') {
    const hasKids = childrenOf(buildIndex(usePad.getState().rows), id).length > 0
    if (hasKids || !prev) return
    apply((rows, ctx) => remove(rows, ctx, [id]), { label: 'cmdBackspaceAtStart' })
    edit(prev, 'end')
    return
  }
  const landing: { prevId: string; caret: number }[] = []
  apply((rows, ctx) => {
    const res = mergeIntoPrev(rows, ctx, id)
    if (!res) return rows
    landing.push({ prevId: res.prevId, caret: res.caret })
    return res.rows
  }, { label: 'cmdBackspaceAtStart:merge' })
  const l = landing[0]
  if (l) edit(l.prevId, l.caret)
}

export function cmdIndent() {
  const ids = targets()
  if (ids.length) apply((rows, ctx) => indent(rows, ctx, ids), { label: 'cmdIndent' })
}

export function cmdDedent() {
  const ids = targets()
  if (ids.length) apply((rows, ctx) => dedent(rows, ctx, ids), { label: 'cmdDedent' })
}

// Ungroup: the children of each target come out to its own level, right after it.
export function cmdUngroup() {
  const ids = targets()
  if (ids.length) apply((rows, ctx) => ungroup(rows, ctx, ids), { label: 'cmdUngroup' })
}

export function cmdMove(dir: 'up' | 'down') {
  const ids = targets()
  if (ids.length) apply((rows, ctx) => moveSibling(rows, ctx, ids, dir), { label: 'cmdMove' })
}

export function cmdToggleDone() {
  const ids = targets()
  if (ids.length) apply((rows, ctx) => toggleDone(rows, ctx, ids), { label: 'cmdToggleDone' })
}

export function cmdToggleCollapsed() {
  const ids = targets()
  if (ids.length === 0) return
  apply((rows, ctx) => {
    let out = rows
    for (const id of ids) out = toggleCollapsed(out, ctx, id)
    return out
  }, { label: 'cmdToggleCollapsed' })
}

// Delete the selection and land on the row that takes its place: the first line after
// the selection that is still there (its own children go with it, so they do not count),
// else the nearest one before it.
export function cmdDeleteSelection() {
  const selection = targets()
  if (selection.length === 0) return
  const vis = visibleIds()
  const from = vis.indexOf(selection.at(-1)!)
  const to = vis.indexOf(selection[0]!)
  apply((rows, ctx) => {
    const out = remove(rows, ctx, selection)
    // Never leave the pad with nothing to type into.
    const anyLive = Object.values(out).some((r) => r.deletedAt === null)
    return anyLive ? out : insertAt(out, ctx, { parentId: null, afterId: null }, '').rows
  }, { label: 'cmdDeleteSelection' })
  const left = new Set(visibleIds())
  const landing = vis.slice(from + 1).find((id) => left.has(id)) ?? vis.slice(0, Math.max(0, to)).reverse().find((id) => left.has(id)) ?? visibleIds()[0]
  if (landing) select([landing], landing)
}

// Copy as outline: "- " bullets and two-space indents in the plain-text half (so a text
// box shows dashes), nested <ul>/<ol> in the HTML half (so a rich-text box shows real
// bullets). A lone line copies as bare text, like copying from a text field.
export function copyPayload(rows: Rows, ids: readonly string[]): { text: string; html?: string } {
  const text = toOutline(rows, ids, { done: '' })
  if (!text.includes('\n')) return { text: toOutline(rows, ids, { bullet: '', done: '' }) }
  return { text, html: toOutlineHtml(rows, ids) }
}

export function cmdCopySelection(): string {
  const { rows } = usePad.getState()
  const { text, html } = copyPayload(rows, targets())
  void copyText(text, html)
  return text
}

export function cmdCutSelection() {
  cmdCopySelection()
  cmdDeleteSelection()
}

// Paste into a textarea: single-line text goes through the browser; multi-line becomes
// nodes after the current one (replacing it when it was empty).
export function cmdPasteInto(id: string, text: string): boolean {
  if (!text.includes('\n')) return false
  const empty = usePad.getState().rows[id]?.text === ''
  const ids = importOutline(text, { afterId: id })
  if (ids.length === 0) return false
  if (empty) apply((rows, ctx) => remove(rows, ctx, [id]), { label: 'cmdPasteInto' })
  edit(ids.at(-1)!, 'end')
  return true
}

// A native text input reporting its whole value after a change (the mobile app has no
// paste event): several newlines at once is a paste, one newline is Enter, otherwise the
// text is typed. Returns what the input should show for `id` now. The head (text before
// the first newline) is written before the rest becomes lines, because cmdPasteInto drops
// the row when the store still says it is empty.
export function cmdTextChanged(id: string, text: string): string {
  const first = text.indexOf('\n')
  if (first < 0) {
    cmdSetText(id, text)
    return text
  }
  const head = text.slice(0, first)
  if (text.indexOf('\n', first + 1) >= 0) {
    cmdSetText(id, head)
    if (cmdPasteInto(id, text.slice(first + 1))) return head
  }
  const flat = head + text.slice(first + 1)
  cmdSetText(id, flat)
  cmdEnter(id, first)
  return flat
}

export function cmdPasteAfterSelection(text: string) {
  const { selection } = usePad.getState()
  const last = selection.at(-1)
  const ids = last ? importOutline(text, { afterId: last }) : importOutline(text, 'bottom')
  if (ids.length) select(ids, ids[0]!, ids.at(-1)!)
}

export function cmdToggleNumbered() {
  const ids = targets()
  if (ids.length) apply((rows, ctx) => toggleNumbered(rows, ctx, ids), { label: 'cmdToggleNumbered' })
}

// The toolbar's type switcher: every target becomes plain, numbered or a header.
export function cmdSetKind(kind: NodeKind) {
  const ids = targets()
  if (ids.length) apply((rows, ctx) => setKind(rows, ctx, ids, kind), { label: `cmdSetKind:${kind}` })
}

// Delete every crossed-out line. Returns how many lines went (subtrees included), so the
// caller can say so and point at undo.
export function cmdDeleteDone(): number {
  stopEditing()
  const before = countLines(Object.values(usePad.getState().rows).filter((r) => r.deletedAt === null))
  apply((rows, ctx) => {
    const out = removeDone(rows, ctx)
    const anyLive = Object.values(out).some((r) => r.deletedAt === null)
    return anyLive ? out : insertAt(out, ctx, { parentId: null, afterId: null }, '').rows
  }, { label: 'cmdDeleteDone' })
  const after = countLines(Object.values(usePad.getState().rows).filter((r) => r.deletedAt === null))
  usePad.setState({ selection: [], anchorId: null, focusId: null })
  return Math.max(0, before - after)
}

// Click below the last row: reuse an empty last line or add one.
export function cmdAppendAtEnd() {
  const vis = visibleIds()
  const last = vis.at(-1)
  const rows = usePad.getState().rows
  if (last && rows[last]!.text === '' && rows[last]!.parentId === null) return edit(last, 'end')
  let newId = ''
  apply((rows, ctx) => {
    const index = buildIndex(rows)
    const res = insertAt(rows, ctx, { parentId: null, afterId: childrenOf(index, null).at(-1)?.id ?? null }, '')
    newId = res.newId
    return res.rows
  }, { label: 'cmdAppendAtEnd' })
  edit(newId, 0)
  openedBlank(newId)
}

export function cmdEditNeighbor(id: string, dir: -1 | 1) {
  const n = neighbor(id, dir)
  if (n) edit(n, dir < 0 ? 'end' : 0)
}

// ---- a new line left empty ---------------------------------------------------------
//
// A line opened by a tap on empty space (the end of the pad, the space under a header) or
// by the floating + is cancelled when the user leaves it without typing: the line goes,
// and so does its undo step. Anything done in between (a letter typed, Enter, an indent)
// is an op of its own and makes the line stay, blank or not.

let blank: { id: string; depth: number } | null = null

function openedBlank(id: string) {
  blank = { id, depth: usePad.getState().past.length }
}

usePad.subscribe((s) => {
  const b = blank
  if (!b || s.editing?.id === b.id) return
  blank = null
  const row = s.all[b.id]
  if (s.past.length === b.depth && row && row.deletedAt === null && row.text === '') dropLastOp()
})
