import { Fragment, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { buildIndex, childrenOf, countLines, descendantIds, dueHeads, homeNumbers, listNumbers, pinDivider, scheduleHead } from '@hissypad/core'
import { clearSelection, edit, redo, selectAll, stepSelection, undo, usePad, visibleIds } from '@hissypad/state'
import {
  todayShown, cmdAddAtTop, cmdAppendAtEnd, cmdCopySelection, cmdCutSelection, cmdDedent, cmdDeleteSelection, cmdIndent, cmdMove,
  cmdPasteAfterSelection, cmdToggleCollapsed, cmdToggleDone, cmdToggleNumbered,
} from '@hissypad/state'
import { Row } from './Row'
import { DueHead, ScheduledHead } from './Boomerangs'
import { useDrag } from './useDrag'
import { forceSync } from '@hissypad/state'
import { MOD } from '../platform/os'

// The placeholder row of a + drag, in the displayed list.
const NEW_ROW = '\u0000new'

// `embedded`: drawn inside the new item's card, over the lines under that item (the store is
// zoomed into it). No hint, no tail and no floating +: the card has its own way to add one.
// `undo` off: the screen it is in has its own Undo (Sort's Back) for Cmd+Z outside a field.
export function Pad({ embedded = false, undo: ownUndo = true }: { embedded?: boolean; undo?: boolean }) {
  const rows = usePad((s) => s.rows)
  // In an hour the lines are lifted out of their lists: their numbers are the ones they have at home.
  const home = usePad((s) => (s.slotId !== null ? s.all : null))
  const editing = usePad((s) => s.editing)
  const selection = usePad((s) => s.selection)

  const { index, visible, numbers } = useMemo(() => {
    const index = buildIndex(rows)
    const ids = visibleIds({ ...usePad.getState(), rows })
    const depth = new Map<string, number>()
    const walk = (parentId: string | null, d: number) => {
      for (const r of childrenOf(index, parentId)) {
        depth.set(r.id, d)
        walk(r.id, d + 1)
      }
    }
    walk(null, 0)
    return { index, visible: ids.map((id) => ({ id, depth: depth.get(id) ?? 0 })), numbers: home ? homeNumbers(home) : listNumbers(index) }
  }, [rows, home])

  const selectedSet = useMemo(() => new Set(selection), [selection])
  // Descendants of a selected line come along with it (move, cut, delete), so they get a
  // fainter wash than the line itself. A descendant that is selected on its own stays full.
  const selectedChildSet = useMemo(() => {
    const set = new Set<string>()
    for (const id of selection) for (const d of descendantIds(index, id)) if (!selectedSet.has(d)) set.add(d)
    return set
  }, [selection, selectedSet, index])
  const rowsRef = useRef<HTMLDivElement>(null)
  const { drag, onBulletPointerDown, onBulletClickCapture, onAddPointerDown } = useDrag(rowsRef)
  const draggingSet = useMemo(() => {
    if (!drag) return new Set<string>()
    const set = new Set(drag.ids)
    for (const id of drag.ids) for (const d of descendantIds(index, id)) set.add(d)
    return set
  }, [drag, index])

  // Live reorder: while a drop target exists, the dragged rows are shown where they would
  // land, at the target depth, and everything else reflows around them. What you see is
  // what a release gives you.
  const displayed = useMemo(() => {
    const t = drag?.target
    // The floating + being carried: a placeholder shows where the new line would open.
    if (t && drag?.add) {
      const plain = visible.map((v) => ({ ...v, preview: false }))
      return [...plain.slice(0, t.gapIndex), { id: NEW_ROW, depth: t.depth, preview: true }, ...plain.slice(t.gapIndex)]
    }
    if (!t || draggingSet.size === 0) return visible.map((v) => ({ ...v, preview: false }))
    const anchors = visible.filter((v) => !draggingSet.has(v.id))
    const moving = visible.filter((v) => draggingSet.has(v.id))
    const base = moving[0]?.depth ?? 0
    const placed = moving.map((v) => ({ id: v.id, depth: v.depth - base + t.depth, preview: true }))
    return [...anchors.slice(0, t.gapIndex).map((v) => ({ ...v, preview: false })), ...placed, ...anchors.slice(t.gapIndex).map((v) => ({ ...v, preview: false }))]
  }, [visible, drag?.target, drag?.add, draggingSet])

  // A jump to a line (a sub-pad, a search hit, Sort's pad icon): bring it to the top of the window and flash it once.
  const reveal = usePad((s) => s.reveal)
  const padId = usePad((s) => s.padId)
  // Another pad drops the room a jump left (a jump that opens a pad sets it again after this).
  useEffect(() => { if (rowsRef.current) rowsRef.current.style.paddingBottom = '' }, [padId])
  useEffect(() => {
    if (!reveal) return
    const el = rowsRef.current?.querySelector<HTMLElement>(`.row[data-id="${reveal.id}"]`)
    if (!el) return
    // Room under the last line, so a line near the end can still reach the top.
    const box = rowsRef.current!
    box.style.paddingBottom = ''
    const room = window.innerHeight - (box.getBoundingClientRect().bottom - el.getBoundingClientRect().top)
    if (room > 0) box.style.paddingBottom = `${Math.ceil(room)}px`
    el.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    el.animate?.([{ background: 'var(--accent-soft)' }, { background: 'transparent' }], { duration: 1200, easing: 'ease-out' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.n])

  // FLIP: rows that moved since the last layout slide from their old spot (drag only).
  const prevTops = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const root = rowsRef.current
    if (!root) return
    const els = root.querySelectorAll<HTMLElement>('.row[data-id]')
    const next = new Map<string, number>()
    for (const el of els) {
      const top = el.offsetTop
      next.set(el.dataset.id!, top)
      const prev = prevTops.current.get(el.dataset.id!)
      if (drag && prev !== undefined && prev !== top) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${prev - top}px)`
        requestAnimationFrame(() => {
          el.style.transition = 'transform 140ms ease'
          el.style.transform = ''
        })
      }
    }
    prevTops.current = next
  })

  // Selection-mode keys live on the window; they bail whenever a text field has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      const inField = t.closest?.('textarea, input, [contenteditable="true"], dialog:not(.create)')
      const mod = e.metaKey || e.ctrlKey
      // Cmd+S: swallow the browser's save dialog and sync now instead.
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        forceSync()
        return
      }
      if (!inField && mod && e.key.toLowerCase() === 'z' && ownUndo) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (inField) return
      const { selection, focusId } = usePad.getState()
      if (mod && e.key.toLowerCase() === 'a' && !embedded) {
        e.preventDefault()
        selectAll()
        return
      }
      if (selection.length === 0) return
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          if (e.altKey || (mod && e.shiftKey)) cmdMove('up')
          else stepSelection(-1, e.shiftKey)
          break
        case 'ArrowDown':
          e.preventDefault()
          if (e.altKey || (mod && e.shiftKey)) cmdMove('down')
          else stepSelection(1, e.shiftKey)
          break
        case 'Enter':
          e.preventDefault()
          if (mod) cmdToggleDone()
          else edit(focusId ?? selection[0]!, 'end')
          break
        case 'Escape':
          // Taken here, so a dialog the pad is drawn in (the new item's card) stays open.
          e.preventDefault()
          clearSelection()
          break
        case 'Tab':
          e.preventDefault()
          if (e.shiftKey) cmdDedent()
          else cmdIndent()
          break
        case 'Backspace':
        case 'Delete':
          e.preventDefault()
          cmdDeleteSelection()
          break
        case '.':
          if (mod) {
            e.preventDefault()
            cmdToggleCollapsed()
          }
          break
        case '7':
        case '&':
          if (mod && e.shiftKey) {
            e.preventDefault()
            cmdToggleNumbered()
          }
          break
        case 'c':
        case 'C':
          if (mod) {
            e.preventDefault()
            cmdCopySelection()
          }
          break
        case 'x':
        case 'X':
          if (mod) {
            e.preventDefault()
            cmdCutSelection()
          }
          break
      }
    }
    function onPaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement
      if (t.closest?.('textarea, input, dialog:not(.create)')) return
      if (usePad.getState().selection.length === 0) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!text) return
      e.preventDefault()
      cmdPasteAfterSelection(text)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  // The rule under the pinned lines, in a pad as itself (not in a card or an open hour).
  const pinEnd = useMemo(() => (embedded ? null : pinDivider(displayed, rows)), [embedded, displayed, rows])

  // In Later: a heading before each day's group of lines out on a boomerang.
  const heads = useMemo(() => (embedded ? new Map<string, string>() : dueHeads(displayed, rows)), [embedded, displayed, rows])
  const firstHead = heads.keys().next().value
  // In Today: a heading before the lines with an hour, which sit under the pad's own.
  const isToday = usePad(todayShown)
  const scheduled = useMemo(() => (embedded || !isToday ? null : scheduleHead(displayed, rows)), [embedded, isToday, displayed, rows])

  const lone = visible.length === 1 && rows[visible[0]!.id]!.text === ''

  return (
    <section className="pad" aria-label={embedded ? 'Sub items' : 'Pad'}>
      <div className="rows" role="tree" aria-multiselectable="true" ref={rowsRef}>
        {displayed.map(({ id, depth, preview }) => (
          <Fragment key={id}>
          {heads.has(id) && <DueHead due={heads.get(id)!} first={id === firstHead} />}
          {id === scheduled && <ScheduledHead />}
          {id === NEW_ROW ? (
            <div className="new-row" style={{ '--depth': depth } as React.CSSProperties} aria-hidden="true">+</div>
          ) : (
          <Row
            row={rows[id]!}
            depth={depth}
            childCount={childrenOf(index, id).length}
            foldCount={countLines(childrenOf(index, id))}
            editing={editing}
            selected={selectedSet.has(id)}
            selectedChild={selectedChildSet.has(id)}
            number={numbers.get(id) ?? null}
            dragging={preview ? false : draggingSet.has(id)}
            preview={preview}
            onBulletPointerDown={onBulletPointerDown}
            onBulletClickCapture={onBulletClickCapture}
          />
          )}
          {id === pinEnd && <div className="pin-divider" role="separator" aria-label="Pinned lines end here" />}
          </Fragment>
        ))}
      </div>
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y - 10 }} aria-hidden="true">
          {drag.count > 1 ? `${drag.count} lines` : drag.label}
        </div>
      )}
      {lone && !embedded && (
        <p className="hint">
          Type anything. <kbd>Enter</kbd> for a new line, <kbd>Tab</kbd> to nest, <kbd>Esc</kbd> to select a line,
          {' '}<kbd>{MOD}</kbd>+<kbd>Enter</kbd> to cross it out, <kbd>{MOD}</kbd>+<kbd>Shift</kbd>+<kbd>7</kbd> to number it. Paste an outline and it keeps its shape.
        </p>
      )}
      {!embedded && <button type="button" className="tail" aria-label="Add a line at the end" onClick={cmdAppendAtEnd} />}
      {/* Phone width only (CSS), like the phone app's +: a tap adds a line at the top, a drag
          carries it onto the pad and adds the line where it is let go. Away while a line is
          being edited or lines are selected: the toolbar's floating buttons sit there then. */}
      {!embedded && !editing && selection.length === 0 && (
        <button
          type="button"
          className="fab-add"
          aria-label="Add a line at the top"
          title="Add a line at the top. Drag it onto the pad to add the line there."
          style={drag?.add ? { opacity: 0.35 } : undefined}
          onPointerDown={onAddPointerDown}
          onClickCapture={onBulletClickCapture}
          onClick={() => {
            cmdAddAtTop()
            window.scrollTo?.({ top: 0 })
          }}
        >
          +
        </button>
      )}
    </section>
  )
}
