// A new item, made on a card of its own (the + beside Search, the widget's +, the Add
// control): the line's text, the pad or sub-pad it goes to, its hour and its sub items.
// The card is live, like Sort's: the row is made at the top of its place the moment there
// is something to keep, and the store zooms into it, so the pad's own rows, keys and
// toolbar edit what is under it. Closing the card keeps the line; Cancel, or a line left
// blank with nothing under it, takes back every op since the card opened.
import { buildIndex, childrenOf, descendantIds, insertAt, isBlank, isLive, isPlace, isSubPad, MAIN_PLACE, moveToPlace, remove, setText, type Place, type Rows } from '@hissypad/core'
import { applyAll, usePad, zoomTo } from './store'
import { dropLastOp } from './history'
import { cmdOpenHit } from './search'
import { log } from './log'

const get = () => usePad.getState()

// Open the card: nothing is being edited or selected behind it. Returns the undo stack's
// length, which cmdCreateEnd goes back to when the card is cancelled.
export function cmdCreateBegin(): number {
  usePad.setState({ editing: null, selection: [], anchorId: null, focusId: null })
  return get().past.length
}

// The place the card opens on: the pad shown.
export function createDefaultPlace(): Place {
  return { padId: get().padId, subId: null }
}

// Make the line at the top of `place` (the Inbox when the place is gone) and zoom into it.
// The text may be blank: the hour was picked or a sub item added before a word was typed.
export function cmdCreateItem(place: Place, text: string): string {
  let id = ''
  applyAll((all, ctx) => {
    const at = isPlace(all, place) ? place : MAIN_PLACE
    const res = insertAt(all, ctx, { parentId: at.subId ?? at.padId, afterId: null }, text)
    id = res.newId
    return res.rows
  }, { label: 'cmdCreateItem' })
  zoomTo(id)
  log('create:item', { id: id.slice(0, 8) })
  return id
}

export function cmdCreateSetText(id: string, text: string) {
  applyAll((all, ctx) => (isLive(all[id]) ? setText(all, ctx, id, text) : all), { label: 'cmdCreateSetText', coalesce: `text:${id}` })
}

// Where the line is: its pad, or the sub-pad it sits directly under.
export function createPlaceOf(all: Rows, id: string): Place {
  const parentId = all[id]?.parentId ?? null
  if (parentId === null) return MAIN_PLACE
  return isSubPad(all, all[parentId]) ? { padId: all[parentId]!.parentId, subId: parentId } : { padId: parentId, subId: null }
}

// Another place picked on the card: the line goes to its top, what is under it comes along.
export function cmdCreateMove(id: string, place: Place) {
  const { all } = get()
  if (!isLive(all[id]) || !isPlace(all, place)) return
  const here = createPlaceOf(all, id)
  if (here.padId === place.padId && here.subId === place.subId) return
  applyAll((table, ctx) => moveToPlace(table, ctx, [id], place), { label: 'cmdCreateMove' })
}

// Nothing worth keeping: no words on the line and none under it.
function empty(all: Rows, id: string): boolean {
  return isBlank(all[id]!) && descendantIds(buildIndex(all), id).every((d) => isBlank(all[d]!))
}

// Close the card. `depth` is what cmdCreateBegin returned and `id` the line made, if any.
// Kept: the line stays, without the blank lines left at the end of its sub items. Not kept
// (Cancel, or nothing typed): every op since the card opened is taken back, with nothing to
// redo. Returns the line's id when it was kept, '' otherwise.
export function cmdCreateEnd(depth: number, id: string | null, keep: boolean): string {
  zoomTo(null)
  const { all } = get()
  if (!id || !isLive(all[id]) || !keep || empty(all, id)) {
    let guard = 0
    while (get().past.length > depth && guard++ < 500) dropLastOp()
    usePad.setState({ selection: [], anchorId: null, focusId: null })
    log('create:end', { kept: false })
    return ''
  }
  // A Return after the last sub item leaves a blank line behind: take the trailing ones out.
  const index = buildIndex(all)
  const gone = new Set<string>()
  const walk = (parentId: string) => {
    const kids = childrenOf(index, parentId)
    for (const k of kids) walk(k.id)
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i]!
      if (!isBlank(k) || childrenOf(index, k.id).some((c) => !gone.has(c.id))) break
      gone.add(k.id)
    }
  }
  walk(id)
  if (gone.size) applyAll((table, ctx) => remove(table, ctx, [...gone]), { label: 'cmdCreateEnd' })
  log('create:end', { kept: true, id: id.slice(0, 8) })
  return id
}

// The card's pad icon: keep the line and go to it in its pad, scrolled to the top.
export function cmdCreateOpen(depth: number, id: string | null): boolean {
  const kept = cmdCreateEnd(depth, id, true)
  return kept !== '' && cmdOpenHit(kept)
}
