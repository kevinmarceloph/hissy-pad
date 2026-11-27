// Test helpers shared by this package's tests and the apps' tests: a fresh in-memory
// LocalStore holding an outline (at the root, which is the Inbox), and the store back at its
// initial state. Call loadPad() (or mount the app) afterwards; it makes Today and Later.
import { boomerangGroups, createMemoryStore, fixedPadOf, listPads, pad, scopePad, shape, type Rows } from '@hissypad/core'
import { configureLocalStore, usePad } from './store'
import { useSort } from './sort'

// The whole table as one outline, for tests: the Inbox's lines, then each pad in root order
// as "@Name" with its lines indented under it, then what is out on a boomerang. Today and Later are left out while empty:
// every store has them, so a test only sees them once something is in them.
export function tableShape(all: Rows = usePad.getState().all): string {
  const parts: string[] = []
  if (Object.keys(scopePad(all, null)).length) parts.push(shape(scopePad(all, null)))
  for (const p of listPads(all)) {
    const scoped = scopePad(all, p.id)
    const empty = Object.keys(scoped).length === 0
    if (empty && fixedPadOf(all, p.id)) continue
    parts.push(`@${p.text}` + (empty ? '' : '\n' + shape(scoped).split('\n').map((l) => `  ${l}`).join('\n')))
  }
  // What is out on a boomerang, by day: ">2026-12-01 text" lines after the pads.
  for (const g of boomerangGroups(all)) for (const r of g.lines) parts.push(`>${g.due} ${r.text}`)
  return parts.join('\n')
}

export function resetStore(outline?: string) {
  const mem = createMemoryStore(Object.values(outline ? pad(outline) : {}))
  configureLocalStore(mem)
  usePad.setState({
    all: {}, rows: {}, padId: null, zoomId: null, slotId: null, catId: null, load: 'loading', storageError: null, editing: null,
    selection: [], anchorId: null, focusId: null, past: [], future: [], session: null, sync: null,
  })
  useSort.setState({ left: null, right: null }, true)
  return mem
}
