import { resetStore } from './testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, listPads, shape } from '@hissypad/core'
import { loadPad, openPad, usePad } from './store'
import { undo } from './history'
import { cmdNewPad } from './pads'
import {
  cmdSortAddSub, cmdSortBack, cmdSortNewTarget, sortSessionBack, sortSessionCard, sortSessionSend, sortSessionStart, sortSummary, swipeDir, cmdSortRemoveSub, cmdSortSend, cmdSortSetText, loadSortTargets, setSortTarget, sortQueue, sortTarget, useSort,
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

  it('a chosen pad or Main is the target, remembered on the device; a deleted choice falls back', async () => {
    const work = cmdNewPad('Work')
    setSortTarget('left', work)
    setSortTarget('right', 'main')
    cmdSortAddSub(Object.keys(usePad.getState().rows)[0]!, 'x') // nothing: blank parent still takes a sub item
    openPad(null)
    cmdSortSend(id('A'), 'left')
    expect(all()[id('A')]!.parentId).toBe(work)
    // Already in the target: stays put, and up only crosses it out.
    const res = cmdSortSend(id('C'), 'up')!
    expect(res).toMatchObject({ moved: false, pad: 'Main' })
    expect(all()[id('C')]).toMatchObject({ parentId: null, done: true })
    expect(listPads(all()).map((p) => p.text)).toEqual(['Work'])
    useSort.setState({ left: null, right: null })
    await loadSortTargets()
    expect(useSort.getState()).toMatchObject({ left: work, right: 'main' })
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
    expect(cmdSortNewTarget('left', '  ')).toBe('')
    const someday = cmdSortNewTarget('left', ' Someday ')
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
    expect(sortSummary(session, 'Later', 'Today')).toBe('1 done, 1 to Later, 1 skipped')
    session = sortSessionBack(session)
    expect(sortSessionCard(session).id).toBe(id('D'))
    expect(sortSessionBack(sortSessionStart())).toEqual(sortSessionStart())
    expect(sortSummary(sortSessionStart(), 'Later', 'Today')).toBe('')
  })

  it('a drag is a swipe only past the threshold, and up needs to be more vertical than sideways', () => {
    expect(swipeDir(40, 0)).toBeNull()
    expect(swipeDir(120, 30)).toBe('right')
    expect(swipeDir(-120, -30)).toBe('left')
    expect(swipeDir(30, -120)).toBe('up')
    expect(swipeDir(130, -120)).toBe('right')
    expect(swipeDir(0, 200)).toBeNull()
    expect(swipeDir(40, 0, 30)).toBe('right')
  })
})
