// The line toolbar as data. Web (SelectionBar) and the phone (Toolbar) both draw their
// buttons from LINE_ACTIONS, so a new action is one entry here plus its command, and it
// shows up on both. Two widgets are not plain buttons and stay with each app: the line
// type switcher (drawn after the 'mark' group) and the "Move to…" pad menu (drawn before
// the 'pad' group).
import { buildIndex, childrenOf, topmost, type NodeKind, type Rows } from '@hissypad/core'
import {
  cmdAddAbove, cmdAddBelow, cmdCopySelection, cmdDedent, cmdDeleteSelection, cmdIndent, cmdMove, cmdToggleCollapsed, cmdToggleDone, cmdUngroup,
} from './commands'
import { cmdLineToPad } from './pads'
import { cmdPickSlot } from './hours/slots'

// What the current targets allow, so an impossible action reads as disabled instead of
// silently doing nothing.
export interface LineAbilities {
  indent: boolean   // some target has an unselected sibling above it to nest under
  dedent: boolean   // some target is not at the top level
  up: boolean
  down: boolean
  children: boolean // some target has lines under it (fold, ungroup)
  single: boolean   // the targets come down to one line with its subtree (make pad)
}

export function lineAbilities(rows: Rows, ids: readonly string[]): LineAbilities {
  const index = buildIndex(rows)
  const tops = topmost(index, ids)
  const set = new Set(tops)
  const can: LineAbilities = { indent: false, dedent: false, up: false, down: false, children: false, single: tops.length === 1 }
  for (const id of tops) {
    const parent = index.parentOf.get(id) ?? null
    const sibs = childrenOf(index, parent)
    const i = sibs.findIndex((s) => s.id === id)
    if (sibs.slice(0, i).some((s) => !set.has(s.id))) { can.indent = true; can.up = true }
    if (sibs.slice(i + 1).some((s) => !set.has(s.id))) can.down = true
    if (parent !== null) can.dedent = true
    if (childrenOf(index, id).length > 0) can.children = true
  }
  return can
}

export type LineActionGroup = 'mark' | 'add' | 'move' | 'tree' | 'clip' | 'pad' | 'remove'

export interface LineAction {
  id: string
  group: LineActionGroup
  label: string    // what the button shows
  name: string     // its accessible name (the same as the label when that already says it)
  hint: string     // tooltip on the web
  keys?: string    // the keyboard shortcut, as written on a Mac
  danger?: boolean
  // Less used: an app short on width may tuck these behind a "More" button.
  more?: boolean
  enabled?: (can: LineAbilities) => boolean
  // Returns a line to show the user (a toast on the web), or nothing.
  run: () => string | void
}

export const LINE_ACTIONS: readonly LineAction[] = [
  { id: 'done', group: 'mark', label: 'Done', name: 'Done', hint: 'Cross out', keys: '⌘Enter', run: cmdToggleDone },
  { id: 'addAbove', group: 'add', label: '+ above', name: 'Add a line above', hint: 'New line above', run: cmdAddAbove },
  { id: 'addBelow', group: 'add', label: '+ below', name: 'Add a line below', hint: 'New line below', run: cmdAddBelow },
  { id: 'dedent', group: 'move', label: '←', name: 'Outdent', hint: 'Outdent', keys: 'Shift+Tab', enabled: (c) => c.dedent, run: cmdDedent },
  { id: 'indent', group: 'move', label: '→', name: 'Indent', hint: 'Indent', keys: 'Tab', enabled: (c) => c.indent, run: cmdIndent },
  { id: 'up', group: 'move', label: '↑', name: 'Move up', hint: 'Move up', keys: 'Alt+↑', enabled: (c) => c.up, run: () => cmdMove('up') },
  { id: 'down', group: 'move', label: '↓', name: 'Move down', hint: 'Move down', keys: 'Alt+↓', enabled: (c) => c.down, run: () => cmdMove('down') },
  { id: 'fold', group: 'tree', label: 'Fold', name: 'Fold', hint: 'Fold or unfold', keys: '⌘.', enabled: (c) => c.children, run: cmdToggleCollapsed },
  { id: 'ungroup', group: 'tree', label: 'Ungroup', name: 'Ungroup', hint: 'Ungroup: its sub items come out to its own level', enabled: (c) => c.children, run: cmdUngroup },
  { id: 'copy', group: 'clip', label: 'Copy', name: 'Copy', hint: 'Copy as outline', keys: '⌘C', run: () => void cmdCopySelection() },
  { id: 'slot', group: 'pad', label: 'Hour…', name: 'Put in an hour', hint: 'Put in an hour of a day (Hours counts what is done there)', more: true, run: cmdPickSlot },
  {
    id: 'makePad', group: 'pad', label: 'Make pad', name: 'Make pad', hint: 'Make this line a pad: its text is the name, its sub items the lines', more: true,
    enabled: (c) => c.single,
    run: () => {
      const res = cmdLineToPad()
      return res ? `“${res.name}” is a pad now.` : undefined
    },
  },
  { id: 'delete', group: 'remove', label: 'Delete', name: 'Delete', hint: 'Delete', keys: 'Backspace', danger: true, run: cmdDeleteSelection },
]

// The three line types, for the switcher both toolbars draw.
export const LINE_KINDS: readonly { kind: NodeKind; glyph: string; name: string; hint: string; keys?: string }[] = [
  { kind: 'plain', glyph: '·', name: 'Bullet', hint: 'Plain bullet' },
  { kind: 'header', glyph: '#', name: 'Header', hint: 'Header: bold, with a # bullet' },
  { kind: 'numbered', glyph: '1.', name: 'Numbered list', hint: 'Numbered list', keys: '⌘⇧7' },
]

// "1 line" / "3 lines", for the counts the app reports.
export function lineCount(n: number): string {
  return `${n} ${n === 1 ? 'line' : 'lines'}`
}
