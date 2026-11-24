import { beforeEach, describe, expect, it } from 'vitest'
import { createPad, idOf, moveToPad, remove, scopePad, shape } from '@hissypad/core'
import { resetStore } from './testing'
import { apply, applyAll, clock, loadPad, openPad, setAll, usePad } from './store'
import { undo } from './history'
import { select } from './selection'
import { cmdDeleteSelection } from './commands'
import { cmdDeletePad } from './pads'
import {
  archiveCovered, archiveLines, archivePrune, archiveRecent, archiveTap, cmdUnarchive, NO_ARCHIVE_SELECTION, sourcePad, unarchivedLabel,
} from './archive'

async function reset(outline: string) {
  const mem = resetStore(outline)
  await loadPad()
  return mem
}

// The whole table, tombstones included.
const rows = () => usePad.getState().all
const inbox = () => scopePad(rows(), null)
// By text, archived rows included (core's idOf only sees live ones).
const id = (t: string) => Object.values(rows()).find((r) => r.text === t)?.id ?? idOf(rows(), t)
// Move the shared clock on, so the next archive is its own.
const skip = (ms: number) => clock.observe(new Date(Date.parse(clock.last()) + ms).toISOString())
const del = (...texts: string[]) => {
  const ids = texts.map(id)
  select(ids, ids[0]!)
  cmdDeleteSelection()
}
// The list as text: two spaces per level, then "words [pad]" for a line on top.
const listed = () => archiveLines().map((l) => `${'  '.repeat(l.depth)}${l.row.text}${l.depth === 0 ? ` [${l.isPad ? 'pad' : l.source}]` : ''}`)
// A pad named Work holding these lines of the Inbox.
const toWork = (...texts: string[]) => {
  applyAll((all, ctx) => {
    const res = createPad(all, ctx, 'Work')
    return moveToPad(res.rows, ctx, texts.map(id), res.padId)
  })
  return id('Work')
}

describe('archiveLines', () => {
  beforeEach(() => reset('A\nB\n  B1\n  B2\n    B2a\nC\nD'))

  it('lists one archive as its lines in pad order, with what went with a line under it', () => {
    del('B', 'D')
    expect(listed()).toEqual(['B [Inbox]', '  B1', '  B2', '    B2a', 'D [Inbox]'])
    // Every row of the archive shares the stamp.
    expect(new Set(archiveLines().map((l) => l.deletedAt)).size).toBe(1)
  })

  it('keeps the order and the numbers of a numbered run', async () => {
    await reset('List\n  1. one\n  2. two\n  3. three\nA')
    del('List')
    expect(archiveLines().map((l) => `${l.number ?? '-'} ${l.row.text}`)).toEqual(['- List', '1 one', '2 two', '3 three'])
  })

  it('puts the newest archive first', () => {
    del('A')
    skip(5000)
    del('C')
    expect(listed()).toEqual(['C [Inbox]', 'A [Inbox]'])
  })

  it('a sub item archived on its own earlier is a line of its own, not under its parent', () => {
    del('B2a')
    skip(5000)
    del('B')
    expect(listed()).toEqual(['B [Inbox]', '  B1', '  B2', 'B2a [Inbox]'])
  })

  it('leaves out a blank line unless something is under it', () => {
    const d = id('D')
    apply((r, ctx) => ({ ...r, [d]: { ...r[d]!, text: '', updatedAt: ctx.now() } }))
    select([d], d)
    cmdDeleteSelection()
    expect(listed()).toEqual([])
    const b = id('B')
    apply((r, ctx) => ({ ...r, [b]: { ...r[b]!, text: '  ', updatedAt: ctx.now() } }))
    select([b], b)
    cmdDeleteSelection()
    expect(listed()).toEqual(['   [Inbox]', '  B1', '  B2', '    B2a'])
  })

  it('says the pad a line was in, also for a line under other lines', () => {
    const work = toWork('B')
    openPad(work)
    del('B2a')
    expect(listed()).toEqual(['B2a [Work]'])
    expect(sourcePad(rows(), id('B2a'))).toEqual({ padId: work, name: 'Work', live: true })
    expect(sourcePad(rows(), id('A'))).toEqual({ padId: null, name: 'Inbox', live: true })
  })

  it('an archived pad is a line with its lines under it', () => {
    const work = toWork('B')
    expect(cmdDeletePad(work)).toBe(4)
    expect(listed()).toEqual(['Work [pad]', '  B', '    B1', '    B2', '      B2a'])
    expect(archiveLines()[1]).toMatchObject({ source: 'Work', sourceLive: false })
  })

  it('archiveRecent counts the lines of the last 30 days, a line under another going with it', () => {
    del('A')
    skip(5000)
    del('B')
    const a = id('A')
    setAll({ ...rows(), [a]: { ...rows()[a]!, deletedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() } })
    const lines = archiveLines()
    expect(lines.map((l) => l.row.text)).toEqual(['B', 'B1', 'B2', 'B2a', 'A'])
    expect(archiveRecent(lines)).toBe(4)
    expect(archiveRecent(lines, 60)).toBe(5)
  })
})

