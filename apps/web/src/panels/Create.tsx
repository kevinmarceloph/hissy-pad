// A new item, on Sort's card without the swipe: the + beside Search opens it. The line is
// typed at the top, the pad or sub-pad it goes to is picked beside the count's old place,
// the clock puts it in an hour, and the pad icon goes to it in its pad. Under the line the
// sub items are the pad itself, zoomed into the new line (state/create.ts): the same rows,
// keys and toolbar as anywhere else. Return in the line, Add or Escape keeps it; Cancel
// takes it all back, and so does a line left without a word.
import { useEffect, useMemo, useRef, useState } from 'react'
import { isLive, slotLabel, todayKey, type Place } from '@hissypad/core'
import {
  cmdAppendAtEnd, cmdCreateEnd, cmdCreateItem, cmdCreateMove, cmdCreateOpen, cmdCreateSetText, createDefaultPlace, placeFromKey, placeKey, placeList, usePad,
} from '@hissypad/state'
import { cmdPickCategory, cmdPickSlot } from '@hissypad/state/hours'
import { HoursIcon, LineIcon, PadIcon } from '../app/icons'
import { cmdPickBoomerang, dueWords } from '@hissypad/state'
import { Pad } from '../pad/Pad'
import { BarMenu } from '../pad/SelectionBar'
import { SelectionBar } from '../pad/SelectionBar'
import { AutoText, oneLine } from './Sort'

// `depth` is what cmdCreateBegin returned as the card was asked for. `onOpen` runs after
// the pad icon: the app shows the pad, at the new line.
export function CreateDialog({ depth, onClose, onOpen }: { depth: number; onClose: () => void; onOpen: () => void }) {
  const all = usePad((s) => s.all)
  const hasSubs = usePad((s) => s.zoomId !== null && Object.keys(s.rows).length > 0)
  const [place, setPlace] = useState<Place>(createDefaultPlace)
  // The line's id, in a ref as well as in state: keystrokes can arrive faster than a render,
  // and each one must find the line the first one made instead of making another.
  const [id, setIdState] = useState<string | null>(null)
  const idRef = useRef<string | null>(null)
  const setId = (next: string | null) => {
    idRef.current = next
    setIdState(next)
  }
  const liveId = () => (idRef.current !== null && isLive(usePad.getState().all[idRef.current]) ? idRef.current : null)
  const [draft, setDraft] = useState('')
  const places = useMemo(() => placeList(all), [all])
  const row = id !== null && isLive(all[id]) ? all[id] : null
  const ended = useRef(false)

  // An undo can take the line away again: the card goes back to a blank one.
  useEffect(() => {
    if (id !== null && !row) {
      setId(null)
      setDraft('')
    }
  }, [id, row])

  // The line, made now if it was not yet (the hour or a sub item before a word is typed).
  function ensure(): string {
    const have = liveId()
    if (have) return have
    const made = cmdCreateItem(place, draft)
    setId(made)
    return made
  }

  function finish(keep: boolean) {
    if (ended.current) return
    ended.current = true
    cmdCreateEnd(depth, liveId(), keep)
    onClose()
  }

  function seeInPad() {
    if (ended.current || !row) return
    ended.current = true
    if (cmdCreateOpen(depth, row.id)) onOpen()
    else onClose()
  }

  function onText(value: string) {
    const text = oneLine(value)
    const have = liveId()
    if (have) cmdCreateSetText(have, text)
    else if (text.trim() === '') setDraft(text)
    else setId(cmdCreateItem(place, text))
  }

  function pickPlace(key: string) {
    const next = placeFromKey(all, key)
    if (!next) return
    setPlace(next)
    if (row) cmdCreateMove(row.id, next)
    // Back to the line: the pad is picked on the way to typing it, or after.
    document.querySelector<HTMLTextAreaElement>('dialog.create .sort-text')?.focus()
  }

  const text = row ? row.text : draft
  const slot = row?.slot ?? null
  const due = row?.due ?? null
  const can = text.trim() !== '' || hasSubs

  return (
    <dialog
      className="create"
      aria-label="New item"
      ref={(d) => {
        if (!d || d.open) return
        d.showModal()
        // showModal puts focus on the first button; the line is what is typed first.
        d.querySelector<HTMLTextAreaElement>('.sort-text')?.focus()
      }}
      onClose={() => finish(true)}
    >
      <div className="create-head">
        <button type="button" onClick={() => finish(false)} title="Take it back: nothing is added">Cancel</button>
        <h2>New item</h2>
        <button type="button" className="primary" onClick={() => finish(true)} disabled={!can}>Add</button>
      </div>
      <article className="sort-card create-card">
        <div className="sort-top">
          <label className="create-place">
            <span>In</span>
            <select className="sort-pad" value={placeKey(place)} onChange={(e) => pickPlace(e.target.value)} aria-label="Where the new item goes">
              {places.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          {slot && <span className="slot" title="The hour this line is in">{slotLabel(slot, todayKey())}</span>}
          {due && <span className="slot" title="Out on a boomerang until this day">Out until {dueWords(due)}</span>}
          <button type="button" className="sort-hour" onClick={() => cmdPickSlot([ensure()])} title="Put in an hour" aria-label={slot ? `Hour: ${slotLabel(slot, todayKey())}, change` : 'Put in an hour'}><HoursIcon /></button>
          {/* The floating buttons' order: hour, category, boomerang, move; the pad icon last. */}
          <button type="button" className="sort-hour" onClick={() => cmdPickCategory([ensure()])} title="Give a category" aria-label="Give a category"><LineIcon icon="category" /></button>
          {/* Out until a later day from the start: the card stays up, the line is under Later. */}
          <button type="button" className="sort-hour" onClick={() => cmdPickBoomerang([ensure()])} title="Boomerang: out of the pads until a later day" aria-label={due ? `Out until ${dueWords(due)}, change` : 'Boomerang: send out until a later day'}><LineIcon icon="boomerang" /></button>
          {/* The same choice as "In" at the left, where the pad's own buttons have it. */}
          <BarMenu className="fab-menu" buttonClass="sort-hour" name="Move to…" title="Move to another pad or a sub-pad" menuLabel="Move to pad" below items={places.map((p) => ({ key: p.key, label: p.label, className: p.subId ? 'sub' : undefined, run: () => pickPlace(p.key) }))}>
            <LineIcon icon="move" />
          </BarMenu>
          <button type="button" className="sort-hour" onClick={seeInPad} disabled={!row || !can} title="Add it and see it in its pad" aria-label="See it in the pad"><PadIcon /></button>
        </div>
        <AutoText
          className="sort-text"
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (can) finish(true)
            } else if (e.key === 'Escape' && text !== '') {
              // Escape with words typed only leaves the field; the next one closes the card.
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          aria-label="Line text"
          placeholder="A new line"
        />
        <div className="create-subs">
          {row && <Pad embedded />}
          <button type="button" className="create-add" onClick={() => { ensure(); cmdAppendAtEnd() }}>Add a sub item</button>
        </div>
      </article>
      <SelectionBar />
    </dialog>
  )
}
