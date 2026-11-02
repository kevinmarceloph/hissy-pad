import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryStore, pad, shape, idOf, listPads } from '@hissypad/core'
import { configureLocalStore, loadPad, openPad, redo, select, undo, usePad } from './store'
import { cmdDeleteDone, cmdDeleteSelection, cmdIndent, cmdSetText, cmdSplit } from './commands'
import { archiveNameFor, cmdDeletePad, cmdFreshStart, cmdMoveToPad, cmdNewPad, cmdRenamePad, padList } from './pads'
import { importOutline } from './store'

function reset(initialOutline?: string) {
  const rows = initialOutline ? pad(initialOutline) : {}
  const mem = createMemoryStore(Object.values(rows))
  configureLocalStore(mem)
  usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [] })
  return mem
}

const shown = () => shape(usePad.getState().rows)
const main = () => shape(usePad.getState().rows)

describe('pads in the store', () => {
  let mem: ReturnType<typeof reset>
  beforeEach(async () => {
    mem = reset('A\nB\n  B1\nC')
    await loadPad()
  })

  it('a new pad opens empty, is listed after main, and edits in it land under the pad node', async () => {
    const w = cmdNewPad('Work')
    expect(usePad.getState().padId).toBe(w)
    expect(shown()).toBe('') // one blank line, being edited
    expect(Object.keys(usePad.getState().rows)).toHaveLength(1)
    expect(usePad.getState().editing?.id).toBe(Object.keys(usePad.getState().rows)[0])
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Main', 'Work'])
    const ids = importOutline('one\n\ttwo', 'top')
    expect(shown()).toBe('one\n  two\n')
    // In table terms the top line hangs under the pad node.
    expect(usePad.getState().all[ids[0]!]!.parentId).toBe(w)
    await Promise.resolve()
    expect(mem.rows.get(ids[0]!)!.parentId).toBe(w)
    expect(await mem.getMeta('pad.current')).toBe(w)
    openPad(null)
    expect(main()).toBe('A\nB\n  B1\nC')
    expect(await mem.getMeta('pad.current')).toBe('')
  })

  it('ops inside a pad stay inside it: indent, split, Delete done, delete the last line', () => {
    cmdNewPad('Work')
    const blank = Object.keys(usePad.getState().rows)[0]!
    const ids = importOutline('x\ny', 'top')
    select([blank], blank)
    cmdDeleteSelection()
    expect(shown()).toBe('x\ny')
    select([ids[1]!], ids[1]!)
    cmdIndent()
    expect(shown()).toBe('x\n  y')
    cmdSplit(ids[0]!, 1) // the tail becomes the first child, since x shows children
    expect(shown()).toBe('x\n  \n  y')
    select([ids[0]!], ids[0]!)
    cmdDeleteSelection()
    expect(shown()).toBe('')
    // The whole pad gone leaves one blank line to type into, inside the pad.
    const left = Object.values(usePad.getState().rows)
    expect(left).toHaveLength(1)
    expect(usePad.getState().all[left[0]!.id]!.parentId).toBe(usePad.getState().padId)
    cmdSetText(left[0]!.id, 'done one')
    expect(cmdDeleteDone()).toBe(0)
    openPad(null)
    expect(main()).toBe('A\nB\n  B1\nC')
  })

  it('rename and delete; deleting the open pad falls back to main; undo brings it back', () => {
    const w = cmdNewPad('Work')
    importOutline('w1\nw2', 'top')
    cmdRenamePad(w, 'Werk')
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Main', 'Werk'])
    expect(cmdDeletePad(w)).toBe(3) // w1, w2 and the blank first line
    expect(usePad.getState().padId).toBeNull()
    expect(listPads(usePad.getState().all)).toEqual([])
    undo()
    expect(listPads(usePad.getState().all).map((r) => r.text)).toEqual(['Werk'])
    expect(openPad(w)).toBe(true)
    expect(shown()).toBe('w1\nw2\n')
    redo()
    expect(usePad.getState().padId).toBeNull() // setAll via undo keeps us on main
  })

  it('move to pad takes the selection with subtrees to the top of the other pad', () => {
    const w = cmdNewPad('Work')
    importOutline('w1', 'top')
    openPad(null)
    const b = idOf(usePad.getState().rows, 'B')
    select([b], b)
    expect(cmdMoveToPad(w)).toBe(2)
    expect(main()).toBe('A\nC')
    expect(usePad.getState().selection).toEqual([])
    openPad(w)
    expect(shown()).toBe('B\n  B1\nw1\n')
    // Back to main, at the top.
    const w1 = idOf(usePad.getState().rows, 'w1')
    select([w1], w1)
    expect(cmdMoveToPad(null)).toBe(1)
    openPad(null)
    expect(main()).toBe('w1\nA\nC')
    // Same pad: nothing happens.
    select([w1], w1)
    expect(cmdMoveToPad(null)).toBe(0)
    // Moving everything out leaves one blank line behind.
    const vis = Object.keys(usePad.getState().rows)
    select(vis, vis[0]!, vis.at(-1)!)
    expect(cmdMoveToPad(w)).toBe(3)
    expect(Object.values(usePad.getState().rows).map((r) => r.text)).toEqual([''])
  })

  it('fresh start keeps the right side here, archives the left into a dated pad, one undo step', () => {
    const rows = usePad.getState().rows
    const sides = { right: new Set([idOf(rows, 'B')]), left: new Set<string>() }
    const name = archiveNameFor(usePad.getState().all, null, new Date('2026-11-02T10:00:00+08:00'))
    expect(name).toBe('Before 2 Nov 2026')
    const res = cmdFreshStart(sides, name)
    expect(res.moved).toBe(2)
    expect(main()).toBe('B\n  B1')
    expect(padList(usePad.getState().all).map((p) => p.name)).toEqual(['Main', 'Before 2 Nov 2026'])
    openPad(res.archiveId)
    expect(shown()).toBe('A\nC')
    openPad(null)
    undo()
    expect(main()).toBe('A\nB\n  B1\nC')
    expect(listPads(usePad.getState().all)).toEqual([])
  })

  it('a remembered pad reopens on load; a missing one falls back to main', async () => {
    const w = cmdNewPad('Work')
    importOutline('w1', 'top')
    await Promise.resolve()
    usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading', past: [], future: [] })
    await loadPad()
    expect(usePad.getState().padId).toBe(w)
    expect(shown()).toBe('w1\n')
    await mem.setMeta('pad.current', 'gone')
    usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading' })
    await loadPad()
    expect(usePad.getState().padId).toBeNull()
  })
})
