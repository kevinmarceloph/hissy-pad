// A pad's category goes to the lines moved into it.
import { beforeEach, describe, expect, it } from 'vitest'
import { idOf } from '@hissypad/core'
import { resetStore } from './testing'
import { importOutline, loadPad, openPad, usePad } from './store'
import { cmdDedent, cmdIndent, cmdSetText, cmdSplit } from './commands'
import { undo } from './history'
import { select } from './selection'
import { cmdMoveTo, cmdNewPad, cmdSetPadCategory } from './pads'
import { cmdSortSend, setSortTarget } from './sort'

const all = () => usePad.getState().all
const cat = (text: string) => all()[idOf(all(), text)]!.category

describe('pad categories', () => {
  let work = ''
  beforeEach(async () => {
    resetStore('A\n  A1\nB\nC')
    await loadPad()
    work = cmdNewPad('Work')
    cmdSetPadCategory(work, 'cat-work')
    openPad(null)
  })

  it('a line moved into the pad takes its category; what is under it keeps its own; undo takes both back', () => {
    expect(all()[work]!.category).toBe('cat-work')
    select([idOf(all(), 'A')], idOf(all(), 'A'))
    cmdMoveTo({ padId: work, subId: null })
    expect(cat('A')).toBe('cat-work')
    expect(cat('A1')).toBeNull()
    undo()
    expect(cat('A')).toBeNull()
    expect(all()[idOf(all(), 'A')]!.parentId).toBeNull()
  })

  it('a line with a category of its own takes the pad’s; a pad with none leaves it be', () => {
    const b = idOf(all(), 'B')
    usePad.setState({ all: { ...all(), [b]: { ...all()[b]!, category: 'cat-home' } } })
    openPad(null)
    select([b], b)
    cmdMoveTo({ padId: work, subId: null })
    expect(cat('B')).toBe('cat-work')
    cmdSetPadCategory(work, null)
    openPad(null)
    select([idOf(all(), 'C')], idOf(all(), 'C'))
    cmdMoveTo({ padId: work, subId: null })
    expect(cat('C')).toBeNull()
  })

  it('a line made new at the pad’s top level takes its category: Return, a paste; a sub item does not', () => {
    openPad(work)
    const first = Object.values(usePad.getState().rows)[0]!.id
    cmdSetText(first, 'one') // made with the pad, before the pad had a category: left as it is
    expect(all()[first]!.category).toBeNull()
    cmdSplit(first, 3)
    const second = Object.values(usePad.getState().rows).find((r) => r.id !== first)!.id
    expect(all()[second]!.category).toBe('cat-work')
    importOutline('pasted\n  under', 'bottom')
    expect(cat('pasted')).toBe('cat-work')
    expect(cat('under')).toBeNull()
    openPad(null)
    importOutline('in the inbox', 'bottom')
    expect(cat('in the inbox')).toBeNull()
  })

  it('a sub item that comes up to the top level takes the category; one going down keeps what it has', () => {
    openPad(work)
    importOutline('top\n  sub', 'bottom')
    expect([cat('top'), cat('sub')]).toEqual(['cat-work', null])
    select([idOf(all(), 'sub')], idOf(all(), 'sub'))
    cmdDedent()
    expect(cat('sub')).toBe('cat-work')
    undo()
    expect(cat('sub')).toBeNull()
    // A line indented under another keeps the category it had.
    select([idOf(all(), 'top')], idOf(all(), 'top'))
    importOutline('next', 'bottom')
    select([idOf(all(), 'next')], idOf(all(), 'next'))
    cmdIndent()
    expect(cat('next')).toBe('cat-work')
  })

  it('a sort send into the pad gives the category too', () => {
    setSortTarget(work, 'right')
    cmdSortSend(idOf(all(), 'A'), 'right')
    expect(cat('A')).toBe('cat-work')
  })
})
