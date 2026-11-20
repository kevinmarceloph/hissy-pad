import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { kindOf } from '@hissypad/core'
import {
  clearSelection, cmdMoveTo, countOf, cmdSetKind, lineAbilities, lineCount, placeList, stopEditing, usePad, type PlaceItem,
  LINE_ACTIONS, LINE_KINDS, type LineAction, type LineActionGroup,
} from '@hissypad/state'
import { showToast } from '../app/toast'
import { MOD, shortcut } from '../platform/os'

// A rule is drawn before the first button of these groups.
const RULE_BEFORE: ReadonlySet<LineActionGroup> = new Set(['add', 'move', 'tree'])

// Shows while a line is being edited or lines are selected. Same actions as the keyboard,
// for the mouse and the phone. The buttons come from LINE_ACTIONS in the state package
// (shared with the phone's toolbar); the line type switcher and the "Move to…" menu are
// drawn here. Mousedown is swallowed so a tap never blurs the textarea.
export function SelectionBar() {
  const selection = usePad((s) => s.selection)
  const editing = usePad((s) => s.editing)
  const rows = usePad((s) => s.rows)
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  // Everywhere the lines can go: the other pads, and every sub-pad (this pad's included).
  const places = useMemo(() => placeList(all).filter((p) => p.subId !== null || p.padId !== padId), [all, padId])
  const [menu, setMenu] = useState(false)
  const moveBtn = useRef<HTMLButtonElement>(null)
  const [menuAt, setMenuAt] = useState<{ left: number; bottom: number } | null>(null)
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

  // The menu is drawn outside the bar (a portal on <body>): the bar scrolls sideways, and
  // a scrolling box clips anything positioned inside it. It sits above the button, kept
  // inside the window, and follows the button if the bar scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!menu) {
      setMenuAt(null)
      return
    }
    const place = () => {
      const r = moveBtn.current?.getBoundingClientRect()
      if (!r) return
      const half = 96 // half the menu's widest (16rem is the cap; most are narrower)
      const left = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8)
      setMenuAt({ left, bottom: window.innerHeight - r.top + 8 })
    }
    place()
    const bar = ref.current
    bar?.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      bar?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.('.moveto, .moveto-menu')) setMenu(false)
    }
    // Escape closes the menu and stops there: the selection stays as it was.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setMenu(false)
    }
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

  if (!visible) return null
  const n = selection.length
  function moveTo(place: PlaceItem) {
    setMenu(false)
    const moved = cmdMoveTo(place)
    if (moved) showToast(`Moved ${lineCount(moved)} to “${place.label}”.`)
  }
  function run(a: LineAction) {
    const said = a.run()
    if (said) showToast(`${said} ${MOD}+Z undoes it.`)
  }
  // Mixed selections show the first line's type; a tap sets them all.
  const first = rows[ids[0]!]
  const current = first ? kindOf(first) : 'plain'
  const counted = countOf(selection, rows)
  const label = n === 0 ? 'Editing' : counted > 0 ? lineCount(counted) : n === 1 ? 'Blank line' : 'Blank lines'
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
  const moveMenu = places.length > 0 && (
    <span className="moveto">
      <button ref={moveBtn} type="button" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} title="Move to another pad or a sub-pad">Move to…</button>
      {menu && menuAt && createPortal(
        <div className="bar moveto-menu" role="menu" aria-label="Move to pad" style={{ left: menuAt.left, bottom: menuAt.bottom }} onMouseDown={(e) => e.preventDefault()}>
          {places.map((p) => (
            <button key={p.key} type="button" role="menuitem" className={p.subId ? 'sub' : undefined} title={p.label} onClick={() => moveTo(p)}>{p.label}</button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
  return (
    <div ref={ref} className="bar selbar" role="toolbar" aria-label={n > 0 ? 'Selected lines' : 'Current line'} onMouseDown={(e) => e.preventDefault()}>
      <span className="count">{label}</span>
      {LINE_ACTIONS.map((a, i) => {
        const prev = LINE_ACTIONS[i - 1]?.group
        const opens = prev !== a.group
        return (
          <Fragment key={a.id}>
            {opens && prev === 'mark' && kinds}
            {opens && RULE_BEFORE.has(a.group) && <span className="sep" aria-hidden="true" />}
            {opens && a.group === 'pad' && moveMenu}
            <button
              type="button"
              className={a.danger ? 'danger' : undefined}
              onClick={() => run(a)}
              disabled={a.enabled ? !a.enabled(can) : false}
              title={a.keys ? `${a.hint} (${shortcut(a.keys)})` : a.hint}
              aria-label={a.name === a.label ? undefined : a.name}
            >
              {a.label}
            </button>
          </Fragment>
        )
      })}
      <button type="button" onClick={close} aria-label={n > 0 ? 'Clear selection (Esc)' : 'Stop editing (Esc)'}>×</button>
    </div>
  )
}
