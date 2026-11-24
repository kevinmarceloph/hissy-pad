// Sort: the pad's top-level lines one card at a time. Swipe (or arrow keys, or the buttons)
// left for Later (or the pad picked below: picking one sends the card there too), right
// for Today, up for Today and crossed out, down to cycle it: to the bottom of the pad, to
// come round again. Skip leaves a card; Archive deletes it. The card is live: its
// text and sub items edit the real rows, so a line can be fixed up before it goes. Every
// send is one undo step; Back takes the last card back. The pad icon on the card leaves Sort
// for the pad, scrolled so the line is at the top.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react'
import { buildIndex, flatten, slotLabel, todayKey } from '@hissypad/core'
import { cmdPickSlot } from '@hissypad/state/hours'
import { HoursIcon, PadIcon } from '../app/icons'
import {
  cmdOpenHit, cmdSortAddSub, cmdSortRemoveSub, cmdSortSetText, loadSortTargets, openPad, padList, padName, placeList, setSortTarget, sortSessionBack, sortSessionCard, sortSessionProgress,
  sortSessionSend, sortSessionSendLeftTo, sortSessionSendLeftToNew, sortSessionStart, sortSummary, sortTarget, swipeDir, SWIPE_DISTANCE, usePad, useSort, type SortChoice, type SortDir,
} from '@hissypad/state'

const SWIPE = SWIPE_DISTANCE // px of travel that commits a swipe
const SLOP = 8   // px before a press becomes a drag

interface Ghost { key: number; text: string; dir: SortDir; dx: number; dy: number }

// A card's fields are one line each: the textarea only wraps. Return closes the field and a
// pasted line break becomes a space.
export const oneLine = (t: string) => t.replace(/\r?\n/g, ' ')

// A textarea as tall as its text, snapped to whole lines (a line is 25.5px, see CLAUDE.md).
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

