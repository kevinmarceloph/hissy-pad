// The line toolbar as data. Web (SelectionBar) and the phone (Toolbar) both draw their
// buttons from LINE_ACTIONS, so a new action is one entry here plus its command, and it
// shows up on both. Two widgets are not plain buttons and stay with each app: the line
// type switcher (drawn after the 'mark' group) and the "Move to…" pad menu (drawn before
// the 'remove' group, with the 'move' icon). Actions marked `more` sit in a dropdown (⋯)
// on both. An action with an `icon` is drawn as that icon, by each app's own icon set.
import { buildIndex, childrenOf, topmost, type NodeKind, type Rows } from '@hissypad/core'
import {
  cmdAddAbove, cmdAddBelow, cmdCopySelection, cmdCutSelection, cmdDedent, cmdDeleteSelection, cmdIndent, cmdMove, cmdMoveToTop, cmdPaste, cmdToggleCollapsed, cmdToggleDone, cmdUngroup,
} from './commands'
import { cmdLineToPad } from './pads'
import { cmdPickSlot } from './hours/slots'
import { cmdPickCategory } from './hours/line-categories'

// What the current targets allow, so an impossible action reads as disabled instead of
// silently doing nothing.
export interface LineAbilities {
  indent: boolean   // some target has an unselected sibling above it to nest under
  dedent: boolean   // some target is not at the top level
  up: boolean
  down: boolean
  children: boolean // some target has lines under it (fold, ungroup)
  folded: boolean   // every target with lines under it is folded (so Fold reads Unfold)
  single: boolean   // the targets come down to one line with its subtree (make pad)
}

export function lineAbilities(rows: Rows, ids: readonly string[]): LineAbilities {
  const index = buildIndex(rows)
  const tops = topmost(index, ids)
  const set = new Set(tops)
  const can: LineAbilities = { indent: false, dedent: false, up: false, down: false, children: false, folded: false, single: tops.length === 1 }
  let open = false
  for (const id of tops) {
    const parent = index.parentOf.get(id) ?? null
    const sibs = childrenOf(index, parent)
    const i = sibs.findIndex((s) => s.id === id)
    if (sibs.slice(0, i).some((s) => !set.has(s.id))) { can.indent = true; can.up = true }
    if (sibs.slice(i + 1).some((s) => !set.has(s.id))) can.down = true
    if (parent !== null) can.dedent = true
    if (childrenOf(index, id).length > 0) {
      can.children = true
      if (!rows[id]?.collapsed) open = true
    }
  }
  can.folded = can.children && !open
  return can
}

export type LineActionGroup = 'mark' | 'add' | 'move' | 'tree' | 'clip' | 'pad' | 'remove'

// The icons the toolbars draw. 'move' is also the Sort mode's icon in the top bar, and the
// "Move to…" menu's button.
export type LineIcon = 'addAbove' | 'addBelow' | 'top' | 'fold' | 'unfold' | 'copy' | 'cut' | 'pasteAbove' | 'pasteBelow' | 'move' | 'archive' | 'hour' | 'category' | 'more'

export interface LineAction {
  id: string
  group: LineActionGroup
  label: string    // what the button shows when it has no icon, and its line in a menu
  name: string     // its accessible name (the same as the label when that already says it)
  hint: string     // tooltip on the web
  icon?: LineIcon
  keys?: string    // the keyboard shortcut, as written on a Mac
  danger?: boolean
  // Less used: these sit in the toolbar's dropdown (⋯) instead of on the bar.
  more?: boolean
  enabled?: (can: LineAbilities) => boolean
  // What the button reads instead when the targets call for the opposite (Fold: Unfold).
  flip?: { when: (can: LineAbilities) => boolean; label: string; name: string; hint: string; icon?: LineIcon }
  // Returns a line to show the user (a toast on the web), or nothing. A promise when the
  // action has to wait on the platform (Paste reads the clipboard).
  run: () => string | void | Promise<string | void>
}

// The action as it should read for these targets: itself, or its flipped face.
export function actionFace(a: LineAction, can: LineAbilities): Pick<LineAction, 'label' | 'name' | 'hint' | 'icon'> {
  const f = a.flip && a.flip.when(can) ? a.flip : a
  const icon = f.icon ?? a.icon
  return { label: f.label, name: f.name, hint: f.hint, ...(icon ? { icon } : {}) }
}

