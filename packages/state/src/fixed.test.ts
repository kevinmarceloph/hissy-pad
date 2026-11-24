// The fixed tabs in the store: Today, Inbox (the root level) and Later.
import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeRemote, createPad, findFixedPad, insertAt, listPads, shape, testCtx, type NodeRow } from '@hissypad/core'
import { resetStore } from './testing'
import { configureLocalStore, loadPad, openPad, PAD_KEY, usePad } from './store'
import { cmdDeletePad, cmdMovePad, cmdNewPad, cmdPadToLine, cmdRenamePad, padList } from './pads'
import { startSync, stopSync } from './sync'
import { SAMPLE_OUTLINE } from './sample'
import { createMemoryStore } from '@hissypad/core'

const all = () => usePad.getState().all
const today = () => findFixedPad(all(), 'Today')!.id

async function flush(n = 30) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('fixed tabs', () => {
  beforeEach(async () => {
    stopSync()
    resetStore('A\nB\n  B1')
    await loadPad()
  })

  it('load makes Today and Later; the root stays the Inbox and opens; none of it is an undo step', () => {
    expect(usePad.getState().padId).toBeNull()
    expect(shape(usePad.getState().rows)).toBe('A\nB\n  B1')
    expect(padList(all()).map((p) => [p.id === null ? 'root' : 'row', p.name, p.fixed])).toEqual([
      ['row', 'Today', 'Today'], ['root', 'Inbox', 'Inbox'], ['row', 'Later', 'Later'],
    ])
    expect(usePad.getState().past).toHaveLength(0)
  })

  it('a fixed tab is not renamed, moved, folded in or archived, and its name cannot be taken', () => {
    const work = cmdNewPad('Work')
    const ideas = cmdNewPad('Ideas')
    cmdRenamePad(today(), 'Tomorrow')
    cmdRenamePad(work, 'later')
    expect(cmdMovePad(today(), 1)).toBe(false)
    expect(cmdPadToLine(today(), { padId: work, subId: null })).toBeNull()
    expect(cmdDeletePad(today())).toBe(0)
    expect(padList(all()).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'Work', 'Ideas'])
    // A new pad with a fixed name opens that tab instead of making a second one.
    expect(cmdNewPad(' TODAY ')).toBe(today())
    expect(usePad.getState().padId).toBe(today())
    expect(cmdNewPad('inbox')).toBe('')
    expect(usePad.getState().padId).toBeNull()
    expect(listPads(all())).toHaveLength(4)
    // The other pads reorder among themselves, after the fixed ones.
    expect(cmdMovePad(ideas, -1)).toBe(true)
    expect(cmdMovePad(ideas, -1)).toBe(false)
    expect(padList(all()).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'Ideas', 'Work'])
  })

  it('a device with a pad named Inbox (from the widget, or the first version of this) gets its lines in the root, and the root opens', async () => {
    const ctx = testCtx()
    let rows = createPad({}, ctx, 'Inbox').rows
    const inbox = listPads(rows)[0]!.id
    rows = insertAt(rows, ctx, { parentId: inbox, afterId: null }, 'milk').rows
    rows = insertAt(rows, ctx, { parentId: null, afterId: null }, 'old main line').rows
    const mem = createMemoryStore(Object.values(rows))
    await mem.setMeta(PAD_KEY, inbox)
    configureLocalStore(mem)
    usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading', past: [], future: [] })
    await loadPad()
    expect(usePad.getState().padId).toBeNull()
    expect(shape(usePad.getState().rows)).toBe('old main line\nmilk')
    expect(padList(all()).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later'])
  })

  it('a pad named Inbox that arrives by sync is folded into the root', async () => {
    const remote = createFakeRemote()
    const at = Date.now() + 1000
    const row = (r: Partial<NodeRow> & { id: string }): NodeRow => ({ parentId: null, rank: 'a0', text: '', done: false, doneAt: null, collapsed: false, numbered: false, header: false, pad: false, deletedAt: null, updatedAt: at, ...r } as NodeRow)
    remote.rows.set('p', { row: row({ id: 'p', text: 'Inbox', pad: true, rank: 'z0' }), syncedAt: new Date(1_700_000_000_000).toISOString() })
    remote.rows.set('l', { row: row({ id: 'l', parentId: 'p', text: 'from another device' }), syncedAt: new Date(1_700_000_000_001).toISOString() })
    startSync(remote)
    await flush(60)
    expect(all().l).toMatchObject({ parentId: null })
    expect(all().p!.deletedAt).not.toBeNull()
    stopSync()
  })

  it('a first visit puts the welcome lines in the Inbox, with Today and Later beside it', async () => {
    resetStore()
    await loadPad()
    expect(listPads(all()).map((p) => p.text)).toEqual(['Today', 'Later'])
    expect(usePad.getState().padId).toBeNull()
    expect(shape(usePad.getState().rows).split('\n')[0]).toBe(SAMPLE_OUTLINE.split('\n')[0])
    openPad(today())
    expect(usePad.getState().rows).toEqual({})
  })
})
