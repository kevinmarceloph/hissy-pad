import { resetStore } from './testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, listPads, shape } from '@hissypad/core'
import { loadPad, openPad, usePad } from './store'
import { undo } from './history'
import { cmdNewPad } from './pads'
import { cmdSetKind } from './commands'
import {
  cmdSortAddSub, cmdSortBack, cmdSortNewTarget, sortSessionBack, sortSessionProgress, sortSessionSendLeftTo, sortSessionSendLeftToNew, sortSessionCard, sortSessionSend, sortSessionStart, sortSummary, swipeDir, cmdSortRemoveSub, cmdSortSend, cmdSortSetText, loadSortTargets, setSortTarget, sortQueue, sortTarget, useSort,
} from './sort'

const reset = resetStore

const all = () => usePad.getState().all
const whole = () => shape(all())
const id = (text: string) => idOf(all(), text)

describe('sort', () => {
  let mem: ReturnType<typeof reset>
  beforeEach(async () => {
    mem = reset('A\nB\n  B1\n\nC\nD')
    await loadPad()
  })

  it('queues the top-level lines, without spacers and crossed-out lines', () => {
    expect(sortQueue().map((i) => all()[i]!.text)).toEqual(['A', 'B', 'C', 'D'])
    cmdSortSend(id('C'), 'up')
    openPad(sortTarget(all(), 'right').padId)
    expect(sortQueue()).toEqual([])
  })

  it('left makes Later, right makes Today, up crosses out in Today; lines keep their order and subtrees', () => {
    expect(sortTarget(all(), 'left')).toMatchObject({ name: 'Later', exists: false })
    cmdSortSend(id('A'), 'left')
    cmdSortSend(id('B'), 'right')
    cmdSortSend(id('C'), 'up')
    cmdSortSend(id('D'), 'right')
    expect(whole()).toBe('\n@Later\n  A\n@Today\n  B\n    B1\n  ~C\n  D')
    expect(all()[id('C')]!.doneAt).not.toBeNull()
    expect(listPads(all())).toHaveLength(2)
    expect(sortTarget(all(), 'right')).toMatchObject({ name: 'Today', exists: true, isDefault: true })
  })

  it('each send is one undo step, pad creation included, and Back also drops edits made since', () => {
    const first = cmdSortSend(id('A'), 'right')!
    expect(usePad.getState().past).toHaveLength(1)
    cmdSortSetText(id('B'), 'B!')
    cmdSortBack(first)
    expect(whole()).toBe('A\nB\n  B1\n\nC\nD')
    cmdSortSend(id('A'), 'left')
    undo()
    expect(whole()).toBe('A\nB\n  B1\n\nC\nD')
  })

  it('the left side can point at a sub-pad: the line goes to the bottom of its lines, and the header is not sent into itself', () => {
    const b = id('B')
    usePad.setState({ selection: [b] })
    cmdSetKind('header')
    usePad.setState({ selection: [] })
    setSortTarget(b)
    expect(sortTarget(all(), 'left')).toMatchObject({ padId: null, subId: b, name: 'Main → B', exists: true })
    expect(cmdSortSend(id('A'), 'left')).toMatchObject({ pad: 'Main → B', moved: true })
    expect(cmdSortSend(id('C'), 'left')).toMatchObject({ moved: true })
    expect(cmdSortSend(b, 'left')).toMatchObject({ moved: false })
    expect(whole()).toBe('#B\n  B1\n  A\n  C\n\nD')
    // Turned back into a plain line, the choice falls back to the default.
    usePad.setState({ selection: [b] })
    cmdSetKind('plain')
    expect(sortTarget(all(), 'left')).toMatchObject({ name: 'Later', isDefault: true })
  })

  it('a chosen pad or Main is the target, remembered on the device; a deleted choice falls back', async () => {
    const work = cmdNewPad('Work')
    setSortTarget(work)
    cmdSortAddSub(Object.keys(usePad.getState().rows)[0]!, 'x') // nothing: blank parent still takes a sub item
    openPad(null)
    cmdSortSend(id('A'), 'left')
    expect(all()[id('A')]!.parentId).toBe(work)
    // Already in the target: stays put.
    setSortTarget('main')
    expect(cmdSortSend(id('C'), 'left')).toMatchObject({ moved: false, pad: 'Main' })
    expect(all()[id('C')]).toMatchObject({ parentId: null })
    expect(listPads(all()).map((p) => p.text)).toEqual(['Work'])
    setSortTarget(work)
    useSort.setState({ left: null })
    await loadSortTargets()
    expect(useSort.getState()).toEqual({ left: work })
    expect(await mem.getMeta('sort.left')).toBe(work)
    expect(sortTarget(all(), 'left', 'gone')).toMatchObject({ name: 'Later', isDefault: true })
  })

  it('sorting from inside a pad sends lines out of it', () => {
    cmdSortSend(id('A'), 'right')
    openPad(sortTarget(all(), 'right').padId)
    expect(sortQueue()).toHaveLength(1)
    cmdSortSend(id('A'), 'left')
    expect(whole()).toBe('B\n  B1\n\nC\nD\n@Today\n  \n@Later\n  A')
  })

  it('the card edits: text, a sub item at the bottom, removing one', () => {
    cmdSortSetText(id('B'), 'Bee')
    const sub = cmdSortAddSub(id('Bee'), ' B2 ')
    expect(cmdSortAddSub(id('Bee'), '   ')).toBe('')
    expect(whole()).toBe('A\nBee\n  B1\n  B2\n\nC\nD')
    cmdSortRemoveSub(sub)
    expect(whole()).toBe('A\nBee\n  B1\n\nC\nD')
    cmdSortSend(id('Bee'), 'right')
    expect(whole()).toBe('A\n\nC\nD\n@Today\n  Bee\n    B1')
  })

  it('a new pad made from the sort screen becomes the target and the pad being sorted stays open', () => {
    expect(cmdSortNewTarget('  ')).toBe('')
    const someday = cmdSortNewTarget(' Someday ')
    expect(usePad.getState().padId).toBeNull()
    expect(sortTarget(all(), 'left')).toMatchObject({ padId: someday, name: 'Someday', isDefault: false })
    cmdSortSend(id('A'), 'left')
    expect(all()[id('A')]!.parentId).toBe(someday)
    expect(listPads(all()).map((p) => p.text)).toEqual(['Someday'])
  })

  it('a session walks the queue, skips a card that left mid-sort, steps back, and sums up', () => {
    let session = sortSessionStart()
    expect(session.queue).toHaveLength(4)
    expect(sortSessionCard(session)).toEqual({ id: id('A'), index: 0 })
    session = sortSessionSend(session, 'left')
    session = sortSessionSend(session, 'up')
    expect(sortSessionCard(session)).toEqual({ id: id('C'), index: 2 })
    cmdSortSend(id('C'), 'right') // C leaves by another route (a sync, another screen)
    expect(sortSessionCard(session)).toEqual({ id: id('D'), index: 3 })
    session = sortSessionSend(session, 'skip')
    expect(sortSessionCard(session)).toEqual({ id: null, index: 4 })
    expect(sortSessionSend(session, 'left')).toBe(session) // no card: nothing happens
    expect(sortSummary(session)).toBe('1 done, 1 to Later, 1 skipped')
    session = sortSessionBack(session)
    expect(sortSessionCard(session).id).toBe(id('D'))
    expect(sortSessionBack(sortSessionStart())).toEqual(sortSessionStart())
    expect(sortSummary(sortSessionStart())).toBe('')
  })

  it('down deletes the card: the line and its children go to the Trash, and Back brings them back', () => {
    let session = sortSessionStart()
    const a = id('A')
    session = sortSessionSend(session, 'down')
    expect(all()[a]!.deletedAt).not.toBeNull()
    expect(session.sent.at(-1)).toMatchObject({ dir: 'down', moved: false })
    expect(listPads(all())).toHaveLength(0) // no pad is made for a delete
    expect(sortSummary(session)).toBe('1 deleted')
    session = sortSessionBack(session)
    expect(all()[a]!.deletedAt).toBeNull()
    expect(sortSessionCard(session).id).toBe(a)
  })

  it('right always goes to Today, whatever the left side points at', () => {
    setSortTarget('main')
    expect(sortTarget(all(), 'right')).toMatchObject({ name: 'Today', isDefault: true })
    expect(cmdSortSend(id('A'), 'right')).toMatchObject({ pad: 'Today', moved: true })
  })

  it('cycle moves the card to the bottom of the pad and deals it again at the end, still counted as one to go', () => {
    let session = sortSessionStart()
    expect(sortSessionProgress(session)).toEqual({ at: 1, total: 4, left: 4 })
    session = sortSessionSend(session, 'cycle')
    expect(whole()).toBe('B\n  B1\n\nC\nD\nA')
    expect(sortSessionCard(session).id).toBe(id('B'))
    expect(sortSessionProgress(session)).toEqual({ at: 1, total: 4, left: 4 })
    session = sortSessionSend(session, 'left')
    expect(sortSessionProgress(session)).toEqual({ at: 2, total: 4, left: 3 })
    session = sortSessionSend(session, 'skip')
    session = sortSessionSend(session, 'skip')
    expect(sortSessionCard(session).id).toBe(id('A')) // round again
    // The last line cycled stays where it is, and comes round once more.
    session = sortSessionSend(session, 'cycle')
    expect(sortSessionCard(session).id).toBe(id('A'))
    expect(whole()).toBe('\nC\nD\nA\n@Later\n  B\n    B1')
    session = sortSessionSend(session, 'right')
    expect(sortSessionCard(session).id).toBeNull()
    expect(sortSessionProgress(session)).toEqual({ at: 5, total: 4, left: 0 })
    expect(sortSummary(session)).toBe('1 to Today, 1 to Later, 2 skipped')
    // Back unwinds in order: the send, then each cycle, which also takes its copy off the queue.
    session = sortSessionBack(session)
    session = sortSessionBack(session)
    expect(session.queue).toHaveLength(5)
    session = sortSessionBack(session)
    session = sortSessionBack(session)
    session = sortSessionBack(session)
    session = sortSessionBack(session)
    expect(session.queue).toHaveLength(4)
    expect(sortSessionCard(session).id).toBe(id('A'))
    expect(whole()).toBe('A\nB\n  B1\n\nC\nD')
  })

  it('picking a left pad sends the card there; the tally names each pad a card went to', () => {
    const work = cmdNewPad('Work')
    openPad(null)
    let session = sortSessionStart()
    session = sortSessionSend(session, 'left')
    session = sortSessionSendLeftTo(session, work)
    expect(useSort.getState().left).toBe(work)
    expect(all()[id('B')]!.parentId).toBe(work)
    expect(sortSessionCard(session).id).toBe(id('C'))
    expect(sortSessionSendLeftToNew(session, '  ')).toBe(session)
    session = sortSessionSendLeftToNew(session, 'Someday')
    expect(sortTarget(all(), 'left').name).toBe('Someday')
    session = sortSessionSend(session, 'left')
    expect(sortSummary(session)).toBe('1 to Later, 1 to Work, 2 to Someday')
    // With nothing left to sort, picking only sets the target.
    expect(sortSessionSendLeftTo(session, 'main')).toEqual(session)
    expect(useSort.getState().left).toBe('main')
  })

  it('a drag is a swipe only past the threshold, and up needs to be more vertical than sideways', () => {
    expect(swipeDir(40, 0)).toBeNull()
    expect(swipeDir(120, 30)).toBe('right')
    expect(swipeDir(-120, -30)).toBe('left')
    expect(swipeDir(30, -120)).toBe('up')
    expect(swipeDir(130, -120)).toBe('right')
    expect(swipeDir(0, 200)).toBe('down')
    expect(swipeDir(130, 120)).toBe('right')
    expect(swipeDir(-10, 60)).toBeNull()
    expect(swipeDir(40, 0, 30)).toBe('right')
  })
})
