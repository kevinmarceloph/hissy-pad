import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import type { NodeRow } from '@hissypad/core'
import { clickSelect, edit, select, usePad, type Editing } from './store'
import {
  cmdBackspaceAtStart, cmdDedent, cmdEditNeighbor, cmdIndent, cmdMove, cmdPasteInto, cmdSetText,
  cmdSplit, cmdToggleCollapsed, cmdToggleDone, cmdToggleNumbered,
} from './commands'
import { redo, undo } from './store'
import { apply } from './store'
import { toggleCollapsed } from '@hissypad/core'

interface Props {
  row: NodeRow
  depth: number
  hasChildren: boolean
  editing: Editing | null
  selected: boolean
  number: number | null // position in a numbered run, or null for a plain bullet
}

// Either modifier works everywhere: Cmd is the Mac habit, Ctrl is what external keyboards
// on Android and Windows send, and nothing here needs them to mean different things.
const mod = (e: KeyboardEvent | MouseEvent) => e.metaKey || e.ctrlKey

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

function Linkified({ text }: { text: string }) {
  const parts: (string | { url: string })[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index))
    parts.push({ url: m[0] })
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <span key={i}>{p}</span>
        ) : (
          <a key={i} href={p.url} target="_blank" rel="noreferrer noopener" onMouseDown={(e) => e.stopPropagation()}>
            {p.url}
          </a>
        ),
      )}
    </>
  )
}

// Caret offset for a click inside the static text, so clicking a word starts editing there.
function caretFromPoint(el: HTMLElement, x: number, y: number): number | 'end' {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  let node: Node | null = null
  let offset = 0
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y)
    if (pos) ({ offsetNode: node, offset } = pos)
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y)
    if (r) ({ startContainer: node, startOffset: offset } = r)
  }
  if (!node || !el.contains(node)) return 'end'
  const range = document.createRange()
  range.setStart(el, 0)
  range.setEnd(node, offset)
  return range.toString().length
}

export function Row({ row, depth, hasChildren, editing, selected, number }: Props) {
  const isEditing = editing?.id === row.id
  const ref = useRef<HTMLTextAreaElement>(null)

  // Focus + caret whenever this row becomes the editing row (or asks to be refocused).
  useLayoutEffect(() => {
    const ta = ref.current
    if (!isEditing || !ta) return
    const pos = editing!.caret === 'end' ? ta.value.length : Math.min(editing!.caret, ta.value.length)
    if (document.activeElement !== ta) ta.focus({ preventScroll: true })
    ta.setSelectionRange(pos, pos)
    ta.scrollIntoView({ block: 'nearest' })
  }, [isEditing, editing?.rev])

  // Auto-grow.
  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.style.height = '0px'
    ta.style.height = `${ta.scrollHeight}px`
  })

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget
    const { selectionStart, selectionEnd, value } = ta
    if (e.key === 'Enter' && !e.shiftKey && !mod(e)) {
      e.preventDefault()
      if (selectionStart !== selectionEnd) cmdSetText(row.id, value.slice(0, selectionStart) + value.slice(selectionEnd))
      cmdSplit(row.id, selectionStart)
    } else if (e.key === 'Enter' && mod(e)) {
      e.preventDefault()
      cmdToggleDone()
    } else if (e.key === 'Backspace' && selectionStart === 0 && selectionEnd === 0) {
      e.preventDefault()
      cmdBackspaceAtStart(row.id)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) cmdDedent()
      else cmdIndent()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      ta.blur()
      select([row.id], row.id)
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
      e.preventDefault()
      cmdMove(e.key === 'ArrowUp' ? 'up' : 'down')
    } else if (e.key === 'ArrowUp' && !e.shiftKey && !value.slice(0, selectionStart).includes('\n') && onFirstVisualLine(ta)) {
      e.preventDefault()
      cmdEditNeighbor(row.id, -1)
    } else if (e.key === 'ArrowDown' && !e.shiftKey && !value.slice(selectionEnd).includes('\n') && onLastVisualLine(ta)) {
      e.preventDefault()
      cmdEditNeighbor(row.id, 1)
    } else if (e.key === '.' && mod(e)) {
      e.preventDefault()
      cmdToggleCollapsed()
    } else if ((e.key === '7' || e.key === '&') && mod(e) && e.shiftKey) {
      e.preventDefault()
      cmdToggleNumbered()
    } else if (e.key.toLowerCase() === 'z' && mod(e)) {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
  }

  function onBulletClick(e: MouseEvent) {
    e.preventDefault()
    clickSelect(row.id, { shift: e.shiftKey, meta: mod(e) })
  }

  function onTextMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    edit(row.id, caretFromPoint(e.currentTarget, e.clientX, e.clientY))
  }

  const cls = ['row', row.done && 'is-done', row.text === '' && 'is-empty', number !== null && 'is-numbered', selected && 'is-selected', isEditing && 'is-editing', row.collapsed && hasChildren && 'is-collapsed']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls} style={{ '--depth': depth } as React.CSSProperties} data-id={row.id} role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? !row.collapsed : undefined} aria-level={depth + 1}>
      <button
        type="button"
        className="toggle"
        tabIndex={-1}
        aria-label={row.collapsed ? 'Expand' : 'Collapse'}
        hidden={!hasChildren}
        onClick={() => apply((rows, ctx) => toggleCollapsed(rows, ctx, row.id))}
      />
      <button
        type="button"
        className="bullet"
        data-num={number !== null ? `${number}.` : undefined}
        aria-label={selected ? 'Deselect line' : 'Select line'}
        onClick={onBulletClick}
      />
      {isEditing ? (
        <textarea
          ref={ref}
          className="text"
          rows={1}
          value={row.text}
          aria-label="Line text"
          onChange={(e) => cmdSetText(row.id, e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text/plain')
            if (cmdPasteInto(row.id, text)) e.preventDefault()
          }}
          onBlur={(e) => {
            // Clicking a toolbar button blurs us; keep the editing row so the action targets it.
            if (e.relatedTarget && (e.relatedTarget as HTMLElement).closest('.bar')) return
            if (usePad.getState().editing?.id === row.id) usePad.setState({ editing: null })
          }}
        />
      ) : (
        <div className="text" onMouseDown={onTextMouseDown}>
          {row.text === '' ? <span className="placeholder" aria-hidden="true">{'​'}</span> : <Linkified text={row.text} />}
        </div>
      )}
    </div>
  )
}

function onFirstVisualLine(ta: HTMLTextAreaElement): boolean {
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24
  return ta.scrollHeight <= lh * 1.5 || caretLine(ta) === 0
}

function onLastVisualLine(ta: HTMLTextAreaElement): boolean {
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24
  const lines = Math.round(ta.scrollHeight / lh)
  return lines <= 1 || caretLine(ta) >= lines - 1
}

// Visual line of the caret, measured with a mirror span. Good enough for wrapped rows.
function caretLine(ta: HTMLTextAreaElement): number {
  const mirror = document.createElement('div')
  const cs = getComputedStyle(ta)
  for (const p of ['font', 'lineHeight', 'padding', 'width', 'letterSpacing', 'whiteSpace', 'wordBreak', 'overflowWrap'] as const) {
    mirror.style[p] = cs[p]
  }
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.textContent = ta.value.slice(0, ta.selectionStart)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const lh = parseFloat(cs.lineHeight) || 24
  const line = Math.round(marker.offsetTop / lh)
  mirror.remove()
  return line
}
