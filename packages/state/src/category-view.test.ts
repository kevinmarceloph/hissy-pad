import { beforeEach, describe, expect, it } from 'vitest'
import { categoryCounts, dedent, findFixedPad, idOf, insertAfter, insertAt, insertAtTop, moveNodes, remove, scopeCategory, setCategory, setText, shape } from '@hissypad/core'

import { resetStore, tableShape } from './testing'
import { apply, applyAll, categoryShown, loadPad, openCategory, openPad, setSortMode, todayShown, usePad, zoomTo } from './store'
import { undo } from './history'
import { cmdNewPad } from './pads'

const W = 'cat-work'
const all = () => usePad.getState().all
const view = () => shape(usePad.getState().rows)
const id = (text: string) => idOf(all(), text)
const today = () => findFixedPad(all(), 'Today')!.id
const heads = () => [...scopeCategory(all(), W).heads].map(([top, pad]) => `${all()[top]!.text}:${pad === null ? 'Inbox' : all()[pad]!.text}`)

// The Inbox holds A (A1, A2 under it), B (B1 > B11, and B2), C. Today holds T and U. A pad
// "Work" holds W1 and W2. In the category: A1, B11, U, W2.
beforeEach(async () => {
  resetStore('A\n  A1\n    A1x\n  A2\nB\n  B1\n    B11\n  B2\nC')
  await loadPad()
  cmdNewPad('Work')
  openPad(null)
  applyAll((rows, ctx) => {
    const t = insertAt(rows, ctx, { parentId: today(), afterId: null }, 'T')
    const u = insertAt(t.rows, ctx, { parentId: today(), afterId: t.newId }, 'U')
    const work = idOf(u.rows, 'Work')
    const blank = Object.values(u.rows).find((r) => r.parentId === work && r.deletedAt === null)!
    const w1 = setText(u.rows, ctx, blank.id, 'W1')
    const w2 = insertAfter(w1, ctx, blank.id, 'W2')
    return setCategory(w2.rows, ctx, [u.newId, w2.newId, idOf(w2.rows, 'A1'), idOf(w2.rows, 'B11')], W)
  })
})

