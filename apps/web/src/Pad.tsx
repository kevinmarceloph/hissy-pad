import { useEffect, useMemo } from 'react'
import { buildIndex, childrenOf, listNumbers } from '@hissypad/core'
import { clearSelection, edit, redo, selectAll, stepSelection, undo, usePad, visibleIds } from './store'
import {
  cmdAppendAtEnd, cmdCopySelection, cmdCutSelection, cmdDedent, cmdDeleteSelection, cmdIndent, cmdMove,
  cmdPasteAfterSelection, cmdToggleCollapsed, cmdToggleDone, cmdToggleNumbered,
} from './commands'
import { Row } from './Row'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function Pad() {
  const rows = usePad((s) => s.rows)
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
    return { index, visible: ids.map((id) => ({ id, depth: depth.get(id) ?? 0 })), numbers: listNumbers(index) }
  }, [rows])

  const selectedSet = useMemo(() => new Set(selection), [selection])

  // Selection-mode keys live on the window; they bail whenever a text field has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      const inField = t.closest?.('textarea, input, [contenteditable="true"], dialog')
      const mod = e.metaKey || e.ctrlKey
      if (!inField && mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (inField) return
      const { selection, focusId } = usePad.getState()
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAll()
        return
      }
      if (selection.length === 0) return
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          if (e.altKey) cmdMove('up')
          else stepSelection(-1, e.shiftKey)
          break
        case 'ArrowDown':
          e.preventDefault()
          if (e.altKey) cmdMove('down')
          else stepSelection(1, e.shiftKey)
          break
        case 'Enter':
          e.preventDefault()
          if (mod) cmdToggleDone()
          else edit(focusId ?? selection[0]!, 'end')
          break
        case 'Escape':
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
      if (t.closest?.('textarea, input, dialog')) return
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

  const lone = visible.length === 1 && rows[visible[0]!.id]!.text === ''

  return (
    <section className="pad" aria-label="Pad">
      <div className="rows" role="tree" aria-multiselectable="true">
        {visible.map(({ id, depth }) => (
          <Row
            key={id}
            row={rows[id]!}
            depth={depth}
            hasChildren={childrenOf(index, id).length > 0}
            editing={editing}
            selected={selectedSet.has(id)}
            number={numbers.get(id) ?? null}
          />
        ))}
      </div>
      {lone && (
        <p className="hint">
          Type anything. <kbd>Enter</kbd> for a new line, <kbd>Tab</kbd> to nest, <kbd>Esc</kbd> to select a line,
          {' '}<kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>+<kbd>Enter</kbd> to cross it out, <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>+<kbd>Shift</kbd>+<kbd>7</kbd> to number it. Paste an outline and it keeps its shape.
        </p>
      )}
      <button type="button" className="tail" aria-label="Add a line at the end" onClick={cmdAppendAtEnd} />
    </section>
  )
}
