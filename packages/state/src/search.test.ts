import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, setCollapsed, setKind } from '@hissypad/core'
import { resetStore } from './testing'
import { applyAll, loadPad, openPad, usePad } from './store'
import { undo } from './history'
import { select } from './selection'
import { cmdDeleteSelection, cmdToggleDone } from './commands'
import { cmdDeletePad, cmdMoveToPad, cmdNewPad } from './pads'
import { cmdOpenHit, foldText, hitKids, hitNote, lineHit, search, searchCount, searchParts, searchTerms } from './search'

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

  it('says what kind of line a hit is and how many lines are right under it', () => {
    const one = (q: string) => search(all(), q).groups.flatMap((g) => g.hits)[0]!
    // A plain line with nothing under it says only where it sits.
    expect(one('airline')).toMatchObject({ kind: 'plain', children: 0 })
    expect(hitNote(one('airline'))).toBe('Trip to Cebu › Book flights')
    expect(hitNote(one('buy'))).toBe('')
    // The lines right under it, not the ones further in.
    expect(one('cebu')).toMatchObject({ kind: 'plain', children: 2 })
    expect([hitKids(one('cebu')), hitNote(one('cebu'))]).toEqual(['+2', ''])
    expect(hitKids(one('airline'))).toBe('')
    applyAll((rows, ctx) => setKind(rows, ctx, [id('Trip to Cebu')], 'header'))
    expect(hitNote(one('cebu'))).toBe('Header')
    expect([hitKids(one('flights')), hitNote(one('flights'))]).toEqual(['+1', 'Trip to Cebu'])
    // A pad says how many lines it holds.
    const pad = search(all(), 'work').groups.find((g) => g.padId === work)!.hits[0]!
    expect([hitKids(pad), hitNote(pad)]).toEqual(['+2', 'Pad'])
  })

  it('carries a line\'s category, and reads any line as a hit that says its pad', () => {
    applyAll((rows) => ({ ...rows, [id('Book flights')]: { ...rows[id('Book flights')]!, category: 'travel' } }))
    expect(search(all(), 'flights').groups[0]!.hits[0]!.category).toBe('travel')
    const hit = lineHit(all(), id('Book flights'))!
    expect(hit).toMatchObject({ category: 'travel', children: 1, archived: false })
    // Nothing groups these by pad, so the pad leads where it sits.
    expect(hitNote(hit)).toBe('Inbox › Trip to Cebu')
    expect(hitNote(lineHit(all(), id('work one'))!)).toBe('Work')
    expect(lineHit(all(), 'nope')).toBeNull()
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

  it('a pad name opens that pad; an unknown line does nothing', () => {
    expect(cmdOpenHit(work)).toBe(true)
    expect(usePad.getState().padId).toBe(work)
    expect(usePad.getState().selection).toEqual([])
    expect(cmdOpenHit('nope')).toBe(false)
  })
})

describe('search with archived lines', () => {
  let work: string
  beforeEach(async () => {
    work = await reset()
  })

  const archive = (text: string) => {
    const at = id(text)
    select([at], at)
    cmdDeleteSelection()
    return at
  }

  it('leaves archived lines out unless asked, then lists them last in their own group', () => {
    openPad(work)
    archive('work milk run')
    openPad(null)
    expect(found('milk')).toEqual(['Inbox: Buy [milk]'])
    const r = search(all(), 'milk', null, undefined, true)
    expect(r.groups.map((g) => [g.name, g.archived])).toEqual([['Inbox', false], ['Archive', true]])
    const hit = r.groups[1]!.hits[0]!
    expect(marked(hit.parts)).toBe('work [milk] run')
    expect(hit.archived).toBe(true)
    expect(hit.path).toEqual(['Work'])
    expect(r.total).toBe(2)
  })

  it('finds a line archived with its parent, under the path it had', () => {
    archive('Trip to Cebu')
    const hits = search(all(), 'airline', null, undefined, true).groups.flatMap((g) => g.hits)
    expect(hits.map((h) => [h.archived, h.path])).toEqual([[true, ['Inbox', 'Trip to Cebu', 'Book flights']]])
  })

  it('an archived pad is found by its name, and its lines under its name', () => {
    openPad(null)
    cmdDeletePad(work)
    const hits = search(all(), 'work', null, undefined, true).groups.find((g) => g.archived)!.hits
    expect(hits.find((h) => h.isPad)?.id).toBe(work)
    expect(hits.filter((h) => !h.isPad).map((h) => h.path)).toEqual([['Work'], ['Work']])
  })

  it('cmdOpenHit leaves an archived line alone: the Archive screen shows those', () => {
    const line = archive('Buy milk')
    expect(cmdOpenHit(line)).toBe(false)
    expect(all()[line]!.deletedAt).not.toBeNull()
  })
})
