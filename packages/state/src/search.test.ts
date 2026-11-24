import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, setCollapsed, shape } from '@hissypad/core'
import { resetStore } from './testing'
import { applyAll, loadPad, openPad, usePad } from './store'
import { undo } from './history'
import { select } from './selection'
import { cmdDeleteSelection, cmdToggleDone } from './commands'
import { cmdMoveToPad, cmdNewPad } from './pads'
import { cmdOpenHit, foldText, search, searchCount, searchParts, searchTerms } from './search'

const all = () => usePad.getState().all
const id = (t: string) => idOf(all(), t)
const marked = (parts: { text: string; hit: boolean }[]) => parts.map((p) => (p.hit ? `[${p.text}]` : p.text)).join('')
// Each group as "Pad: line | line", hits marked with brackets.
const found = (q: string, current = usePad.getState().padId) =>
  search(all(), q, current).groups.map((g) => `${g.name}: ${g.hits.map((h) => marked(h.parts)).join(' | ')}`)

// Main holds A and the Trip tree; a second pad, Work, holds two lines.
async function reset() {
  resetStore('Buy milk\nTrip to Cebu\n  Book flights\n    Call the airline\n  Café list\nwork one\nwork milk run')
  await loadPad()
  const w = cmdNewPad('Work')
  openPad(null)
  select([id('work one'), id('work milk run')], id('work one'))
  cmdMoveToPad(w)
  return w
}

describe('search', () => {
  let work: string
  beforeEach(async () => {
    work = await reset()
  })

  it('finds lines in every pad, the pad on screen first, and marks the words found', () => {
    expect(found('milk')).toEqual(['Inbox: Buy [milk]', 'Work: work [milk] run'])
    expect(found('milk', work)).toEqual(['Work: work [milk] run', 'Inbox: Buy [milk]'])
    expect(search(all(), 'milk').total).toBe(2)
    expect(searchCount(search(all(), 'milk'))).toBe('2 lines')
    expect(searchCount(search(all(), 'buy'))).toBe('1 line')
  })

  it('wants every word, in any order, and ignores case and accents', () => {
    expect(found('RUN work')).toEqual(['Work: [work] milk [run]'])
    expect(found('cafe')).toEqual(['Inbox: [Café] list'])
    expect(found('milk cebu')).toEqual([])
    expect(found('   ')).toEqual([])
    expect(searchTerms('  Café  cafe ')).toEqual(['cafe'])
    expect(foldText('ÀéÑ ß')).toBe('aen ß')
  })

  it('gives each hit the lines it sits under, and finds a pad by its name', () => {
    const hit = search(all(), 'airline').groups[0]!.hits[0]!
    expect(hit.path).toEqual(['Trip to Cebu', 'Book flights'])
    expect(hit.padId).toBeNull()
    const pad = search(all(), 'work').groups.find((g) => g.padId === work)!
    expect(pad.hits[0]).toMatchObject({ id: work, isPad: true, path: [] })
    expect(pad.hits.slice(1).every((h) => h.path.length === 0 && !h.isPad)).toBe(true)
  })

  it('leaves deleted lines out, keeps crossed-out ones, and stops at the limit', () => {
    select([id('Buy milk')], id('Buy milk'))
    cmdToggleDone()
    expect(search(all(), 'buy').groups[0]!.hits[0]!.done).toBe(true)
    cmdDeleteSelection()
    expect(found('buy')).toEqual([])
    const cut = search(all(), 'o', null, 2)
    expect(cut.groups.flatMap((g) => g.hits)).toHaveLength(2)
    expect(cut.total).toBeGreaterThan(2)
    expect(searchCount(cut)).toBe(`The first 2 of ${cut.total} lines`)
  })

  it('shows the line of a long text that matched, cut near the match', () => {
    expect(marked(searchParts('first line\nthe second one', ['second']))).toBe('the [second] one')
    expect(marked(searchParts('\n  \nonly here', ['zzz']))).toBe('only here')
    const long = 'one two three four five six seven eight nine ten eleven twelve'
    expect(marked(searchParts(long, ['eleven']))).toBe('…six seven eight nine ten [eleven] twelve')
    expect(marked(searchParts('abab', ['ab', 'ba']))).toBe('[abab]')
  })
})

describe('cmdOpenHit', () => {
  let work: string
  beforeEach(async () => {
    work = await reset()
  })

  it('opens the pad a hit is in, selects the line and asks for a scroll to it', () => {
    const line = id('work milk run')
    expect(cmdOpenHit(line)).toBe(true)
    const s = usePad.getState()
    expect(s.padId).toBe(work)
    expect(s.selection).toEqual([line])
    expect(s.reveal?.id).toBe(line)
    expect(s.past.at(-1)?.label).not.toBe('cmdOpenHit')
  })

  it('unfolds what hides the line, as one undo step', () => {
    applyAll((rows, ctx) => setCollapsed(setCollapsed(rows, ctx, id('Trip to Cebu'), true), ctx, id('Book flights'), true))
    openPad(work)
    const line = id('Call the airline')
    expect(cmdOpenHit(line)).toBe(true)
    expect(usePad.getState().padId).toBeNull()
    expect(usePad.getState().selection).toEqual([line])
    expect(all()[id('Trip to Cebu')]!.collapsed).toBe(false)
    expect(all()[id('Book flights')]!.collapsed).toBe(false)
    undo()
    expect(all()[id('Trip to Cebu')]!.collapsed).toBe(true)
    expect(all()[id('Book flights')]!.collapsed).toBe(true)
  })

  it('a pad name opens that pad; a deleted or unknown line does nothing', () => {
    expect(cmdOpenHit(work)).toBe(true)
    expect(usePad.getState().padId).toBe(work)
    expect(usePad.getState().selection).toEqual([])
    openPad(null)
    const gone = id('Buy milk')
    select([gone], gone)
    cmdDeleteSelection()
    expect(cmdOpenHit(gone)).toBe(false)
    expect(cmdOpenHit('nope')).toBe(false)
    expect(shape(usePad.getState().rows).startsWith('Trip to Cebu')).toBe(true)
  })
})
