import { clearSelection, usePad } from './store'
import { cmdCopySelection, cmdDedent, cmdDeleteSelection, cmdIndent, cmdMove, cmdToggleCollapsed, cmdToggleDone, cmdToggleNumbered } from './commands'

// Shows while lines are selected. Same actions as the keyboard, for the mouse and the phone.
export function SelectionBar() {
  const selection = usePad((s) => s.selection)
  if (selection.length === 0) return null
  const n = selection.length
  return (
    <div className="bar selbar" role="toolbar" aria-label="Selected lines">
      <span className="count">{n === 1 ? '1 line' : `${n} lines`}</span>
      <button type="button" onClick={cmdToggleDone} title="Cross out (⌘Enter)">Done</button>
      <button type="button" onClick={cmdDedent} title="Outdent (Shift+Tab)" aria-label="Outdent">←</button>
      <button type="button" onClick={cmdIndent} title="Indent (Tab)" aria-label="Indent">→</button>
      <button type="button" onClick={() => cmdMove('up')} title="Move up (Alt+↑)" aria-label="Move up">↑</button>
      <button type="button" onClick={() => cmdMove('down')} title="Move down (Alt+↓)" aria-label="Move down">↓</button>
      <button type="button" onClick={cmdToggleCollapsed} title="Fold or unfold (⌘.)">Fold</button>
      <button type="button" onClick={cmdToggleNumbered} title="Numbered list on or off (⌘⇧7)" aria-label="Numbered list">1.</button>
      <button type="button" onClick={cmdCopySelection} title="Copy as outline (⌘C)">Copy</button>
      <button type="button" className="danger" onClick={cmdDeleteSelection} title="Delete (Backspace)">Delete</button>
      <button type="button" onClick={clearSelection} aria-label="Clear selection (Esc)">×</button>
    </div>
  )
}
