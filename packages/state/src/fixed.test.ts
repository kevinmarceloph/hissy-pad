// The fixed pads in the store: Today, Inbox and Later replace the root-level Main pad.
import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeRemote, findFixedPad, listPads, shape } from '@hissypad/core'
import { resetStore } from './testing'
import { loadPad, openPad, usePad } from './store'
import { cmdDeletePad, cmdMovePad, cmdNewPad, cmdPadToLine, cmdRenamePad, padList, placeList } from './pads'
import { startSync, stopSync } from './sync'
import { SAMPLE_OUTLINE } from './sample'

const all = () => usePad.getState().all
const inbox = () => findFixedPad(all(), 'Inbox')!.id

async function flush(n = 30) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('fixed pads', () => {
  beforeEach(async () => {
    stopSync()
    resetStore('A\nB\n  B1', { fixed: true })
    await loadPad()
  })

  it('on load, Main’s lines move to the top of the Inbox, which opens; the tabs are Today, Inbox, Later', () => {
    expect(usePad.getState().padId).toBe(inbox())
    expect(shape(usePad.getState().rows)).toBe('A\nB\n  B1')
    expect(padList(all()).map((p) => [p.name, p.fixed])).toEqual([['Today', 'Today'], ['Inbox', 'Inbox'], ['Later', 'Later']])
    expect(placeList(all()).map((p) => p.key)).not.toContain('main')
    // Not an undo step: there is nothing to undo.
    expect(usePad.getState().past).toHaveLength(0)
  })

  it('a fixed pad is not renamed, moved, folded in or deleted; other pads come after them', () => {
    const today = findFixedPad(all(), 'Today')!.id
    const work = cmdNewPad('Work')
    const ideas = cmdNewPad('Ideas')
    cmdRenamePad(today, 'Tomorrow')
    expect(cmdMovePad(today, 1)).toBe(false)
    expect(cmdPadToLine(today, { padId: work, subId: null })).toBeNull()
    expect(cmdDeletePad(today)).toBe(0)
    expect(padList(all()).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'Work', 'Ideas'])
    expect(cmdMovePad(ideas, -1)).toBe(true)
    expect(cmdMovePad(ideas, -1)).toBe(false)
    expect(padList(all()).map((p) => p.name)).toEqual(['Today', 'Inbox', 'Later', 'Ideas', 'Work'])
  })

  it('deleting the pad shown opens the Inbox', () => {
    const work = cmdNewPad('Work')
    expect(usePad.getState().padId).toBe(work)
    cmdDeletePad(work)
    expect(usePad.getState().padId).toBe(inbox())
  })

  it('a line that reaches the root through sync (the watch, an older build) is moved to the Inbox', async () => {
    const remote = createFakeRemote()
    const now = Date.now() + 1000
    remote.rows.set('r1', { row: { id: 'r1', parentId: null, rank: 'a0', text: 'from the watch', done: false, doneAt: null, collapsed: false, numbered: false, header: false, pad: false, deletedAt: null, updatedAt: now } as never, syncedAt: new Date(1_700_000_000_000).toISOString() })
    startSync(remote)
    await flush(60)
    expect(all().r1).toMatchObject({ parentId: inbox() })
    stopSync()
  })

  it('a first visit puts the welcome lines in a new Inbox', async () => {
    resetStore(undefined, { fixed: true })
    await loadPad()
    expect(listPads(all()).map((p) => p.text)).toEqual(['Today', 'Inbox', 'Later'])
    expect(usePad.getState().padId).toBe(inbox())
    expect(shape(usePad.getState().rows).split('\n')[0]).toBe(SAMPLE_OUTLINE.split('\n')[0])
    openPad(null)
    expect(usePad.getState().rows).toEqual({})
  })
})
