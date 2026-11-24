// The line toolbar as data. Web (SelectionBar) and the phone (Toolbar) both draw their
// buttons from LINE_ACTIONS, so a new action is one entry here plus its command, and it
// shows up on both. Two widgets are not plain buttons and stay with each app: the line
// type switcher (drawn after the 'mark' group) and the "Move to…" pad menu (drawn before
// the 'remove' group, with the 'move' icon). Actions marked `more` sit in a dropdown (⋯)
// on both. An action with an `icon` is drawn as that icon, by each app's own icon set.
// Actions marked `floats` (Done, Hour…, Category…) are not on the bar: both apps draw them
// as round buttons floating above it, Done as the open / doing / done switch.
import { buildIndex, childrenOf, topmost, type NodeKind, type Rows } from '@hissypad/core'
import {
  cmdAddAbove, cmdAddBelow, cmdCopySelection, cmdCutSelection, cmdDedent, cmdDeleteSelection, cmdIndent, cmdMove, cmdMoveToTop, cmdPaste, cmdTogglePin, cmdToggleCollapsed, cmdSplitOpen, cmdToggleDone, cmdUngroup,
} from './commands'
import { cmdLineToPad } from './pads'
import { cmdPickSlot, cmdSetSlot } from './hours/slots'
import { clearSelection } from './selection'
import { usePad } from './store'
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
  mixed: boolean    // some target has both done and open sub items (split off open)
  hour: boolean     // the lines are an open hour's (the store shows that hour, not a pad)
  pads: boolean     // the rows are a pad as itself: not an open hour, not a zoomed line's sub items
  pin: boolean      // some target is one of the pad's top-level lines (it can be pinned)
  pinned: boolean   // every such target is pinned already (so Pin reads Unpin)
}

// `hour`: the rows are an open hour's lines. Its own lines, at the root, have no order to
// change (an hour lists them as the pads have them), so up, down and top are off for them.
// Pinned lines move only among the pins, and the others only under them (core's pins.ts).
export function lineAbilities(
  rows: Rows, ids: readonly string[], hour: boolean = usePad.getState().slotId !== null, zoomed: boolean = usePad.getState().zoomId !== null,
): LineAbilities {
  const index = buildIndex(rows)
  const tops = topmost(index, ids)
  const set = new Set(tops)
  const pads = !hour && !zoomed
  const can: LineAbilities = { indent: false, dedent: false, up: false, down: false, children: false, folded: false, single: tops.length === 1, mixed: false, hour, pads, pin: false, pinned: false }
  let open = false
  let unpinned = false
  for (const id of tops) {
    const parent = index.parentOf.get(id) ?? null
    const sibs = childrenOf(index, parent)
    const i = sibs.findIndex((s) => s.id === id)
    const ordered = !(hour && parent === null)
    const pinned = rows[id]!.pinned
    const before = sibs.slice(0, i).filter((s) => !set.has(s.id))
    if (before.length) { can.indent = true; if (ordered && before.some((s) => s.pinned === pinned)) can.up = true }
    if (ordered && sibs.slice(i + 1).some((s) => !set.has(s.id) && s.pinned === pinned)) can.down = true
    if (pads && parent === null && !rows[id]!.pad) { can.pin = true; if (!pinned) unpinned = true }
    if (parent !== null) can.dedent = true
    const kids = childrenOf(index, id)
    if (kids.length > 0) {
      can.children = true
      if (kids.some((k) => k.done) && kids.some((k) => !k.done)) can.mixed = true
      if (!rows[id]?.collapsed) open = true
    }
  }
  can.folded = can.children && !open
  can.pinned = can.pin && !unpinned
  return can
}

export type LineActionGroup = 'mark' | 'add' | 'move' | 'tree' | 'clip' | 'pad' | 'remove'

