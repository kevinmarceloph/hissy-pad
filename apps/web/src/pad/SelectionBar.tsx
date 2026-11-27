import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CatMark } from './CatMark'
import { createPortal } from 'react-dom'
import { kindOf, sharedState, type LineState } from '@hissypad/core'
import {
  actionFace, clearSelection, cmdMoveTo, cmdSetState, countOf, cmdSetKind, lineAbilities, lineActions, lineCount, placeList, stopEditing, usePad, type PlaceItem,
  LINE_ACTIONS, LINE_KINDS, type LineAction, type LineActionGroup,
} from '@hissypad/state'
import { showToast } from '../app/toast'
import { LineIcon } from '../app/icons'
import { MOD, shortcut } from '../platform/os'

const FLOATING = LINE_ACTIONS.filter((a) => a.floats && a.icon)
const SIDES: LineState[] = ['open', 'doing', 'done']
const STATE_NAME: Record<LineState, string> = { open: 'Open', doing: 'Doing', done: 'Done' }
const GLYPH: Record<LineState, string> = { open: '•', doing: '', done: '×' }

// A rule is drawn before the first button of these groups.
const RULE_BEFORE: ReadonlySet<LineActionGroup> = new Set(['add', 'move', 'tree', 'clip', 'pad', 'remove'])

interface MenuItem {
  key: string
  label: string
  title?: string | undefined
  className?: string | undefined
  disabled?: boolean
  category?: string | null | undefined // a pad's or sub-pad's category, drawn before the label
  run: () => void
}

// A button of the bar that opens a small menu above itself. The menu is drawn outside the
// bar (a portal on <body>): the bar scrolls sideways on a desktop too narrow for it, and a
// scrolling box clips anything positioned inside it (or on the dialog the bar is in). It sits above the button, kept inside
// the window, and follows the button if the bar scrolls or the window resizes. `below`: the
// menu opens under the button instead (a card's Move to…, near the top of the page).
export function BarMenu({ name, title, menuLabel, className, buttonClass, items, children, below = false, disabled = false }: { name: string; title: string; menuLabel: string; className: string; buttonClass?: string; items: MenuItem[]; children: ReactNode; below?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; bottom?: number; top?: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const place = () => {
      const r = button.current?.getBoundingClientRect()
      if (!r) return
      const half = 96 // half the menu's widest (16rem is the cap; most are narrower)
      const left = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8)
      setAt(below ? { left, top: r.bottom + 8 } : { left, bottom: window.innerHeight - r.top + 8 })
    }
    place()
    const bar = button.current?.closest('.selbar')
    bar?.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      bar?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [open, below])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      const t = e.target as Node
      if (!button.current?.contains(t) && !menu.current?.contains(t)) setOpen(false)
    }
    // Escape closes the menu and stops there: the selection stays as it was.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault() // a dialog the bar is in (the new item's card) stays open
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <span className={className}>
      <button ref={button} type="button" className={buttonClass} onClick={() => setOpen((m) => !m)} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label={name} title={title}>{children}</button>
      {open && at && createPortal(
        <div ref={menu} className="bar moveto-menu" role="menu" aria-label={menuLabel} style={at.top !== undefined ? { left: at.left, top: at.top, bottom: 'auto' } : { left: at.left, bottom: at.bottom }} onMouseDown={(e) => e.preventDefault()}>
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" className={it.className} title={it.title ?? it.label} disabled={it.disabled} onClick={() => { setOpen(false); it.run() }}><CatMark id={it.category} />{it.label}</button>
          ))}
        </div>,
        // Inside a modal dialog (the new item's card) the page behind is inert and under it.
        button.current?.closest('dialog') ?? document.body,
      )}
    </span>
  )
}

