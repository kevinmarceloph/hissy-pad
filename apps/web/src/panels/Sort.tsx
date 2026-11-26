// Sort: the pad's top-level lines one card at a time. Swipe (or arrow keys, or the buttons)
// left for Later, right for Today (or the pad picked behind the cog beside each button:
// picking one sends the card there too), up for that right-hand pad crossed out, down to cycle it: to the bottom of the pad, to
// come round again. Skip leaves a card; Archive deletes it. The card is live: its
// text edits the real row, and its sub items are the pad itself, zoomed into the card's
// line (the store's zoom): the same rows, keys and toolbar as in the pad. Every
// send is one undo step; Back takes the last card back. The pad icon on the card leaves Sort
// for the pad, scrolled so the line is at the top.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { scopePad, slotLabel, todayKey } from '@hissypad/core'
import { categoryPrefix, cmdPickCategory, cmdPickSlot, useLineCategory } from '@hissypad/state/hours'
import { GearIcon, HoursIcon, LineIcon, PadIcon } from '../app/icons'
import { cmdPickBoomerang, cmdSortMoveTo, dueWords } from '@hissypad/state'
import { showToast } from '../app/toast'
import { MOD } from '../platform/os'
import { Pad } from '../pad/Pad'
import { BarMenu, SelectionBar } from '../pad/SelectionBar'
import {
  cmdAppendAtEnd, cmdOpenHit, cmdSortSetText, loadSortTargets, openPad, padList, padName, placeList, setSortTarget, sortSessionBack, sortSessionCard, sortSessionProgress,
  sortSessionSend, sortSessionSendTo, sortSessionSendToNew, sortSessionStart, sortSummary, sortTarget, swipeDir, SWIPE_DISTANCE, usePad, useSort, zoomTo, type SortChoice, type SortDir, type SortSide,
} from '@hissypad/state'

const SWIPE = SWIPE_DISTANCE // px of travel that commits a swipe
const SLOP = 8   // px before a press becomes a drag

interface Ghost { key: number; text: string; dir: SortDir; dx: number; dy: number }

// A card's fields are one line each: the textarea only wraps. Return closes the field and a
// pasted line break becomes a space.
export const oneLine = (t: string) => t.replace(/\r?\n/g, ' ')

// A textarea as tall as its text, snapped to whole lines (a line is 25.5px, see CLAUDE.md).
// The card's line: its category in front of the text, as on a line of the pad. A press on it
// opens the category picker.
export function CardLine({ category, onCategory, children }: { category: ReturnType<typeof useLineCategory>; onCategory: () => void; children: React.ReactNode }) {
  return (
    <div className="sort-line">
      {category && (
        <button type="button" className={`category cat-${category.color}${category.icon ? '' : ' is-word'}`} title={category.label} aria-label={`Category: ${category.label}, change`} onClick={onCategory}>
          {category.icon || category.label}
        </button>
      )}
      {children}
    </div>
  )
}