describe('a category as a view of the store', () => {
  it('shows its lines from every pad in pad order, with the lines over and under them', () => {
    openCategory(W)
    // Today, the Inbox, then Work. A2, B2, C, T and W1 have nothing to do with the category.
    expect(view()).toBe('U\nA\n  A1\n    A1x\nB\n  B1\n    B11\nW2')
    expect(heads()).toEqual(['U:Today', 'A:Inbox', 'W2:Work'])
    expect(categoryShown()).toBe(W)
    expect(todayShown()).toBe(false)
    expect(categoryCounts(all()).get(W)).toBe(4)
  })

  it('ends when a pad is opened, and stands behind a zoom and Sort', () => {
    openCategory(W)
    zoomTo(id('A'))
    expect(view()).toBe('A1\n  A1x\nA2')
    expect(categoryShown()).toBeNull()
    zoomTo(null)
    expect(view()).toContain('U\nA\n  A1')
    setSortMode(true)
    expect(usePad.getState().catId).toBeNull()
    setSortMode(false)
    expect(usePad.getState().catId).toBe(W)
    openPad(null)
    expect(usePad.getState().catId).toBeNull()
    expect(view()).toContain('A2')
  })

  it('edits a line where it lives', () => {
    openCategory(W)
    const before = all()[id('U')]!
    apply((rows, ctx) => setText(rows, ctx, before.id, 'U!'))
    expect(all()[before.id]).toMatchObject({ text: 'U!', parentId: today(), rank: before.rank })
    const a = all()[id('A')]!
    apply((rows, ctx) => setText(rows, ctx, a.id, 'A!'))
    expect(all()[a.id]).toMatchObject({ text: 'A!', parentId: null, rank: a.rank })
  })

  it('gives a new line the category unless it is under one of its lines', () => {
    openCategory(W)
    // After A, at the top level: in the Inbox, right after A, in the category.
    apply((rows, ctx) => insertAt(rows, ctx, { parentId: null, afterId: id('A') }, 'A and a half').rows)
    expect(all()[id('A and a half')]).toMatchObject({ parentId: null, category: W })
    expect(tableShape()).toContain('A2\nA and a half\nB\n')
    // Beside B1, under B, which is only here for B11: it takes the category to stay.
    apply((rows, ctx) => insertAt(rows, ctx, { parentId: id('B'), afterId: id('B1') }, 'B1 and a half').rows)
    expect(all()[id('B1 and a half')]).toMatchObject({ parentId: id('B'), category: W })
    expect(tableShape()).toContain('    B11\n  B1 and a half\n  B2')
    // Under A1, a line of the category: nothing to add.
    apply((rows, ctx) => insertAfter(rows, ctx, id('A1x'), 'A1y').rows)
    expect(all()[id('A1y')]).toMatchObject({ parentId: id('A1'), category: null })
    expect(view()).toContain('    A1x\n    A1y')
  })

  it('puts a line added first in the view before the first line, in its pad', () => {
    openCategory(W)
    apply((rows, ctx) => insertAtTop(rows, ctx, 'first').rows)
    expect(all()[id('first')]).toMatchObject({ parentId: today(), category: W })
    expect(view().startsWith('first\nU\n')).toBe(true)
  })

  it('puts a new line in the pad behind the view when the view is empty', () => {
    openCategory('cat-none')
    expect(view()).toBe('')
    apply((rows, ctx) => insertAtTop(rows, ctx, 'only').rows)
    expect(all()[id('only')]).toMatchObject({ parentId: null, category: 'cat-none' })
    expect(view()).toBe('only')
    expect(tableShape().startsWith('only\nA\n')).toBe(true)
  })

  it('moves a line dragged to another pad\'s group into that pad', () => {
    openCategory(W)
    // W2 dropped after U: it is a line of Today now, after U.
    apply((rows, ctx) => moveNodes(rows, ctx, [id('W2')], { parentId: null, afterId: id('U') }))
    expect(all()[id('W2')]!.parentId).toBe(today())
    expect(view().startsWith('U\nW2\nA\n')).toBe(true)
    // B dropped before A stays in the Inbox, before A (not at the end of Today).
    apply((rows, ctx) => moveNodes(rows, ctx, [id('B')], { parentId: null, afterId: id('W2') }))
    expect(all()[id('B')]!.parentId).toBeNull()
    expect(tableShape().startsWith('B\n  B1\n    B11\n  B2\nA\n')).toBe(true)
  })

  it('moves a line out from under one to the top level of that pad', () => {
    openCategory(W)
    apply((rows, ctx) => dedent(rows, ctx, [id('A1')]))
    expect(all()[id('A1')]).toMatchObject({ parentId: null })
    expect(tableShape()).toContain('A\n  A2\nA1\n  A1x\nB')
    expect(view()).toContain('U\nA1\n  A1x\nB')
  })

  it('archives the lines the view left out along with the line over them, in one step', () => {
    openCategory(W)
    apply((rows, ctx) => remove(rows, ctx, [id('B')]))
    for (const t of ['B', 'B1', 'B11', 'B2']) expect(Object.values(all()).find((r) => r.text === t)!.deletedAt).not.toBeNull()
    expect(view()).toBe('U\nA\n  A1\n    A1x\nW2')
    undo()
    expect(tableShape()).toContain('B\n  B1\n    B11\n  B2\nC')
  })

  it('lets a line go once it and its lines are out of the category', () => {
    openCategory(W)
    applyAll((rows, ctx) => setCategory(rows, ctx, [id('A1')], null))
    expect(view()).toBe('U\nB\n  B1\n    B11\nW2')
  })
})
