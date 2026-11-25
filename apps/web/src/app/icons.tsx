// The app's icons, drawn in the ink of whatever holds them. Each sits in a button that
// carries the name (aria-label and title), so none of them is read out itself. The phone
// draws the same set with Views (apps/mobile/src/ui/LineIcons.tsx): change both together.
import type { ReactNode } from 'react'
import type { LineIcon as LineIconId } from '@hissypad/state'

export function Icon({ d, children }: { d?: string; children?: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d && <path d={d} />}
      {children}
    </svg>
  )
}

const LINE_ICONS: Record<LineIconId, ReactNode> = {
  // A new line (the plus and its stroke) over, or under, the two that are there.
  addAbove: <Icon d="M5 3v5M2.5 5.5h5M10.5 5.5h7M3 11h14M3 15.5h14" />,
  addBelow: <Icon d="M3 4.5h14M3 9h14M5 12v5M2.5 14.5h5M10.5 14.5h7" />,
  // Plain arrows, drawn like Move to top's: left and right (outdent, indent), down and up.
  dedent: <Icon d="M16 10H4.5M8.5 6l-4 4 4 4" />,
  indent: <Icon d="M4 10h11.5M11.5 6l4 4-4 4" />,
  down: <Icon d="M10 4v11.5M6 11.5l4 4 4-4" />,
  up: <Icon d="M10 16V4.5M6 8.5l4-4 4 4" />,
  // An arrow up to a bar.
  top: <Icon d="M4 3.5h12M10 17V7.5M6 11.5l4-4 4 4" />,
  // Two chevrons closing on each other; the same two opening.
  fold: <Icon d="M6 3.5l4 4 4-4M6 16.5l4-4 4 4" />,
  unfold: <Icon d="M6 7.5l4-4 4 4M6 12.5l4 4 4-4" />,
  // A sheet over its copy.
  copy: <Icon d="M6.5 6.5v-2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2"><rect x="3.5" y="6.5" width="10" height="10" rx="1" /></Icon>,
  cut: <Icon d="M7.6 12.6L14.5 3.5M12.4 12.6L5.5 3.5"><circle cx="6" cy="14.5" r="2.5" /><circle cx="14" cy="14.5" r="2.5" /></Icon>,
  // A clipboard with an arrow up, or down.
  pasteAbove: <Icon d="M7.5 4H5.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2M10 14.5v-5M7.5 11.5L10 9l2.5 2.5"><rect x="7.5" y="2.5" width="5" height="3" rx="0.5" /></Icon>,
  pasteBelow: <Icon d="M7.5 4H5.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2M10 9v5M7.5 12l2.5 2.5 2.5-2.5"><rect x="7.5" y="2.5" width="5" height="3" rx="0.5" /></Icon>,
  // An arrow into a tray: put it somewhere. Also the Sort mode.
  move: <Icon d="M3 11v4.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V11M10 3v9M6.5 8.5L10 12l3.5-3.5" />,
  // A box with a lid: put it away (the Archive).
  archive: <Icon d="M3 4.5h14v3H3zM4.5 7.5v8a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-8M8 10.5h4" />,
  // A clock: put it in an hour. Also the Hours mode.
  hour: <Icon d="M10 5.5V10l3 2"><circle cx="10" cy="10" r="7" /></Icon>,
  // A boomerang, bent at the top and thrown to the right: out until a later day.
  boomerang: <Icon><g transform="rotate(24 10 10)"><path d="M3 15.5C3 9.5 6 4 10 4s7 5.5 7 11.5c-2.6-3.4-4.8-5-7-5s-4.4 1.6-7 5z" /></g></Icon>,
  // A tag with its hole, point up and to the left: give it a category.
  category: <Icon><g transform="rotate(45 10 10)"><path d="M5.5 5.5H15a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H5.5L1 10z" /><circle cx="6" cy="10" r="1.3" /></g></Icon>,
  more: <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="4.5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15.5" cy="10" r="1.4" /></svg>,
}

export function LineIcon({ icon }: { icon: LineIconId }) {
  return LINE_ICONS[icon]
}

// Pad: an outline, three lines with their bullets.
export const PadIcon = () => <Icon d="M7.5 5h9M7.5 10h9M7.5 15h9M3.5 5h.01M3.5 10h.01M3.5 15h.01" />
// Hours: a clock.
export const HoursIcon = () => <LineIcon icon="hour" />
// Sort: a line on its way into a tray. The same icon as the toolbar's Move to….
export const SortIcon = () => <LineIcon icon="move" />
export const SearchIcon = () => <Icon d="M13 13l4 4"><circle cx="8.5" cy="8.5" r="5" /></Icon>
// New item: a plus.
export const PlusIcon = () => <Icon d="M10 4v12M4 10h12" />
export const MenuIcon = () => <Icon d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
// Later: a calendar page, rings at the top.
export const CalendarIcon = () => <Icon d="M3.5 8h13M7 2.5v3M13 2.5v3"><rect x="3.5" y="4" width="13" height="12.5" rx="1.5" /></Icon>