describe('the archive selection', () => {
  beforeEach(async () => {
    await reset('A\nB\n  B1\n  B2\nC\nD')
    del('A', 'B', 'C', 'D')
  })

  it('a tap takes a line in or out; Shift takes every line from the last one tapped', () => {
    const lines = archiveLines()
    let sel = archiveTap(NO_ARCHIVE_SELECTION, lines, id('A'))
    expect(sel).toEqual({ ids: [id('A')], anchorId: id('A') })
    sel = archiveTap(sel, lines, id('C'))
    expect(sel.ids).toEqual([id('A'), id('C')])
    sel = archiveTap(sel, lines, id('A'))
    expect(sel).toEqual({ ids: [id('C')], anchorId: id('C') })
    sel = archiveTap(sel, lines, id('B'), true)
    expect(sel.ids).toEqual(['B', 'B1', 'B2', 'C'].map(id))
  })

  it('the lines under a selected one are covered, and a line that is gone is pruned', () => {
    const lines = archiveLines()
    expect([...archiveCovered(lines, [id('B')])]).toEqual([id('B1'), id('B2')])
    expect([...archiveCovered(lines, [id('B1')])]).toEqual([])
    const sel = { ids: [id('A'), id('C')], anchorId: id('A') }
    expect(archivePrune(sel, lines)).toBe(sel)
    cmdUnarchive([id('A')])
    expect(archivePrune(sel, archiveLines())).toEqual({ ids: [id('C')], anchorId: id('C') })
  })
})

describe('cmdUnarchive', () => {
  beforeEach(() => reset('A\nB\n  B1\n  B2\n    B2a\nC'))

  it('brings a line back with what went with it, to the top of its pad, re-stamped; undo archives it again', async () => {
    const mem = await reset('A\nB\n  B1\n  B2\n    B2a\nC')
    del('B')
    expect(shape(inbox())).toBe('A\nC')
    const before = rows()[id('B1')]!.updatedAt
    await mem.markClean([...mem.rows.keys()])
    const res = cmdUnarchive([id('B')])
    expect(res).toMatchObject({ ids: [id('B')], count: 4, places: ['Inbox'], pads: [] })
    expect(unarchivedLabel(res)).toBe('Unarchived 4 lines to Inbox.')
    expect(shape(inbox())).toBe('B\n  B1\n  B2\n    B2a\nA\nC')
    expect(rows()[id('B1')]!.updatedAt > before).toBe(true)
    await Promise.resolve()
    expect((await mem.dirtyIds()).sort()).toEqual(['B', 'B1', 'B2', 'B2a'].map(id).sort())
    expect(archiveLines()).toEqual([])
    undo()
    expect(shape(inbox())).toBe('A\nC')
  })

  it('a sub item comes back alone to the top of the pad, whatever it sat under, archived or not', () => {
    // Its parent is still in the pad.
    del('B2a')
    cmdUnarchive([id('B2a')])
    expect(shape(inbox())).toBe('B2a\nA\nB\n  B1\n  B2\nC')
    // Its parent is archived, in the same archive: the parent stays there.
    del('B')
    cmdUnarchive([id('B1')])
    expect(shape(inbox())).toBe('B1\nB2a\nA\nC')
    expect(rows()[id('B1')]!.parentId).toBeNull()
    expect(archiveLines().map((l) => l.row.text)).toEqual(['B', 'B2'])
  })

  it('a line and one under it, both asked for, come back as they were: the line carries it', () => {
    del('B')
    cmdUnarchive([id('B2'), id('B')])
    expect(shape(inbox())).toBe('B\n  B1\n  B2\n    B2a\nA\nC')
  })

  it('lines from separate archives land in the order they were listed', () => {
    del('A')
    skip(5000)
    del('C')
    cmdUnarchive(archiveLines().map((l) => l.id))
    expect(shape(inbox())).toBe('C\nA\nB\n  B1\n  B2\n    B2a')
  })

  it('a line goes back to the pad it was in, and the screen stays where it is', () => {
    const work = toWork('B', 'C')
    applyAll((all, ctx) => remove(all, ctx, [id('B2')]))
    expect(usePad.getState().padId).toBeNull()
    const res = cmdUnarchive([id('B2')])
    expect(unarchivedLabel(res)).toBe('Unarchived 2 lines to Work.')
    expect(usePad.getState().padId).toBeNull()
    expect(shape(scopePad(rows(), work))).toBe('B2\n  B2a\nB\n  B1\nC')
  })

  it('an archived pad comes back as a tab with its lines', () => {
    const work = toWork('B')
    cmdDeletePad(work)
    const res = cmdUnarchive([work])
    expect(unarchivedLabel(res)).toBe('Unarchived the pad Work with 4 lines.')
    expect(shape(scopePad(rows(), work))).toBe('B\n  B1\n  B2\n    B2a')
  })

  it('a line of an archived pad, asked for alone, goes to the Inbox', () => {
    const work = toWork('B')
    cmdDeletePad(work)
    const res = cmdUnarchive([id('B2')])
    expect(res.places).toEqual(['Inbox'])
    expect(shape(inbox())).toBe('B2\n  B2a\nA\nC')
    expect(rows()[work]!.deletedAt).not.toBeNull()
  })

  it('does nothing for lines that are not archived', () => {
    const res = cmdUnarchive([id('A'), 'nope'])
    expect(res.ids).toEqual([])
    expect(unarchivedLabel(res)).toBe('Nothing to unarchive.')
  })
})
