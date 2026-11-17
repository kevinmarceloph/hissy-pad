import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryStore, idOf, listPads, pad, shape } from '@hissypad/core'
import { configureLocalStore, loadPad, openPad, undo, usePad } from './store'
import { cmdNewPad } from './pads'
import {
  cmdSortAddSub, cmdSortBack, cmdSortRemoveSub, cmdSortSend, cmdSortSetText, loadSortTargets, setSortTarget, sortQueue, sortTarget, useSort,
} from './sort'

function reset(outline: string) {
  const mem = createMemoryStore(Object.values(pad(outline)))
  configureLocalStore(mem)
  usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [] })
  useSort.setState({ left: null, right: null })
  return mem
}

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
})