async function paste(where: 'above' | 'below'): Promise<string | void> {
  const n = await cmdPaste(where)
  if (n === null) return 'Nothing to paste: the clipboard is empty, or could not be read.'
}

export const LINE_ACTIONS: readonly LineAction[] = [
  { id: 'done', group: 'mark', label: 'Done', name: 'Done', hint: 'Cross out', keys: '⌘Enter', run: cmdToggleDone },
  { id: 'addAbove', group: 'add', label: '+ above', name: 'Add a line above', hint: 'New line above', icon: 'addAbove', run: cmdAddAbove },
  { id: 'addBelow', group: 'add', label: '+ below', name: 'Add a line below', hint: 'New line below', icon: 'addBelow', run: cmdAddBelow },
  { id: 'dedent', group: 'move', label: '←', name: 'Outdent', hint: 'Outdent', keys: 'Shift+Tab', enabled: (c) => c.dedent, run: cmdDedent },
  { id: 'indent', group: 'move', label: '→', name: 'Indent', hint: 'Indent', keys: 'Tab', enabled: (c) => c.indent, run: cmdIndent },
  { id: 'down', group: 'move', label: '↓', name: 'Move down', hint: 'Move down', keys: 'Alt+↓', enabled: (c) => c.down, run: () => cmdMove('down') },
  { id: 'up', group: 'move', label: '↑', name: 'Move up', hint: 'Move up', keys: 'Alt+↑', enabled: (c) => c.up, run: () => cmdMove('up') },
  { id: 'top', group: 'move', label: 'Top', name: 'Move to top', hint: 'Move to the top of its level', icon: 'top', enabled: (c) => c.up, run: cmdMoveToTop },
  {
    id: 'fold', group: 'tree', label: 'Fold', name: 'Fold', hint: 'Fold: hide its sub items', icon: 'fold', keys: '⌘.', enabled: (c) => c.children, run: cmdToggleCollapsed,
    flip: { when: (c) => c.folded, label: 'Unfold', name: 'Unfold', hint: 'Unfold: show its sub items', icon: 'unfold' },
  },
  { id: 'ungroup', group: 'tree', label: 'Ungroup', name: 'Ungroup', hint: 'Ungroup: its sub items come out to its own level', more: true, enabled: (c) => c.children, run: cmdUngroup },
  { id: 'copy', group: 'clip', label: 'Copy', name: 'Copy', hint: 'Copy as outline', icon: 'copy', keys: '⌘C', run: () => void cmdCopySelection() },
  { id: 'cut', group: 'clip', label: 'Cut', name: 'Cut', hint: 'Cut: copy as outline, then delete', icon: 'cut', keys: '⌘X', run: cmdCutSelection },
  { id: 'pasteAbove', group: 'clip', label: 'Paste above', name: 'Paste above', hint: 'Paste the clipboard as lines above', icon: 'pasteAbove', run: () => paste('above') },
  { id: 'pasteBelow', group: 'clip', label: 'Paste below', name: 'Paste below', hint: 'Paste the clipboard as lines below', icon: 'pasteBelow', run: () => paste('below') },
  { id: 'slot', group: 'pad', label: 'Hour…', name: 'Put in an hour', hint: 'Put in an hour of a day (Hours counts what is done there)', icon: 'hour', run: cmdPickSlot },
  { id: 'category', group: 'pad', label: 'Category…', name: 'Give a category', hint: 'Give it one of Hours\' categories (its icon shows before the text)', icon: 'category', run: cmdPickCategory },
  {
    id: 'makePad', group: 'pad', label: 'Make pad', name: 'Make pad', hint: 'Make this line a pad: its text is the name, its sub items the lines', more: true,
    enabled: (c) => c.single,
    run: () => {
      const res = cmdLineToPad()
      return res ? `“${res.name}” is a pad now.` : undefined
    },
  },
  { id: 'delete', group: 'remove', label: 'Archive', name: 'Archive', hint: 'Archive (undo brings it back)', icon: 'archive', keys: 'Backspace', danger: true, run: cmdDeleteSelection },
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
