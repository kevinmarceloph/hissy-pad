// Deterministic ctx + outline-based pad builder for tests. Exported from the package so
// apps/web and apps/mobile tests can build pads the same way.
import type { OpCtx, Rows } from './types'
import { buildIndex, flatten, listNumbers } from './tree'
import { insertOutline, parseOutline } from './paste'

export function testCtx(): OpCtx & { reset(): void } {
  let id = 0
  let t = Date.parse('2026-10-28T00:00:00.000Z')
  return {
    newId: () => `n${++id}`,
    now: () => new Date(++t).toISOString(),
    reset() {
      id = 0
    },
  }
}

// Build a pad from an indented outline. Ids are n1, n2, ... in line order.
export function pad(outline: string, ctx: OpCtx = testCtx()): Rows {
  return insertOutline({}, ctx, parseOutline(outline), { parentId: null, afterId: null }).rows
}

// Render a pad back to an indented outline of texts (all nodes, ignoring collapse),
// so a test can assert the whole shape in one string.
export function shape(rows: Rows, visibleOnly = false): string {
  const index = buildIndex(rows)
  const numbers = listNumbers(index)
  return flatten(index, visibleOnly)
    .map((r) => {
      const row = rows[r.id]!
      const num = numbers.has(r.id) ? `${numbers.get(r.id)}.` : row.header ? '#' : ''
      return '  '.repeat(r.depth) + num + (row.done ? '~' : '') + row.text
    })
    .join('\n')
}

// Find a node id by exact text (first match in document order).
export function idOf(rows: Rows, text: string): string {
  const hit = flatten(buildIndex(rows), false).find((r) => rows[r.id]!.text === text)
  if (!hit) throw new Error(`no node with text ${JSON.stringify(text)}`)
  return hit.id
}
