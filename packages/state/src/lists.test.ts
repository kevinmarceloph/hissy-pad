import { resetStore } from './testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, remove } from '@hissypad/core'
import { apply, loadPad, setAll, usePad } from './store'
import { undo } from './history'
import { select } from './selection'
import { cmdToggleDone } from './commands'
import { cmdUndone, dayLabel, doneEntries, firstLine, groupByDay, timeLabel, underLabel } from './lists'

async function reset(outline: string) {
  const mem = resetStore(outline)
  await loadPad()
  return mem
}

// The whole table, tombstones included; the pad being shown is usePad.getState().rows.
const rows = () => usePad.getState().all
// By text (core's idOf only sees live rows).
const id = (t: string) => Object.values(rows()).find((r) => r.text === t)?.id ?? idOf(rows(), t)

describe('doneEntries / cmdUndone', () => {
  beforeEach(() => reset('A\nB\n  B1\nC'))

  it('lists live done rows newest first by doneAt, falling back to updatedAt', () => {
    select([id('A')], id('A'))
    cmdToggleDone()
    select([id('B')], id('B'))
    cmdToggleDone()
    expect(rows()[id('A')]!.doneAt).toBe(rows()[id('A')]!.updatedAt)
    expect(doneEntries().map((e) => e.text)).toEqual(['B', 'A'])
    expect(doneEntries()[0]!.childCount).toBe(1)
    // An older row done before the column existed sorts by updatedAt.
    const legacy = new Date(Date.now() + 60_000).toISOString()
    setAll({ ...rows(), [id('C')]: { ...rows()[id('C')]!, done: true, doneAt: null, updatedAt: legacy } })
    expect(doneEntries().map((e) => e.text)).toEqual(['C', 'B', 'A'])
    expect(doneEntries()[0]!.doneAt).toBe(legacy)
    // Deleted rows are not "done".
    apply((r, ctx) => remove(r, ctx, [id('B')]))
    expect(doneEntries().map((e) => e.text)).toEqual(['C', 'A'])
  })

  it('cmdUndone clears done and doneAt and is undoable', () => {
    select([id('A')], id('A'))
    cmdToggleDone()
    cmdUndone(id('A'))
    expect(rows()[id('A')]).toMatchObject({ done: false, doneAt: null })
    expect(doneEntries()).toEqual([])
    undo()
    expect(rows()[id('A')]!.done).toBe(true)
    expect(rows()[id('A')]!.doneAt).not.toBeNull()
  })
})

describe('day grouping', () => {
  it('labels today, yesterday and older dates, and buckets in order', () => {
    const now = new Date(2026, 10, 2, 15, 0).getTime()
    const at = (daysAgo: number, h = 9) => new Date(2026, 10, 2 - daysAgo, h).toISOString()
    expect(dayLabel(at(0), now)).toBe('Today')
    expect(dayLabel(at(1), now)).toBe('Yesterday')
    expect(dayLabel(at(2), now)).toMatch(/Oct 31/)
    const groups = groupByDay([at(0, 12), at(0, 8), at(1), at(5)], (x) => x, now)
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([['Today', 2], ['Yesterday', 1], [dayLabel(at(5), now), 1]])
  })

  it('one-line labels for the panels', () => {
    expect(firstLine('  first\nsecond')).toBe('first')
    expect(firstLine('\nsecond')).toBe('(blank line)')
    expect([underLabel(0), underLabel(1), underLabel(3)]).toEqual([null, '+1 line under it', '+3 lines under it'])
    expect(timeLabel('2026-11-01T09:05:00')).toMatch(/9:05/)
  })
})