export function AutoText(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const ta = ref.current
    if (!ta) return
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(1, Math.round(ta.scrollHeight / lh)) * lh}px`
  })
  return <textarea ref={ref} rows={1} {...props} />
}

// `paused`: something else has the store's zoom (the new item's card is open over Sort), so
// the card draws no sub items and leaves the zoom alone until it is back.
export function Sort({ onClose, paused = false }: { onClose: () => void; paused?: boolean }) {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const zoomId = usePad((s) => s.zoomId)
  // The pad being sorted. The store's own `rows` is what is under the card while it is zoomed into.
  const rows = useMemo(() => scopePad(all, padId), [all, padId])
  const choice = useSort()
  const pads = useMemo(() => padList(all), [all])
  const [session, setSession] = useState(() => sortSessionStart())
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [naming, setNaming] = useState<{ side: SortSide; text: string } | null>(null)
  const press = useRef<{ x: number; y: number; pointer: number; inFocusedField: boolean; dragging: boolean } | null>(null)

  useEffect(() => { void loadSortTargets() }, [])

  const { queue, sent } = session
  const { id } = sortSessionCard(session, rows)
  const row = id ? rows[id]! : null
  const category = useLineCategory(row?.category)

  // The card on screen is zoomed into, so the pad's rows and toolbar edit what is under it.
  // A send or Back leaves the zoom (state/sort.ts); the next card takes it here.
  useEffect(() => {
    if (!paused && id && zoomId !== id) zoomTo(id)
  }, [id, zoomId, paused])
  useEffect(() => () => {
    if (usePad.getState().zoomId !== null) zoomTo(null)
  }, [])
  const left = sortTarget(all, 'left', choice.left)
  const right = sortTarget(all, 'right', choice.right)
  const progress = sortSessionProgress(session, rows)

  // Every way a card leaves goes through here; `next` is what the session becomes.
  function leave(dir: SortDir, next: typeof session, from = { dx: 0, dy: 0 }) {
    if (next === session) return
    if (row) setGhost({ key: Date.now(), text: row.text, dir, ...from })
    setSession(next)
    setDrag(null)
  }

  function send(dir: SortDir, from = { dx: 0, dy: 0 }) {
    if (!id || !row) return
    leave(dir, sortSessionSend(session, dir), from)
  }

  // Picking a side's pad sends the card there; with no card left it only sets the pad.
  function pick(side: SortSide, next: SortChoice) {
    if (id) leave(side, sortSessionSendTo(session, side, next))
    else setSortTarget(next, side)
  }

  function back() {
    const next = sortSessionBack(session)
    if (next === session) return
    setSession(next)
    setGhost(null)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('dialog')) return // the hour picker has its own keys
      // The card's sub items are the pad's rows: a key they took (Escape out of a selection,
      // the arrows through one) is not a key for the cards.
      if (e.defaultPrevented) return
      const inField = !!t?.closest?.('textarea, input, select')
      if (e.key === 'Escape') {
        if (inField) t!.blur()
        else onClose()
        return
      }
      if (inField || e.altKey || usePad.getState().selection.length > 0) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); back(); return }
      if (e.metaKey || e.ctrlKey) return
      const dir: SortDir | null = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' || e.key.toLowerCase() === 'c' ? 'cycle' : e.key.toLowerCase() === 's' ? 'skip' : e.key.toLowerCase() === 'a' ? 'archive' : null
      if (dir) { e.preventDefault(); send(dir) }
      else if (e.key === 'Backspace') { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- the swipe -------------------------------------------------------------------

  function onPointerDown(e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('button, select')) return
    // A press inside the field being typed in is text selection, not a swipe.
    const inFocusedField = !!t.closest('textarea, input') && document.activeElement === t
    press.current = { x: e.clientX, y: e.clientY, pointer: e.pointerId, inFocusedField, dragging: false }
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const p = press.current
    if (!p || p.pointer !== e.pointerId || p.inFocusedField) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < SLOP) return
      p.dragging = true
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      window.getSelection()?.removeAllRanges()
    }
    setDrag({ dx, dy })
  }

  function onPointerUp(e: PointerEvent<HTMLElement>) {
    const p = press.current
    press.current = null
    if (!p || !p.dragging) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    const dir = swipeDir(dx, dy)
    if (dir) send(dir, { dx, dy })
    else setDrag(null)
  }

  function onPointerCancel() {
    press.current = null
    setDrag(null)
  }

  const leaning = drag ? swipeDir(drag.dx, drag.dy) : null
  const pull = (dir: SortDir) => {
    if (!drag) return 0
    const vy = dir === 'up' ? -drag.dy : drag.dy
    const v = dir === 'left' ? -drag.dx : dir === 'right' ? drag.dx : vy > Math.abs(drag.dx) ? vy : 0
    return Math.max(0, Math.min(1, v / SWIPE))
  }
  const cardStyle: CSSProperties | undefined = drag
    ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${(drag.dx * 0.04).toFixed(2)}deg)`, transition: 'none' }
    : undefined
  const upLabel = `${right.name}, done`

  function createTarget() {
    if (naming === null || !naming.text.trim()) return
    if (id) leave(naming.side, sortSessionSendToNew(session, naming.side, naming.text))
    else sortSessionSendToNew(session, naming.side, naming.text)
    setNaming(null)
  }

  // A side's pad, behind the cog beside its button. Choosing one sends the card on screen.
  function gear(side: SortSide) {
    const target = side === 'left' ? left : right
    const def = sortTarget(all, side, null)
    // Every pad and sub-pad ("Pad → Sub-pad"), without the default pad, which has its own entry.
    const places = placeList(all).filter((p) => p.key !== 'main' && !(p.subId === null && p.padId === def.padId && def.exists))
    const name = side === 'left' ? 'Pad for a left swipe' : 'Pad for a right or up swipe'
    return (
      <label className="sort-gear" title={id ? `${side === 'left' ? 'Left' : 'Right'} goes to ${target.name}. Picking a pad also sends this card there` : `${side === 'left' ? 'Left' : 'Right'} goes to ${target.name}`}>
        <GearIcon />
        <select
          value={choice[side] === 'main' ? 'main' : target.isDefault ? '' : (target.subId ?? target.padId ?? '')}
          onChange={(e) => {
            const v = e.target.value
            if (v === '__new') setNaming({ side, text: '' })
            else pick(side, v === '' ? null : v)
            e.target.blur()
          }}
          aria-label={name}
        >
          <option value="">{def.exists ? def.name : `${def.name} (new pad)`}</option>
          <option value="main">{padName(all, null)}</option>
          {places.map((p) => <option key={p.key} value={p.key}>{categoryPrefix(p.category)}{p.label}</option>)}
          <option value="__new">New pad…</option>
        </select>
      </label>
    )
  }

  function namingForm() {
    if (naming === null) return null
    return (
      <form className="sort-target" onSubmit={(e) => { e.preventDefault(); createTarget() }}>
        <span>{naming.side === 'left' ? (id ? '← Send left to' : '← Left goes to') : (id ? 'Send right to →' : 'Right goes to →')}</span>
        <input
          autoFocus
          value={naming.text}
          onChange={(e) => setNaming({ ...naming, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null) } }}
          placeholder="Name the new pad"
          aria-label="Name for the new pad"
        />
        <button type="submit" disabled={!naming.text.trim()}>Create</button>
        <button type="button" onClick={() => setNaming(null)}>Cancel</button>
      </form>
    )
  }

  return (
    <>
    <section className="sort" aria-labelledby="sort-title">
      <header className="sort-head">
        <div>
          {/* No pad tabs in Sort: the pad to sort is picked here, in the title. */}
          <h2 id="sort-title">
            Sort{' '}
            <select
              className="sort-pad"
              value={padId ?? ''}
              onChange={(e) => { openPad(e.target.value === '' ? null : e.target.value); e.target.blur() }}
              aria-label="Pad to sort"
            >
              {/* Each pad with its open top-level lines: the cards Sort would deal. */}
              {pads.map((p) => <option key={p.id ?? ''} value={p.id ?? ''}>{categoryPrefix(p.category)}{p.name} ({p.count})</option>)}
              {!pads.some((p) => p.id === padId) && <option value={padId ?? ''}>{padName(all, padId)}</option>}
            </select>
          </h2>
          <p>{id ? `${progress.left} to go. Swipe the card, or use the arrow keys.` : 'One line at a time: later, today, already done, or round again.'}</p>
        </div>
      </header>

      <div className="sort-stage">
        {ghost && (
          <div
            key={ghost.key}
            className={`sort-card is-ghost to-${ghost.dir}`}
            style={{ '--dx': `${ghost.dx}px`, '--dy': `${ghost.dy}px` } as CSSProperties}
            aria-hidden="true"
            onAnimationEnd={() => setGhost(null)}
          >
            <div className="sort-text">{ghost.text}</div>
          </div>
        )}
        {id && row ? (
          <article
            key={id}
            className={['sort-card', drag && 'is-dragging', leaning && `leans-${leaning}`].filter(Boolean).join(' ')}
            style={cardStyle}
            aria-label={`Card ${progress.at} of ${progress.total}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            <span className="stamp stamp-left" style={{ opacity: pull('left') }} aria-hidden="true">{left.name}</span>
            <span className="stamp stamp-right" style={{ opacity: pull('right') }} aria-hidden="true">{right.name}</span>
            <span className="stamp stamp-up" style={{ opacity: pull('up') }} aria-hidden="true">Done</span>
            <span className="stamp stamp-down" style={{ opacity: pull('cycle') }} aria-hidden="true">Cycle</span>
            <div className="sort-top">
              <p className="sort-count">{progress.at} of {progress.total}</p>
              {row.slot && <span className="slot" title="The hour this line is in">{slotLabel(row.slot, todayKey())}</span>}
              <button type="button" className="sort-hour" onClick={() => cmdPickSlot([id])} title="Put in an hour" aria-label={row.slot ? `Hour: ${slotLabel(row.slot, todayKey())}, change` : 'Put in an hour'}><HoursIcon /></button>
              {/* The floating buttons' order: hour, category, boomerang, move; the pad icon last. */}
              <button type="button" className="sort-hour" onClick={() => cmdPickCategory([id])} title="Give a category" aria-label="Give a category"><LineIcon icon="category" /></button>
              {/* Out of the pads until a later day: the card moves on, the line is under Later. */}
              <button type="button" className="sort-hour" onClick={() => cmdPickBoomerang([id])} title="Boomerang: out of the pads until a later day" aria-label={row.due ? `Out until ${dueWords(row.due)}, change` : 'Boomerang: send out until a later day'}><LineIcon icon="boomerang" /></button>
              {/* Any pad or sub-pad, beside what the swipes offer: the card moves on. */}
              <BarMenu className="fab-menu" buttonClass="sort-hour" name="Move to…" title="Move to another pad or a sub-pad" menuLabel="Move to pad" below items={placeList(all).filter((p) => p.subId !== null || p.padId !== padId).map((p) => ({ key: p.key, label: p.label, category: p.category, className: p.subId ? 'sub' : undefined, run: () => { if (cmdSortMoveTo(id, p)) showToast(`Moved to “${p.label}”. ${MOD}+Z undoes it.`) } }))}>
                <LineIcon icon="move" />
              </BarMenu>
              <button type="button" className="sort-hour" onClick={() => { if (cmdOpenHit(id)) onClose() }} title="See it in the pad" aria-label="See it in the pad"><PadIcon /></button>
            </div>
            <CardLine category={category} onCategory={() => cmdPickCategory([id])}>
              <AutoText
                className="sort-text"
                value={row.text}
                onChange={(e) => cmdSortSetText(id, oneLine(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
                aria-label="Line text"
                placeholder="Empty line"
              />
            </CardLine>
            <div className="create-subs">
              {!paused && zoomId === id && <Pad embedded undo={false} />}
              <button type="button" className="create-add" onClick={() => { if (usePad.getState().zoomId !== id) zoomTo(id); cmdAppendAtEnd() }}>Add a sub item</button>
            </div>
          </article>
        ) : (
          <div className="sort-empty" role="status">
            {queue.length === 0 ? (
              <p>Nothing to sort in this pad.</p>
            ) : (
              <>
                <p>All sorted.</p>
                <p className="tally">{sortSummary(session)}</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Left and right are tall, with up over down between them; each side's cog picks its pad. */}
      <div className="sort-actions">
        {gear('left')}
        <button type="button" className="sort-side" onClick={() => send('left')} disabled={!id} aria-label={`Left: ${left.name}`}><kbd>←</kbd> {left.name}</button>
        <div className="sort-updown">
          <button type="button" onClick={() => send('up')} disabled={!id} aria-label={`Up: ${upLabel}`}><kbd>↑</kbd> Done</button>
          <button type="button" onClick={() => send('cycle')} disabled={!id} aria-label="Down: cycle" title="Move it to the bottom of the pad and see it again at the end"><kbd>↓</kbd> Cycle</button>
        </div>
        <button type="button" className="sort-side" onClick={() => send('right')} disabled={!id} aria-label={`Right: ${right.name}`}>{right.name} <kbd>→</kbd></button>
        {gear('right')}
      </div>
      <div className="sort-minor">
        <button type="button" onClick={back} disabled={sent.length === 0}>Back</button>
        <button type="button" onClick={() => send('skip')} disabled={!id}>Skip <kbd>S</kbd></button>
        <button type="button" onClick={() => send('archive')} disabled={!id} title="Delete it: the Archive keeps it">Archive <kbd>A</kbd></button>
      </div>
      {naming && <div className="sort-targets">{namingForm()}</div>}
    </section>
    {/* The pad's toolbar, for the sub item being typed or the ones selected. */}
    {!paused && <SelectionBar />}
    </>
  )
}
