import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { kindOf, type PadId } from '@hissypad/core'
import {
  clearSelection, cmdMoveToPad, cmdSetKind, lineAbilities, lineCount, padList, padName, stopEditing, usePad,
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
  const pads = useMemo(() => padList(all).filter((p) => p.id !== padId), [all, padId])
  const [menu, setMenu] = useState(false)
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

  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.('.moveto')) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
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
  function moveTo(id: PadId) {
    setMenu(false)
    const moved = cmdMoveToPad(id)
    if (moved) showToast(`Moved ${lineCount(moved)} to “${padName(all, id)}”.`)
  }
  function run(a: LineAction) {
    const said = a.run()
    if (said) showToast(`${said} ${MOD}+Z undoes it.`)
  }
  // Mixed selections show the first line's type; a tap sets them all.
  const first = rows[ids[0]!]
  const current = first ? kindOf(first) : 'plain'
  const label = n === 0 ? 'Editing' : lineCount(n)
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
  const moveMenu = pads.length > 0 && (
    <span className="moveto">
      <button type="button" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} title="Move to another pad">Move to…</button>
      {menu && (
        <div className="menu" role="menu" aria-label="Move to pad">
          {pads.map((p) => (
            <button key={p.id ?? 'main'} type="button" role="menuitem" onClick={() => moveTo(p.id)}>{p.name}</button>
          ))}
        </div>
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
