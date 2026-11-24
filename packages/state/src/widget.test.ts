import { beforeEach, describe, expect, it } from 'vitest'
import { idOf, listPads, shape } from '@hissypad/core'
import { loadPad, usePad } from './store'
import { undo } from './history'
import { cmdNewPad, cmdMoveToPad } from './pads'
import { select } from './selection'
import { openPad } from './store'
import { cmdToggleDone } from './commands'
import { setSortTarget } from './sort'
import { cmdAddToPad, cmdWidgetActions, widgetPadName, widgetSnapshot, WIDGET_INBOX, WIDGET_MAIN } from './widget'
import { resetStore } from './testing'

const all = () => usePad.getState().all
const whole = () => shape(all())
const id = (text: string) => idOf(all(), text)

describe('the widget', () => {
  beforeEach(async () => {
    resetStore('A\nB\n  B1\n  B2\n\nC\nD')
    await loadPad()
  })

  it('the snapshot lists every pad with its open top-level lines; Inbox is the default pad when there is one', () => {
    let snap = widgetSnapshot()
    expect(snap.pads).toEqual([{ id: WIDGET_MAIN, name: 'Main', count: 4, items: [
      { id: id('A'), text: 'A', subs: 0 }, { id: id('B'), text: 'B', subs: 2 }, { id: id('C'), text: 'C', subs: 0 }, { id: id('D'), text: 'D', subs: 0 },
    ] }])
    expect(snap).toMatchObject({ v: 1, inbox: WIDGET_MAIN, left: 'Later', right: 'Today' })
    const inbox = cmdNewPad('inbox')
    openPad(null)
    select([id('C')], id('C'))
    cmdToggleDone()
    snap = widgetSnapshot()
    expect(snap.inbox).toBe(inbox)
    expect(snap.pads.map((p) => [p.name, p.count])).toEqual([['Main', 3], ['inbox', 0]])
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap) // plain JSON, as it travels
  })

  it('long pads and long lines are cut to what a widget can show', () => {
    const many = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    resetStore(`${'x'.repeat(300)}\n${many}`)
    return loadPad().then(() => {
      const main = widgetSnapshot().pads[0]!
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
    const inbox = cmdNewPad('Inbox')
    openPad(null)
    select([id('A'), id('B')], id('A'))
    cmdMoveToPad(inbox)
    const depth = usePad.getState().past.length
    expect(cmdWidgetActions([{ id: id('A'), dir: 'left' }, { id: id('B'), dir: 'up' }, { id: id('C'), dir: 'right' }])).toBe(3)
    expect(whole()).toBe('\nD\n@Inbox\n  \n@Later\n  A\n@Today\n  ~B\n    B1\n    B2\n  C')
    expect(usePad.getState().past).toHaveLength(depth + 3)
    expect(usePad.getState().padId).toBeNull() // the pad shown does not change
    undo()
    expect(all()[id('C')]!.parentId).toBeNull()
  })

  it('a press on a line that is gone, pressed twice, or malformed is skipped', () => {
    expect(cmdWidgetActions([{ id: 'missing', dir: 'left' }, { id: id('A'), dir: 'sideways' as 'left' }, null as never])).toBe(0)
    expect(cmdWidgetActions([{ id: id('A'), dir: 'right' }, { id: id('A'), dir: 'right' }])).toBe(1)
    expect(cmdWidgetActions([{ id: id('A'), dir: 'up' }, { id: id('A'), dir: 'up' }])).toBe(1)
    expect(listPads(all()).map((p) => p.text)).toEqual(['Today'])
    expect(all()[id('A')]).toMatchObject({ done: true })
  })

  it('+ adds a line at the top of the pad the widget shows; an unknown pad means Main', () => {
    const inbox = cmdNewPad('Inbox')
    expect(cmdAddToPad(inbox, '  buy milk ')).not.toBe('')
    expect(cmdAddToPad(inbox, 'second')).not.toBe('')
    expect(cmdAddToPad(WIDGET_MAIN, 'top of main')).not.toBe('')
    expect(cmdAddToPad('gone', 'also main')).not.toBe('')
    expect(cmdAddToPad(inbox, '   ')).toBe('')
    expect(whole()).toBe('also main\ntop of main\nA\nB\n  B1\n  B2\n\nC\nD\n@Inbox\n  second\n  buy milk\n  ')
    expect([widgetPadName(inbox), widgetPadName(WIDGET_MAIN), widgetPadName('gone')]).toEqual(['Inbox', 'Main', 'Main'])
  })

  it('adding to "the Inbox" makes the Inbox pad the first time and reuses it after', () => {
    expect(widgetPadName(WIDGET_INBOX)).toBe('Inbox')
    expect(cmdAddToPad(WIDGET_INBOX, 'first')).not.toBe('')
    expect(cmdAddToPad(WIDGET_INBOX, 'second')).not.toBe('')
    expect(listPads(all()).map((p) => p.text)).toEqual(['Inbox'])
    expect(whole()).toBe('A\nB\n  B1\n  B2\n\nC\nD\n@Inbox\n  second\n  first')
    expect(widgetSnapshot().inbox).toBe(listPads(all())[0]!.id)
    undo()
    undo() // making the pad and adding the first line were one step
    expect(listPads(all())).toHaveLength(0)
  })

  it('a line added through Siri keeps the id it was given, so a later press on it finds it', () => {
    const given = '0b6f7c1e-8a52-4a51-9d0e-1c2d3e4f5a6b'
    expect(cmdWidgetActions([
      { dir: 'add', id: given, pad: WIDGET_INBOX, text: ' call mum ' },
      { dir: 'up', id: given },
    ])).toBe(2)
    expect(all()[given]).toMatchObject({ text: 'call mum', done: true })
    expect(listPads(all()).map((p) => p.text)).toEqual(['Inbox', 'Today'])
    // The same add delivered twice, a blank one and a malformed one do nothing; an id
    // that is not a uuid still adds the line, under a fresh id.
    expect(cmdWidgetActions([
      { dir: 'add', id: given, pad: WIDGET_INBOX, text: 'call mum' },
      { dir: 'add', id: '11111111-2222-4333-8444-555555555555', pad: WIDGET_INBOX, text: '   ' },
      { dir: 'add', id: 'x', pad: WIDGET_INBOX, text: 3 as unknown as string },
    ])).toBe(0)
    expect(cmdWidgetActions([{ dir: 'add', id: 'not-a-uuid', pad: WIDGET_MAIN, text: 'loose' }])).toBe(1)
    expect(all()['not-a-uuid']).toBeUndefined()
    expect(whole().startsWith('loose\nA')).toBe(true)
  })

  it('a Done from the watch crosses the line out where it is, once', () => {
    expect(cmdWidgetActions([{ dir: 'done', id: id('B') }, { dir: 'done', id: id('B') }, { dir: 'done', id: 'missing' }])).toBe(1)
    expect(whole()).toBe('A\n~B\n  B1\n  B2\n\nC\nD')
    expect(all()[id('B')]!.doneAt).not.toBeNull()
    expect(widgetSnapshot().pads[0]!.items.map((i) => i.text)).toEqual(['A', 'C', 'D'])
    undo()
    expect(all()[id('B')]!.done).toBe(false)
  })
})
