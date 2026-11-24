import { beforeEach, describe, expect, it } from 'vitest'
import { findFixedPad, idOf, listPads } from '@hissypad/core'
import { loadPad, usePad } from './store'
import { undo } from './history'
import { cmdNewPad, cmdMoveToPad } from './pads'
import { select } from './selection'
import { openPad } from './store'
import { cmdToggleDone } from './commands'
import { setSortTarget } from './sort'
import { cmdAddToPad, cmdWidgetActions, widgetPadName, widgetSnapshot, WIDGET_INBOX, WIDGET_MAIN } from './widget'
import { resetStore, tableShape } from './testing'

const all = () => usePad.getState().all
const whole = () => tableShape()
const id = (text: string) => idOf(all(), text)
const empty = (padId: string) => ({ id: padId, count: 0, items: [] })

describe('the widget', () => {
  beforeEach(async () => {
    resetStore('A\nB\n  B1\n  B2\n\nC\nD')
    await loadPad()
  })

  it('the snapshot lists the pads in tab order with their open top-level lines; the Inbox (the root) is the default', () => {
    let snap = widgetSnapshot()
    const today = findFixedPad(all(), 'Today')!.id
    const later = findFixedPad(all(), 'Later')!.id
    expect(snap.pads).toEqual([
      { ...empty(today), name: 'Today' },
      { id: WIDGET_MAIN, name: 'Inbox', count: 4, items: [
        { id: id('A'), text: 'A', subs: 0 }, { id: id('B'), text: 'B', subs: 2 }, { id: id('C'), text: 'C', subs: 0 }, { id: id('D'), text: 'D', subs: 0 },
      ] },
      { ...empty(later), name: 'Later' },
    ])
    expect(snap).toMatchObject({ v: 1, inbox: WIDGET_MAIN, left: 'Later', right: 'Today' })
    cmdNewPad('Work')
    openPad(null)
    select([id('C')], id('C'))
    cmdToggleDone()
    snap = widgetSnapshot()
    expect(snap.pads.map((p) => [p.name, p.count])).toEqual([['Today', 0], ['Inbox', 3], ['Later', 0], ['Work', 0]])
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap) // plain JSON, as it travels
  })

  it('long pads and long lines are cut to what a widget can show', () => {
    const many = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    resetStore(`${'x'.repeat(300)}\n${many}`)
    return loadPad().then(() => {
      const main = widgetSnapshot().pads.find((p) => p.id === WIDGET_MAIN)!
      expect(main.count).toBe(41)
      expect(main.items).toHaveLength(25)
      expect(main.items[0]!.text).toHaveLength(140)
      expect(main.items[0]!.text.endsWith('…')).toBe(true)
    })
  })

  it('the targets in the snapshot follow the Sort settings; right is always Today', () => {
    const work = cmdNewPad('Work')
    setSortTarget(work)
    expect(widgetSnapshot()).toMatchObject({ left: 'Work', right: 'Today' })
  })

  it('queued buttons apply in order, from whichever pad the line is in, one undo step each', () => {
    const work = cmdNewPad('Work')
    openPad(null)
    select([id('A'), id('B')], id('A'))
    cmdMoveToPad(work)
    const depth = usePad.getState().past.length
    expect(cmdWidgetActions([{ id: id('A'), dir: 'left' }, { id: id('B'), dir: 'up' }, { id: id('C'), dir: 'right' }])).toBe(3)
    expect(whole()).toBe('\nD\n@Today\n  C\n  ~B\n    B1\n    B2\n@Later\n  A\n@Work\n  ')
    expect(usePad.getState().past).toHaveLength(depth + 3)
    expect(usePad.getState().padId).toBeNull() // the pad shown does not change
    undo()
    expect(all()[id('C')]!.parentId).toBeNull()
  })

  it('a press on a line that is gone, pressed twice, or malformed is skipped', () => {
    expect(cmdWidgetActions([{ id: 'missing', dir: 'left' }, { id: id('A'), dir: 'sideways' as 'left' }, null as never])).toBe(0)
    expect(cmdWidgetActions([{ id: id('A'), dir: 'right' }, { id: id('A'), dir: 'right' }])).toBe(1)
    expect(cmdWidgetActions([{ id: id('A'), dir: 'up' }, { id: id('A'), dir: 'up' }])).toBe(1)
    expect(whole()).toBe('B\n  B1\n  B2\n\nC\nD\n@Today\n  ~A')
    expect(all()[id('A')]).toMatchObject({ done: true })
  })

  it('+ adds a line at the top of the pad the widget shows; Main, the old Inbox key or a pad that is gone mean the Inbox', () => {
    const work = cmdNewPad('Work')
    expect(cmdAddToPad(work, '  buy milk ')).not.toBe('')
    expect(cmdAddToPad(work, 'second')).not.toBe('')
    expect(cmdAddToPad(WIDGET_MAIN, 'top of main')).not.toBe('')
    expect(cmdAddToPad(WIDGET_INBOX, 'from siri')).not.toBe('')
    expect(cmdAddToPad('gone', 'also main')).not.toBe('')
    expect(cmdAddToPad(work, '   ')).toBe('')
    expect(whole()).toBe('also main\nfrom siri\ntop of main\nA\nB\n  B1\n  B2\n\nC\nD\n@Work\n  second\n  buy milk\n  ')
    expect([widgetPadName(work), widgetPadName(WIDGET_MAIN), widgetPadName(WIDGET_INBOX), widgetPadName('gone')]).toEqual(['Work', 'Inbox', 'Inbox', 'Inbox'])
    // Each add is one undo step, and none makes a pad.
    undo()
    expect(whole().startsWith('from siri\n')).toBe(true)
    expect(listPads(all()).map((p) => p.text)).toEqual(['Today', 'Later', 'Work'])
  })

  it('a line added through Siri keeps the id it was given, so a later press on it finds it', () => {
    const given = '0b6f7c1e-8a52-4a51-9d0e-1c2d3e4f5a6b'
    expect(cmdWidgetActions([
      { dir: 'add', id: given, pad: WIDGET_INBOX, text: ' call mum ' },
      { dir: 'up', id: given },
    ])).toBe(2)
    expect(all()[given]).toMatchObject({ text: 'call mum', done: true })
    expect(all()[given]!.parentId).toBe(findFixedPad(all(), 'Today')!.id)
    // The same add delivered twice, a blank one and a malformed one do nothing; an id
    // that is not a uuid still adds the line, under a fresh id.
    expect(cmdWidgetActions([
      { dir: 'add', id: given, pad: WIDGET_INBOX, text: 'call mum' },
      { dir: 'add', id: '11111111-2222-4333-8444-555555555555', pad: WIDGET_INBOX, text: '   ' },
      { dir: 'add', id: 'x', pad: WIDGET_INBOX, text: 3 as unknown as string },
    ])).toBe(0)
    expect(cmdWidgetActions([{ dir: 'add', id: 'not-a-uuid', pad: WIDGET_MAIN, text: 'loose' }])).toBe(1)
    expect(all()['not-a-uuid']).toBeUndefined()
    expect(whole().startsWith('loose\nA\n')).toBe(true)
  })

  it('a Done from the watch crosses the line out where it is, once', () => {
    expect(cmdWidgetActions([{ dir: 'done', id: id('B') }, { dir: 'done', id: id('B') }, { dir: 'done', id: 'missing' }])).toBe(1)
    expect(whole()).toBe('A\n~B\n  B1\n  B2\n\nC\nD')
    expect(all()[id('B')]!.doneAt).not.toBeNull()
    expect(widgetSnapshot().pads.find((p) => p.id === WIDGET_MAIN)!.items.map((i) => i.text)).toEqual(['A', 'C', 'D'])
    undo()
    expect(all()[id('B')]!.done).toBe(false)
  })
})
