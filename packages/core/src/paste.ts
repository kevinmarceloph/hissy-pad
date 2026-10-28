// Outline text <-> rows. The import side is how the Google Docs inbox moves over: Docs
// copies a nested list as lines with leading tabs or spaces and a bullet glyph per level
// (•, ○, ■, -, *, 1.). The export side is for copying a subtree back out as plain text.
import type { OpCtx, Rows } from './types'
import { ranksBetween } from './rank'
import { allocateRanks, buildIndex, childrenOf, flatten, listNumbers, topmost } from './tree'
import type { Placement } from './ops'

export interface OutlineLine {
  text: string
  depth: number
  numbered?: boolean // the line carried a "1." style marker
}

const BULLET = /^(?:[-*+•◦○●■▪►]|(\d{1,3})[.)]|[a-z][.)])(?:\s+|$)/u
const TAB_WIDTH = 4

function indentWidth(line: string): number {
  let w = 0
  for (const c of line) {
    if (c === ' ') w += 1
    else if (c === '\t') w += TAB_WIDTH - (w % TAB_WIDTH)
    else break
  }
  return w
}

// Depth comes from an indent stack (like a Python lexer), so 2-space, 4-space and tab
// indents all work as long as each file is consistent with itself. Blank lines become
// blank root nodes (spacers), runs of blanks collapse to one, and leading/trailing blanks
// are dropped.
export function parseOutline(text: string): OutlineLine[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: OutlineLine[] = []
  const stack: number[] = [0]
  for (const raw of lines) {
    const trimmedEnd = raw.replace(/\s+$/u, '')
    if (trimmedEnd.trim() === '') {
      if (out.length > 0 && out.at(-1)!.text !== '') out.push({ text: '', depth: 0 })
      continue
    }
    const w = indentWidth(trimmedEnd)
    while (stack.length > 1 && w < stack.at(-1)!) stack.pop()
    if (w > stack.at(-1)!) stack.push(w)
    const depth = stack.length - 1
    const stripped = trimmedEnd.trimStart()
    const m = BULLET.exec(stripped)
    const body = m ? stripped.slice(m[0].length) : stripped
    const line: OutlineLine = { text: body, depth }
    if (m?.[1] !== undefined) line.numbered = true
    out.push(line)
  }
  while (out.length > 0 && out.at(-1)!.text === '') out.pop()
  return out
}

// Insert parsed lines at a placement. depth 0 lines become siblings at the placement,
// deeper lines nest under the nearest shallower line above them (a jump of more than one
// level is clamped, so a ragged paste never loses a line).
export function insertOutline(
  rows: Rows,
  ctx: OpCtx,
  lines: readonly OutlineLine[],
  p: Placement,
): { rows: Rows; ids: string[] } {
  if (lines.length === 0) return { rows, ids: [] }
  const index = buildIndex(rows)

  // Pass 1: resolve each line's parent (line index, or -1 for the placement parent).
  const parentLine: number[] = []
  const lastAtDepth: number[] = []
  let prevDepth = -1
  lines.forEach((l, i) => {
    const depth = Math.min(l.depth, prevDepth + 1)
    parentLine.push(depth === 0 ? -1 : lastAtDepth[depth - 1]!)
    lastAtDepth[depth] = i
    lastAtDepth.length = depth + 1
    prevDepth = depth
  })

  // Pass 2: one rank run per parent, so siblings get evenly split ranks.
  const counts = new Map<number, number>()
  for (const pl of parentLine) counts.set(pl, (counts.get(pl) ?? 0) + 1)
  const ranks = new Map<number, string[]>()
  const out: Record<string, Rows[string]> = { ...rows }
  for (const [pl, n] of counts) {
    if (pl === -1) {
      const sibs = childrenOf(index, p.parentId)
      const alloc = allocateRanks(sibs, p.afterId, n)
      ranks.set(pl, alloc.ranks)
      for (const f of alloc.fixes) out[f.id] = { ...out[f.id]!, rank: f.rank, updatedAt: ctx.now() }
    } else {
      ranks.set(pl, ranksBetween(null, null, n))
    }
  }

  const ids: string[] = []
  const used = new Map<number, number>()
  lines.forEach((l, i) => {
    const pl = parentLine[i]!
    const k = used.get(pl) ?? 0
    used.set(pl, k + 1)
    const id = ctx.newId()
    ids.push(id)
    out[id] = {
      id,
      parentId: pl === -1 ? p.parentId : ids[pl]!,
      rank: ranks.get(pl)![k]!,
      text: l.text,
      done: false,
      collapsed: false,
      numbered: l.numbered === true,
      updatedAt: ctx.now(),
      deletedAt: null,
    }
  })
  return { rows: out, ids }
}

export interface OutlineFormat {
  bullet?: string // prefix per line, default '- '
  indent?: string // per depth, default two spaces
  done?: string   // suffix for done nodes, default ' (done)'
}

// Plain-text outline of the given nodes (topmost only, with their subtrees), relative to
// the shallowest one. Numbered lines keep their "1. " marker so the list survives a round
// trip. Collapsed state is ignored: copy gives you everything.
export function toOutline(rows: Rows, ids: Iterable<string>, fmt: OutlineFormat = {}): string {
  const bullet = fmt.bullet ?? '- '
  const indent = fmt.indent ?? '  '
  const doneMark = fmt.done ?? ' (done)'
  const index = buildIndex(rows)
  const numbers = listNumbers(index)
  const mark = (id: string) => (numbers.has(id) ? `${numbers.get(id)}. ` : bullet)
  const lines: string[] = []
  for (const top of topmost(index, ids)) {
    const self = rows[top]!
    lines.push(mark(top) + self.text + (self.done ? doneMark : ''))
    for (const r of flatten(index, false, top)) {
      const row = rows[r.id]!
      lines.push(indent.repeat(r.depth + 1) + mark(r.id) + row.text + (row.done ? doneMark : ''))
    }
  }
  return lines.join('\n')
}
