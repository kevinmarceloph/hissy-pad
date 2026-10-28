import { useEffect, useMemo, useRef } from 'react'
import { buildIndex, childrenOf, topmost } from '@hissypad/core'
import { clearSelection, stopEditing, usePad } from './store'
import {
  cmdAddAbove, cmdAddBelow, cmdCopySelection, cmdDedent, cmdDeleteSelection, cmdIndent, cmdMove,
  cmdToggleCollapsed, cmdToggleDone, cmdToggleNumbered,
} from './commands'

// What each action can do for the current targets, so impossible ones read as disabled
// instead of silently doing nothing.
function abilities(rows: ReturnType<typeof usePad.getState>['rows'], ids: string[]) {
  const index = buildIndex(rows)
  const tops = topmost(index, ids)
  const set = new Set(tops)
  let indent = false, dedent = false, up = false, down = false, fold = false
  for (const id of tops) {
    const parent = index.parentOf.get(id) ?? null
    const sibs = childrenOf(index, parent)
    const i = sibs.findIndex((s) => s.id === id)
    if (sibs.slice(0, i).some((s) => !set.has(s.id))) { indent = true; up = true }
    if (sibs.slice(i + 1).some((s) => !set.has(s.id))) down = true
    if (parent !== null) dedent = true
    if (childrenOf(index, id).length > 0) fold = true
  }
  return { indent, dedent, up, down, fold }
}

// Shows while a line is being edited or lines are selected. Same actions as the keyboard,
// for the mouse and the phone. Mousedown is swallowed so a tap never blurs the textarea.
export function SelectionBar() {
  const selection = usePad((s) => s.selection)
  const editing = usePad((s) => s.editing)
  const rows = usePad((s) => s.rows)
  const ids = selection.length > 0 ? selection : editing ? [editing.id] : []
  const can = useMemo(() => abilities(rows, ids), [rows, ids])
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
  const label = n === 0 ? 'Editing' : n === 1 ? '1 line' : `${n} lines`
  const close = () => {
    if (n > 0) clearSelection()
    else {
      stopEditing()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    }
  }
  return (
    <div ref={ref} className="bar selbar" role="toolbar" aria-label={n > 0 ? 'Selected lines' : 'Current line'} onMouseDown={(e) => e.preventDefault()}>
      <span className="count">{label}</span>
      <button type="button" onClick={cmdToggleDone} title="Cross out (⌘Enter)">Done</button>
      <button type="button" onClick={cmdToggleNumbered} title="Numbered list on or off (⌘⇧7)" aria-label="Numbered list">1.</button>
      <span className="sep" aria-hidden="true" />
      <button type="button" onClick={cmdAddAbove} title="New line above" aria-label="Add a line above">+ above</button>
      <button type="button" onClick={cmdAddBelow} title="New line below" aria-label="Add a line below">+ below</button>
      <span className="sep" aria-hidden="true" />
      <button type="button" onClick={cmdDedent} disabled={!can.dedent} title="Outdent (Shift+Tab)" aria-label="Outdent">←</button>
      <button type="button" onClick={cmdIndent} disabled={!can.indent} title="Indent (Tab)" aria-label="Indent">→</button>
      <button type="button" onClick={() => cmdMove('up')} disabled={!can.up} title="Move up (Alt+↑)" aria-label="Move up">↑</button>
      <button type="button" onClick={() => cmdMove('down')} disabled={!can.down} title="Move down (Alt+↓)" aria-label="Move down">↓</button>
      <span className="sep" aria-hidden="true" />
      <button type="button" onClick={cmdToggleCollapsed} disabled={!can.fold} title="Fold or unfold (⌘.)">Fold</button>
      <button type="button" onClick={cmdCopySelection} title="Copy as outline (⌘C)">Copy</button>
      <button type="button" className="danger" onClick={cmdDeleteSelection} title="Delete (Backspace)">Delete</button>
      <button type="button" onClick={close} aria-label={n > 0 ? 'Clear selection (Esc)' : 'Stop editing (Esc)'}>×</button>
    </div>
  )
}