// The icons the toolbars draw. 'move' is also the Sort mode's icon in the top bar, and the
// "Move to…" menu's button.
export type LineIcon = 'addAbove' | 'addBelow' | 'dedent' | 'indent' | 'down' | 'up' | 'top' | 'fold' | 'unfold' | 'copy' | 'cut' | 'pasteAbove' | 'pasteBelow' | 'move' | 'archive' | 'hour' | 'category' | 'more'

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
  // Drawn floating above the bar instead of on it (see the header).
  floats?: boolean
  enabled?: (can: LineAbilities) => boolean
  // Where the action is offered at all: absent means everywhere. "Out of this hour" is only
  // in an open hour, "Make pad" everywhere but there.
  offered?: (can: LineAbilities) => boolean
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
  { id: 'done', group: 'mark', label: 'Done', name: 'Done', hint: 'Cross out', keys: '⌘Enter', floats: true, run: cmdToggleDone },
  { id: 'addAbove', group: 'add', label: '+ above', name: 'Add a line above', hint: 'New line above', icon: 'addAbove', run: cmdAddAbove },
  { id: 'addBelow', group: 'add', label: '+ below', name: 'Add a line below', hint: 'New line below', icon: 'addBelow', run: cmdAddBelow },
  { id: 'dedent', group: 'move', label: '←', name: 'Outdent', hint: 'Outdent', icon: 'dedent', keys: 'Shift+Tab', enabled: (c) => c.dedent, run: cmdDedent },
  { id: 'indent', group: 'move', label: '→', name: 'Indent', hint: 'Indent', icon: 'indent', keys: 'Tab', enabled: (c) => c.indent, run: cmdIndent },
  { id: 'down', group: 'move', label: '↓', name: 'Move down', hint: 'Move down', icon: 'down', keys: 'Alt+↓', enabled: (c) => c.down, run: () => cmdMove('down') },
  { id: 'up', group: 'move', label: '↑', name: 'Move up', hint: 'Move up', icon: 'up', keys: 'Alt+↑', enabled: (c) => c.up, run: () => cmdMove('up') },
  { id: 'top', group: 'move', label: 'Top', name: 'Move to top', hint: 'Move to the top of its level', icon: 'top', enabled: (c) => c.up, run: cmdMoveToTop },
  {
    // Kept at the top of the pad, above a divider; Move to top then stops under the pins.
    id: 'pin', group: 'move', label: 'Pin to top', name: 'Pin to top', hint: 'Pin to the top of the pad, above a divider', more: true,
    offered: (c) => c.pads, enabled: (c) => c.pin, run: () => cmdTogglePin(),
    flip: { when: (c) => c.pinned, label: 'Unpin', name: 'Unpin', hint: 'Unpin: it goes back to the top of the lines under the divider' },
  },
  {
    id: 'fold', group: 'tree', label: 'Fold', name: 'Fold', hint: 'Fold: hide its sub items', icon: 'fold', keys: '⌘.', enabled: (c) => c.children, run: cmdToggleCollapsed,
    flip: { when: (c) => c.folded, label: 'Unfold', name: 'Unfold', hint: 'Unfold: show its sub items', icon: 'unfold' },
  },
  { id: 'ungroup', group: 'tree', label: 'Ungroup', name: 'Ungroup', hint: 'Ungroup: its sub items come out to its own level', more: true, enabled: (c) => c.children, run: cmdUngroup },
  {
    id: 'splitOpen', group: 'tree', label: 'Split off open', name: 'Split off open', hint: 'Split off open: a copy of the line right below takes its open sub items, the done ones stay', more: true,
    enabled: (c) => c.mixed,
    run: () => {
      const n = cmdSplitOpen()
      return n ? undefined : 'Nothing to split: it needs both done and open sub items.'
    },
  },
  { id: 'copy', group: 'clip', label: 'Copy', name: 'Copy', hint: 'Copy as outline', icon: 'copy', keys: '⌘C', run: () => void cmdCopySelection() },
  { id: 'cut', group: 'clip', label: 'Cut', name: 'Cut', hint: 'Cut: copy as outline, then delete', icon: 'cut', keys: '⌘X', run: cmdCutSelection },
  { id: 'pasteAbove', group: 'clip', label: 'Paste above', name: 'Paste above', hint: 'Paste the clipboard as lines above', icon: 'pasteAbove', run: () => paste('above') },
  { id: 'pasteBelow', group: 'clip', label: 'Paste below', name: 'Paste below', hint: 'Paste the clipboard as lines below', icon: 'pasteBelow', run: () => paste('below') },
  { id: 'slot', group: 'pad', label: 'Hour…', name: 'Put in an hour', hint: 'Put in an hour of a day (Hours counts what is done there)', icon: 'hour', floats: true, run: cmdPickSlot },
  { id: 'category', group: 'pad', label: 'Category…', name: 'Give a category', hint: 'Give it one of Hours\' categories (its icon shows before the text)', icon: 'category', floats: true, run: cmdPickCategory },
  {
    // The lines leave the hour and stay where they are in their pads (the same as Hour…,
    // then No hour, in one press). The selection goes with them: they are out of view.
    id: 'outOfHour', group: 'pad', label: 'Out of this hour', name: 'Take out of this hour', hint: 'Take out of this hour: the line stays in its pad', more: true,
    offered: (c) => c.hour,
    run: () => {
      const n = cmdSetSlot(null)
      clearSelection()
      return n ? `Took ${lineCount(n)} out of the hour.` : undefined
    },
  },
  {
    id: 'makePad', group: 'pad', label: 'Make pad', name: 'Make pad', hint: 'Make this line a pad: its text is the name, its sub items the lines', more: true,
    // Not in an hour: a pad is not a line, so it would drop out of the hour it was made in.
    offered: (c) => !c.hour,
    enabled: (c) => c.single,
    run: () => {
      const res = cmdLineToPad()
      return res ? `“${res.name}” is a pad now.` : undefined
    },
  },
  { id: 'delete', group: 'remove', label: 'Archive', name: 'Archive', hint: 'Archive (undo brings it back)', icon: 'archive', keys: 'Backspace', danger: true, run: cmdDeleteSelection },
]

// The actions offered for these targets, in order: what both toolbars draw from.
export function lineActions(can: LineAbilities): readonly LineAction[] {
  return LINE_ACTIONS.filter((a) => !a.offered || a.offered(can))
}

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
