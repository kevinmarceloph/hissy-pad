import { beforeEach, describe, expect, it } from 'vitest'
import { dedent, findFixedPad, idOf, indent, insertAfter, insertAt, moveSibling, remove, setSlot, setText, shape, slotKey } from '@hissypad/core'

import { resetStore, tableShape } from './testing'
import { apply, applyAll, closeSlot, loadPad, openPad, openSlot, usePad, zoomTo } from './store'
import { redo, undo } from './history'

const H = slotKey('2026-11-25', 9)
const all = () => usePad.getState().all
const view = () => shape(usePad.getState().rows)
const id = (text: string) => idOf(all(), text)
const today = () => findFixedPad(all(), 'Today')!.id

// The Inbox holds A (with A1 and A2 under it), B and C. Today holds T and U. A and U are in 9am.
beforeEach(async () => {
  resetStore('A\n  A1\n  A2\nB\nC')
  await loadPad()
  applyAll((rows, ctx) => {
    const t = insertAt(rows, ctx, { parentId: today(), afterId: null }, 'T')
    const u = insertAt(t.rows, ctx, { parentId: today(), afterId: t.newId }, 'U')
    return setSlot(u.rows, ctx, [u.newId, idOf(u.rows, 'A')], H)
  })
})

describe('an hour as a view of the store', () => {
  it('shows the lines put in the hour and what is under them, in pad order', () => {
    expect(openSlot(H)).toBe(true)
    // Today comes before the Inbox, whatever the ranks say across pads.
    expect(view()).toBe('U\nA\n  A1\n  A2')
    expect(usePad.getState().slotId).toBe(H)
    closeSlot()
    expect(usePad.getState().slotId).toBeNull()
    expect(view()).toBe('A\n  A1\n  A2\nB\nC')
  })

  it('is one hour, and ends when a pad is opened or a line is zoomed into', () => {
    expect(openSlot(slotKey('2026-11-25', 9, 3))).toBe(false)
    expect(openSlot('nonsense')).toBe(false)
    openSlot(H)
    zoomTo(id('A'))
    expect(usePad.getState()).toMatchObject({ slotId: null, zoomId: id('A') })
    openSlot(H)
    expect(usePad.getState()).toMatchObject({ slotId: H, zoomId: null })
    openPad(null)
    expect(usePad.getState().slotId).toBeNull()
  })

  it('edits a line where it lives: its pad and its place there do not change', () => {
    openSlot(H)
    const before = all()[id('U')]!
    apply((rows, ctx) => setText(rows, ctx, id('U'), 'U, typed in the hour'))
    expect(all()[before.id]).toMatchObject({ text: 'U, typed in the hour', parentId: today(), rank: before.rank, slot: H })
    expect(view()).toBe('U, typed in the hour\nA\n  A1\n  A2')
    undo()
    expect(all()[before.id]!.text).toBe('U')
    expect(view()).toBe('U\nA\n  A1\n  A2')
    redo()
    expect(all()[before.id]!.text).toBe('U, typed in the hour')
  })

  it('edits what is under a line like any pad does', () => {
    openSlot(H)
    apply((rows, ctx) => indent(rows, ctx, [id('A2')]))
    expect(view()).toBe('U\nA\n  A1\n    A2')
    expect(all()[id('A2')]).toMatchObject({ parentId: id('A1'), slot: null })
    apply((rows, ctx) => insertAfter(rows, ctx, id('A1'), 'A1 and a half').rows)
    expect(tableShape()).toContain('A\n  A1\n    A1 and a half\n    A2\nB')
  })

  it('writes nothing for a move among the hour\'s own lines: an hour keeps no order', () => {
    openSlot(H)
    const before = all()
    const steps = usePad.getState().past.length
    apply((rows, ctx) => moveSibling(rows, ctx, [id('A')], 'up'))
    expect(all()).toBe(before)
    expect(usePad.getState().past.length).toBe(steps)
    expect(view()).toBe('U\nA\n  A1\n  A2')
  })

  it('puts a line moved out to the root after the line it was under, in that line\'s pad, and in the hour', () => {
    openSlot(H)
    apply((rows, ctx) => dedent(rows, ctx, [id('A1')]))
    // In the Inbox it is now the line after A; in the hour it is one of the hour's own.
    expect(all()[id('A1')]).toMatchObject({ parentId: null, slot: H })
    expect(tableShape().startsWith('A\n  A2\nA1\nB\nC')).toBe(true)
    expect(view()).toBe('U\nA\n  A2\nA1')
  })

  it('keeps one of the hour\'s lines in the hour when it is moved in under another', () => {
    openSlot(H)
    apply((rows, ctx) => indent(rows, ctx, [id('A')]))
    // A is under U now, in Today, with what was under it. It still carries its hour.
    expect(all()[id('A')]).toMatchObject({ parentId: id('U'), slot: H })
    expect(view()).toBe('U\n  A\n    A1\n    A2')
  })

  it('sends a line made at the root to the top of Today, in the hour', () => {
    openSlot(H)
    // B is alone at the root of nothing here; U has nothing under it, so a line after it is at the root.
    const made = apply((rows, ctx) => insertAfter(rows, ctx, id('U')).rows)
    const fresh = Object.values(made).find((r) => r.text === '')!
    expect(all()[fresh.id]).toMatchObject({ parentId: today(), slot: H })
    // An empty line stays in the view, so it can be typed in.
    apply((rows, ctx) => setText(rows, ctx, fresh.id, 'new'))
    expect(tableShape()).toContain('@Today\n  new\n  T\n  U')
    expect(view()).toBe('new\nU\nA\n  A1\n  A2')
    undo()
    undo()
    expect(all()[fresh.id]!.deletedAt).not.toBeNull()
    expect(view()).toBe('U\nA\n  A1\n  A2')
  })

  it('archives a line with what is under it, and follows a change made from outside', () => {
    openSlot(H)
    const under = id('A1')
    apply((rows, ctx) => remove(rows, ctx, [id('A')]))
    expect(all()[under]!.deletedAt).not.toBeNull()
    expect(view()).toBe('U')
    undo()
    expect(view()).toBe('U\nA\n  A1\n  A2')
    // A line put in the hour from the pad's side shows up in the open hour.
    applyAll((rows, ctx) => setSlot(rows, ctx, [id('C')], H))
    expect(view()).toBe('U\nA\n  A1\n  A2\nC')
  })
})
