// Recently done (live crossed-out rows, newest first) over the whole table, so a line in
// another pad is found too, and the helpers the lists share (day headings, a row's pad).
// The Archive has its own file, archive.ts. Pure selectors plus the command the panel
// needs; both platforms render these, and nothing here knows about the DOM or React Native.
import { isBlank, isPadNode, setDone, type NodeRow, type PadId, type Rows } from '@hissypad/core'
import { applyAll, usePad } from './store'

export interface DoneEntry {
  id: string
  text: string
  doneAt: string // doneAt, or updatedAt for rows crossed out before the column existed
  childCount: number
}

const ms = (iso: string) => Date.parse(iso)
// isPadNode is a type guard; as a plain predicate it would narrow the other branch to never.
const padNode = (r: NodeRow): boolean => isPadNode(r)

export function doneAtOf(r: NodeRow): string {
  return r.doneAt ?? r.updatedAt
}

export function doneEntries(rows: Rows = usePad.getState().all): DoneEntry[] {
  const kids = new Map<string, number>()
  for (const r of Object.values(rows)) if (r.deletedAt === null && r.parentId !== null && !isBlank(r)) kids.set(r.parentId, (kids.get(r.parentId) ?? 0) + 1)
  return Object.values(rows)
    .filter((r) => r.deletedAt === null && r.done && !padNode(r))
    .sort((a, b) => ms(doneAtOf(b)) - ms(doneAtOf(a)) || (a.id < b.id ? -1 : 1))
    .map((r) => ({ id: r.id, text: r.text, doneAt: doneAtOf(r), childCount: kids.get(r.id) ?? 0 }))
}

// Ancestors of `id` that are live but folded, so the restored row is on screen. Stops at
// a pad node: a pad is a container, not a line that folds.
export function foldedAncestors(all: Rows, id: string): string[] {
  const out: string[] = []
  let cur = all[id]?.parentId ?? null
  while (cur !== null) {
    const p = all[cur]
    if (!p || p.deletedAt !== null || padNode(p)) break
    if (p.collapsed) out.push(cur)
    cur = p.parentId
  }
  return out
}

// The pad a live row shows in: the pad node at the top of its parent chain, else main.
// A row whose chain breaks (a deleted parent) is an orphan and shows in the main pad.
export function padOf(all: Rows, id: string): PadId {
  let cur = all[id]
  while (cur && cur.parentId !== null) {
    const p = all[cur.parentId]
    if (!p || p.deletedAt !== null) return null
    cur = p
  }
  return cur && isPadNode(cur) && cur.id !== id ? cur.id : null
}

// Un-cross one line from the Done list, whichever pad it is in. Children are left as they are.
export function cmdUndone(id: string) {
  applyAll((all, ctx) => setDone(all, ctx, [id], false), { label: 'cmdUndone' })
}

// "Today", "Yesterday", then a date, for the day headings both panels draw. Local time.
export function dayLabel(iso: string, now: number = Date.now()): string {
  const d = new Date(iso)
  const today = new Date(now)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(undefined, opts)
}

export interface DayGroup<T> {
  label: string
  items: T[]
}

// Items already sorted newest first, bucketed by local day in that order.
export function groupByDay<T>(items: readonly T[], at: (t: T) => string, now: number = Date.now()): DayGroup<T>[] {
  const out: DayGroup<T>[] = []
  for (const it of items) {
    const label = dayLabel(at(it), now)
    const g = out.at(-1)
    if (g && g.label === label) g.items.push(it)
    else out.push({ label, items: [it] })
  }
  return out
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// The first line of a row's text, for the one-line entries the panels list.
export function firstLine(text: string): string {
  const line = text.split('\n')[0]!.trim()
  return line === '' ? '(blank line)' : line
}

// "+2 lines under it", or null when there are none.
export function underLabel(n: number): string | null {
  return n > 0 ? `+${n} ${n === 1 ? 'line' : 'lines'} under it` : null
}