export function Sort({ onClose }: { onClose: () => void }) {
  const rows = usePad((s) => s.rows)
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const choice = useSort()
  const pads = useMemo(() => padList(all), [all])
  const [session, setSession] = useState(() => sortSessionStart())
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [draft, setDraft] = useState('')
  const [naming, setNaming] = useState<string | null>(null)
  const press = useRef<{ x: number; y: number; pointer: number; inFocusedField: boolean; dragging: boolean } | null>(null)
  const addRef = useRef<HTMLInputElement>(null)

  useEffect(() => { void loadSortTargets() }, [])

  const { queue, sent } = session
  const { id } = sortSessionCard(session, rows)
  const row = id ? rows[id]! : null
  const subs = useMemo(() => (id ? flatten(buildIndex(rows), false, id) : []), [rows, id])
  const left = sortTarget(all, 'left', choice.left)
  const right = sortTarget(all, 'right')
  const progress = sortSessionProgress(session, rows)

  // Every way a card leaves goes through here; `next` is what the session becomes.
  function leave(dir: SortDir, next: typeof session, from = { dx: 0, dy: 0 }) {
    if (next === session) return
    if (row) setGhost({ key: Date.now(), text: row.text, dir, ...from })
    setSession(next)
    setDrag(null)
    setDraft('')
  }

  function send(dir: SortDir, from = { dx: 0, dy: 0 }) {
    if (!id || !row) return
    leave(dir, sortSessionSend(session, dir), from)
  }

  // Picking a left pad sends the card there; with no card left it only sets the pad.
  function pickLeft(next: SortChoice) {
    if (id) leave('left', sortSessionSendLeftTo(session, next))
    else setSortTarget(next)
  }

  function back() {
    const next = sortSessionBack(session)
    if (next === session) return
    setSession(next)
    setGhost(null)
    setDraft('')
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('dialog')) return // the hour picker has its own keys
      const inField = !!t?.closest?.('textarea, input, select')
      if (e.key === 'Escape') {
        if (inField) t!.blur()
        else onClose()
        return
      }
      if (inField || e.altKey) return
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

  // ---- the card's fields -------------------------------------------------------------

  function addSub() {
    if (!id) return
    if (cmdSortAddSub(id, draft)) setDraft('')
  }

  function onSubKey(e: ReactKeyboardEvent<HTMLTextAreaElement>, subId: string) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addRef.current?.focus()
    } else if (e.key === 'Backspace' && e.currentTarget.value === '') {
      e.preventDefault()
      cmdSortRemoveSub(subId)
      addRef.current?.focus()
    }
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
    if (naming === null || !naming.trim()) return
    if (id) leave('left', sortSessionSendLeftToNew(session, naming))
    else sortSessionSendLeftToNew(session, naming)
    setNaming(null)
  }

  // The left side's pad. Right is always Today. Choosing here sends the card on screen.
  function targetSelect() {
    const def = sortTarget(all, 'left', null)
    // Every pad and sub-pad ("Pad → Sub-pad"), without the default pad, which has its own entry.
    const places = placeList(all).filter((p) => p.key !== 'main' && !(p.subId === null && p.padId === def.padId && def.exists))
    const label = id ? '← Send left to' : '← Left goes to'
    if (naming !== null) {
      return (
        <form className="sort-target" onSubmit={(e) => { e.preventDefault(); createTarget() }}>
          <span>{label}</span>
          <input
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null) } }}
            placeholder="Name the new pad"
            aria-label="Name for the new pad"
          />
          <button type="submit" disabled={!naming.trim()}>Create</button>
          <button type="button" onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )
    }
    return (
      <label className="sort-target">
        <span>{label}</span>
        <select
          value={choice.left === 'main' ? 'main' : left.isDefault ? '' : (left.subId ?? left.padId ?? '')}
          onChange={(e) => {
            const v = e.target.value
            if (v === '__new') setNaming('')
            else pickLeft(v === '' ? null : v)
            e.target.blur()
          }}
          aria-label="Pad for a left swipe"
          title={id ? 'Picking a pad also sends this card there' : undefined}
        >
          <option value="">{def.exists ? def.name : `${def.name} (new pad)`}</option>
          <option value="main">{padName(all, null)}</option>
          {places.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="__new">New pad…</option>
        </select>
      </label>
    )
  }

  return (
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
              {pads.map((p) => <option key={p.id ?? ''} value={p.id ?? ''}>{p.name} ({p.count})</option>)}
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
              <button type="button" className="sort-hour" onClick={() => { if (cmdOpenHit(id)) onClose() }} title="See it in the pad" aria-label="See it in the pad"><PadIcon /></button>
            </div>
            <AutoText
              className="sort-text"
              value={row.text}
              onChange={(e) => cmdSortSetText(id, oneLine(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
              aria-label="Line text"
              placeholder="Empty line"
            />
            <ul className="sort-subs" aria-label="Sub items">
              {subs.map((s) => {
                const sub = rows[s.id]!
                return (
                  <li key={s.id} style={{ '--depth': s.depth } as CSSProperties} className={sub.done ? 'is-done' : undefined}>
                    <AutoText
                      value={sub.text}
                      onChange={(e) => cmdSortSetText(s.id, oneLine(e.target.value))}
                      onKeyDown={(e) => onSubKey(e, s.id)}
                      aria-label="Sub item"
                    />
                  </li>
                )
              })}
              <li className="add">
                <input
                  ref={addRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub() } }}
                  onBlur={addSub}
                  placeholder="Add a sub item"
                  aria-label="Add a sub item"
                  enterKeyHint="done"
                />
              </li>
            </ul>
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

      <div className="sort-actions">
        <button type="button" onClick={() => send('left')} disabled={!id} aria-label={`Left: ${left.name}`}><kbd>←</kbd> {left.name}</button>
        <button type="button" onClick={() => send('up')} disabled={!id} aria-label={`Up: ${upLabel}`}><kbd>↑</kbd> Done</button>
        <button type="button" onClick={() => send('right')} disabled={!id} aria-label={`Right: ${right.name}`}>{right.name} <kbd>→</kbd></button>
      </div>
      <div className="sort-actions sort-down">
        <button type="button" onClick={() => send('cycle')} disabled={!id} aria-label="Down: cycle" title="Move it to the bottom of the pad and see it again at the end"><kbd>↓</kbd> Cycle</button>
      </div>
      <div className="sort-minor">
        <button type="button" onClick={back} disabled={sent.length === 0}>Back</button>
        <button type="button" onClick={() => send('skip')} disabled={!id}>Skip <kbd>S</kbd></button>
        <button type="button" onClick={() => send('archive')} disabled={!id} title="Delete it: the Archive keeps it">Archive <kbd>A</kbd></button>
      </div>
      <div className="sort-targets">
        {targetSelect()}
      </div>
    </section>
  )
}