// Shows while a line is being edited or lines are selected. Same actions as the keyboard,
// for the mouse and the phone. The buttons come from LINE_ACTIONS in the state package
// (shared with the phone's toolbar); the line type switcher and the dropdown of the less
// used actions are drawn here. Mousedown is swallowed so a tap never
// blurs the textarea.
//
// Above its right end float round buttons (.fab), as in the phone app: Hour… and Category…
// (the actions marked `floats`), the "Move to…" menu, the open / doing / done switch and "done editing". On a
// phone-width screen the bar is the phone app's toolbar: two rows that do not scroll.
export function SelectionBar() {
  const selection = usePad((s) => s.selection)
  const editing = usePad((s) => s.editing)
  const rows = usePad((s) => s.rows)
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const inHour = usePad((s) => s.slotId !== null)
  // Everywhere the lines can go: the other pads, and every sub-pad (this pad's included).
  // In an open hour, every pad: its lines come from any of them.
  const places = useMemo(() => placeList(all).filter((p) => inHour || p.subId !== null || p.padId !== padId), [all, padId, inHour])
  const ids = selection.length > 0 ? selection : editing ? [editing.id] : []
  const can = useMemo(() => lineAbilities(rows, ids), [rows, ids])
  const ref = useRef<HTMLDivElement>(null)
  const visible = ids.length > 0

  // A fixed element sits at the bottom of the layout viewport, which the on-screen keyboard
  // covers rather than shrinks (iOS Safari). Measure the visual viewport and lift the bar by
  // whatever the keyboard hides, so it stays in view while typing.
  useEffect(() => {
    const vv = window.visualViewport
    const el = ref.current
    if (!vv || !el || !visible) return
    const place = () => {
      const hidden = window.innerHeight - (vv.height + vv.offsetTop)
      el.style.setProperty('--kb', `${Math.max(0, Math.round(hidden))}px`)
    }
    place()
    vv.addEventListener('resize', place)
    vv.addEventListener('scroll', place)
    return () => {
      vv.removeEventListener('resize', place)
      vv.removeEventListener('scroll', place)
    }
  }, [visible])

  if (!visible) return null
  const n = selection.length
  function moveTo(place: PlaceItem) {
    const moved = cmdMoveTo(place)
    if (moved) showToast(`Moved ${lineCount(moved)} to “${place.label}”.`)
  }
  // What an action says back: a plain line (Paste could not read the clipboard) is shown as
  // it is; anything that changed the pad also says how to undo it.
  function run(a: LineAction) {
    const say = (said: string | void) => {
      if (said) showToast(a.group === 'clip' ? said : `${said} ${MOD}+Z undoes it.`)
    }
    const said = a.run()
    if (said instanceof Promise) void said.then(say)
    else say(said)
  }
  // Mixed selections show the first line's type; a tap sets them all.
  const first = rows[ids[0]!]
  const current = first ? kindOf(first) : 'plain'
  const counted = countOf(selection, rows)
  // Nothing counted: blank lines, or section dividers (which are not items either).
  const dividers = n > 0 && selection.every((id) => rows[id]?.divider)
  const label = n === 0 ? 'Editing' : counted > 0 ? lineCount(counted) : dividers ? (n === 1 ? 'Divider' : 'Dividers') : n === 1 ? 'Blank line' : 'Blank lines'
  const state = sharedState(rows, ids)
  const close = () => {
    if (n > 0) clearSelection()
    else {
      stopEditing()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    }
  }
  const kinds = (
    <span className="kind" role="group" aria-label="Line type">
      {LINE_KINDS.map((k) => (
        <button key={k.kind} type="button" onClick={() => cmdSetKind(k.kind)} aria-pressed={current === k.kind} aria-label={k.name} title={k.keys ? `${k.hint} (${shortcut(k.keys)})` : k.hint}>{k.glyph}</button>
      ))}
    </span>
  )
  const offered = lineActions(can)
  const shown = offered.filter((a) => !a.more && !a.floats)
  const tucked = offered.filter((a) => a.more)
  const menus = (
    <>
      <BarMenu
        className="moveto"
        name="More actions"
        title={`More: ${tucked.map((a) => a.label.replace('…', '')).join(', ')}`}
        menuLabel="More actions"
        items={tucked.map((a) => ({ key: a.id, label: actionFace(a, can).label, title: actionFace(a, can).hint, disabled: a.enabled ? !a.enabled(can) : false, run: () => run(a) }))}
      >
        <LineIcon icon="more" />
      </BarMenu>
    </>
  )
  return (
    // The floating buttons and the bar move together (lifted over the on-screen keyboard as
    // one). Mousedown is swallowed on both so a tap never blurs the textarea.
    <div ref={ref} className="selwrap" onMouseDown={(e) => e.preventDefault()}>
      <div className="fab">
        {FLOATING.map((a) => (
          <button key={a.id} type="button" className="round" onClick={() => run(a)} aria-label={a.name} title={a.hint}>
            <LineIcon icon={a.icon!} />
          </button>
        ))}
        {/* Move to…: beside Hour… and Category…, its list opening above the buttons. */}
        {places.length > 0 && (
          <BarMenu
            className="fab-menu"
            buttonClass="round"
            name="Move to…"
            title="Move to another pad or a sub-pad"
            menuLabel="Move to pad"
            items={places.map((p) => ({ key: p.key, label: p.label, category: p.category, className: p.subId ? 'sub' : undefined, run: () => moveTo(p) }))}
          >
            <LineIcon icon="move" />
          </BarMenu>
        )}
        {/* Three sides, each its own button: • (open), a dot in a ring (doing), × (crossed
            out). The side the lines are on is filled; none for a mixed set. */}
        <div className="switch" role="radiogroup" aria-label="Line state">
          {SIDES.map((side) => (
            <button
              key={side}
              type="button"
              role="radio"
              aria-checked={side === state}
              aria-label={STATE_NAME[side]}
              title={side === 'done' ? `Done (${shortcut('⌘Enter')})` : STATE_NAME[side]}
              className={side === state ? `s-${side} on` : `s-${side}`}
              onClick={() => cmdSetState(side)}
            >
              {GLYPH[side]}
            </button>
          ))}
        </div>
        <button type="button" className="round" onClick={close} aria-label={n > 0 ? 'Clear selection' : 'Done editing'} title={n > 0 ? 'Clear selection (Esc)' : 'Done editing (Esc)'}>
          <span className="chevron" aria-hidden="true" />
        </button>
      </div>
      <div className="bar selbar" role="toolbar" aria-label={n > 0 ? 'Selected lines' : 'Current line'}>
        <span className="count">{label}</span>
        {shown.map((a, i) => {
          const prev = shown[i - 1]?.group
          const opens = prev !== a.group
          const face = actionFace(a, can)
          return (
            <Fragment key={a.id}>
              {/* The line type switcher leads the bar (Done, before it, floats now). */}
              {i === 0 && kinds}
              {opens && RULE_BEFORE.has(a.group) && <span className="sep" aria-hidden="true" />}
              {/* The second row of the phone-width bar starts after the arrows. */}
              {opens && prev === 'move' && <span className="brk" aria-hidden="true" />}
              {opens && a.group === 'remove' && menus}
              <button
                type="button"
                className={`g-${a.group}${a.danger ? ' danger' : ''}`}
                onClick={() => run(a)}
                disabled={a.enabled ? !a.enabled(can) : false}
                title={a.keys ? `${face.hint} (${shortcut(a.keys)})` : face.hint}
                aria-label={face.icon || face.name !== face.label ? face.name : undefined}
              >
                {face.icon ? <LineIcon icon={face.icon} /> : face.label}
              </button>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
