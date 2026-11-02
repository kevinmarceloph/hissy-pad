// The two list views over the table: Trash (tombstoned rows from the last 30 days, grouped
// by the delete that removed them) and Recently done (live crossed-out rows, newest
// first). Both read `all` (every pad, tombstones included), so a line deleted in another
// pad is still found. Pure selectors plus the two commands the panels need; both
// platforms render these, and nothing here knows about the DOM or React Native.
import { isPadNode, restore, setCollapsed, setDone, type NodeRow, type PadId, type Rows } from '@hissypad/core'
import { applyAll, openPad, select, usePad } from './store'

export const TRASH_DAYS = 30
// Rows deleted this close together count as one delete. `remove` stamps a whole call
// with one timestamp; rows from builds before that are a millisecond or so apart.
const BATCH_GAP_MS = 1000

export interface TrashEntry {
  id: string
  text: string
  deletedAt: string
  childCount: number // rows under it that went in the same delete (and come back with it)
}

export interface TrashBatch {
  deletedAt: string      // the newest stamp in the batch
  entries: TrashEntry[]  // top-level rows of the delete, in text order of the pad they left
  count: number          // every row in the batch, children included
}

export interface DoneEntry {
  id: string
  text: string
  doneAt: string // doneAt, or updatedAt for rows crossed out before the column existed
  childCount: number
}

const ms = (iso: string) => Date.parse(iso)
// isPadNode is a type guard; as a plain predicate it would narrow the other branch to never.
const padNode = (r: NodeRow): boolean => isPadNode(r)

// Blank spacers and the tombstones an undone Enter leaves behind are not worth a line in
// the trash, unless something was under them.
function worthListing(r: NodeRow, kids: number): boolean {
  return r.text.trim() !== '' || kids > 0
}

export function trashEntries(rows: Rows = usePad.getState().all, now: number = Date.now()): TrashBatch[] {
  const cutoff = now - TRASH_DAYS * 24 * 60 * 60 * 1000
  const dead = Object.values(rows)
    .filter((r): r is NodeRow & { deletedAt: string } => r.deletedAt !== null && ms(r.deletedAt) >= cutoff)
    .sort((a, b) => ms(a.deletedAt) - ms(b.deletedAt) || a.rank.localeCompare(b.rank) || (a.id < b.id ? -1 : 1))
  // Walk oldest to newest; a gap wider than BATCH_GAP_MS starts a new batch.
  const groups: (NodeRow & { deletedAt: string })[][] = []
  for (const r of dead) {
    const g = groups.at(-1)
    if (g && ms(r.deletedAt) - ms(g.at(-1)!.deletedAt) <= BATCH_GAP_MS) g.push(r)
    else groups.push([r])
  }
  const batches: TrashBatch[] = []
  for (const g of groups) {
    const inBatch = new Set(g.map((r) => r.id))
    const kids = new Map<string, number>()
    for (const r of g) {
      // Count r under every ancestor that is in the same batch.
      let cur = r.parentId
      while (cur !== null && inBatch.has(cur)) {
        kids.set(cur, (kids.get(cur) ?? 0) + 1)
        cur = rows[cur]!.parentId
      }
    }
    const entries = g
      .filter((r) => !(r.parentId !== null && inBatch.has(r.parentId)))
      .filter((r) => worthListing(r, kids.get(r.id) ?? 0))
      .map((r) => ({ id: r.id, text: r.text, deletedAt: r.deletedAt, childCount: kids.get(r.id) ?? 0 }))
    if (entries.length === 0) continue
    batches.push({ deletedAt: g.at(-1)!.deletedAt, entries, count: entries.reduce((n, e) => n + 1 + e.childCount, 0) })
  }
  return batches.reverse()
}

export function doneAtOf(r: NodeRow): string {
  return r.doneAt ?? r.updatedAt
}

export function doneEntries(rows: Rows = usePad.getState().all): DoneEntry[] {
  const kids = new Map<string, number>()
  for (const r of Object.values(rows)) if (r.deletedAt === null && r.parentId !== null) kids.set(r.parentId, (kids.get(r.parentId) ?? 0) + 1)
  return Object.values(rows)
    .filter((r) => r.deletedAt === null && r.done && !padNode(r))
    .sort((a, b) => ms(doneAtOf(b)) - ms(doneAtOf(a)) || (a.id < b.id ? -1 : 1))
    .map((r) => ({ id: r.id, text: r.text, doneAt: doneAtOf(r), childCount: kids.get(r.id) ?? 0 }))
}

// The rows that come back with an entry: itself plus every deleted descendant whose
// tombstone is from the same delete. A child deleted earlier on its own stays deleted.
function batchSubtree(rows: Rows, id: string): string[] {
  const root = rows[id]
  if (!root || root.deletedAt === null) return []
  const at = ms(root.deletedAt)
  const byParent = new Map<string | null, NodeRow[]>()
  for (const r of Object.values(rows)) {
    if (r.deletedAt === null || Math.abs(ms(r.deletedAt) - at) > BATCH_GAP_MS) continue
    const list = byParent.get(r.parentId)
    if (list) list.push(r)
    else byParent.set(r.parentId, [r])
  }
  const out: string[] = []
  const walk = (pid: string) => {
    out.push(pid)
    for (const c of byParent.get(pid) ?? []) walk(c.id)
  }
  walk(id)
  return out
}

// Ancestors of `id` that are live but folded, so the restored row is on screen. Stops at
// a pad node: a pad is a container, not a line that folds.
function foldedAncestors(all: Rows, id: string): string[] {
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

// Bring deleted lines back where they were, with the rows that went with them, then show
// the pad they are in and select them. Returns the restored top-level ids.
export function cmdRestore(ids: readonly string[]): string[] {
  const { all } = usePad.getState()
  const tops = ids.filter((id) => all[id] && all[id]!.deletedAt !== null)
  if (tops.length === 0) return []
  applyAll((all, ctx) => {
    const set = new Set<string>()
    for (const id of tops) for (const d of batchSubtree(all, id)) set.add(d)
    let out = restore(all, ctx, set)
    for (const id of tops) for (const a of foldedAncestors(out, id)) out = setCollapsed(out, ctx, a, false)
    return out
  }, { label: 'cmdRestore' })
  const after = usePad.getState()
  const target = padOf(after.all, tops[0]!)
  if (target !== after.padId) openPad(target)
  select(tops, tops[0]!, tops.at(-1)!)
  return tops
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
