import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { shape } from '@hissypad/core'
import { App } from '../app/App'
import { resetStore, usePad } from '@hissypad/state'
import { cmdSetSlot, setSlotPickerOpener } from '@hissypad/state/hours'
import { slotKey, slotLabel, todayKey } from '@hissypad/core'

async function mount(outline: string) {
  resetStore(outline)
  render(<App />)
  await screen.findByRole('tree')
}

const whole = () => shape(usePad.getState().all)
const card = () => screen.getByRole('textbox', { name: 'Line text' }) as HTMLTextAreaElement
const button = (name: string | RegExp) => screen.getByRole('button', { name })

describe('sort', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('down deletes the card: the arrow key or the Archive button sends it to the Archive, Back restores it', async () => {
    const user = userEvent.setup()
    await mount('A\nB\nC')
    await user.click(button('Sort'))
    await user.keyboard('{ArrowDown}')
    expect(card().value).toBe('B')
    expect(whole()).toBe('B\nC')
    await user.click(button('Down: archive'))
    expect(whole()).toBe('C')
    await user.click(button('Back'))
    expect(card().value).toBe('B')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByText('3 archived')).toBeInTheDocument()
  })

  it('arrow keys and buttons send cards left, right and up; Back takes one back; the end shows a tally', async () => {
    const user = userEvent.setup()
    await mount('A\nB\n  B1\nC\nD')
    await user.click(button('Sort'))
    expect(card().value).toBe('A')
    expect(screen.getByText(/4 to go/)).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(card().value).toBe('B')
    expect(screen.getByRole('textbox', { name: 'Sub item' })).toHaveValue('B1')
    await user.click(button('Right: Today'))
    await user.keyboard('{ArrowUp}')
    expect(whole()).toBe('D\n@Later\n  A\n@Today\n  B\n    B1\n  ~C')
    await user.click(button('Back'))
    expect(card().value).toBe('C')
    expect(whole()).toBe('C\nD\n@Later\n  A\n@Today\n  B\n    B1')
    await user.keyboard('s{ArrowRight}')
    expect(screen.getByText('All sorted.')).toBeInTheDocument()
    expect(screen.getByText('2 to Today, 1 to Later, 1 skipped')).toBeInTheDocument()
    await user.click(button('Pad'))
    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(shape(usePad.getState().rows)).toBe('C')
  })

  it('the card edits before it goes: text, a new sub item, and arrows inside a field do not sort', async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(button('Sort'))
    await user.click(card())
    await user.keyboard('{ArrowLeft}!')
    expect(card().value).toBe('!A')
    await user.type(screen.getByRole('textbox', { name: 'Add a sub item' }), 'first step{Enter}second{Enter}')
    expect(whole()).toBe('!A\n  first step\n  second\nB')
    await user.keyboard('{Escape}{ArrowRight}')
    expect(whole()).toBe('B\n@Today\n  !A\n    first step\n    second')
  })

  it('the card fields are one line: Return closes the text field, Shift+Return in a sub item adds no break, a pasted break becomes a space', async () => {
    const user = userEvent.setup()
    await mount('A\n  A1\nB')
    await user.click(button('Sort'))
    await user.click(card())
    await user.keyboard('{End}x{Enter}')
    expect(card().value).toBe('Ax')
    expect(document.activeElement).not.toBe(card())
    const sub = screen.getByRole('textbox', { name: 'Sub item' })
    await user.click(sub)
    await user.keyboard('{End}{Shift>}{Enter}{/Shift}')
    expect(sub).toHaveValue('A1')
    fireEvent.change(card(), { target: { value: 'one\ntwo' } })
    expect(card().value).toBe('one two')
    expect(whole()).toBe('one two\n  A1\nB')
  })

  it('a drag past the threshold is a swipe; a short one springs back', async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(button('Sort'))
    const drag = (dx: number, dy: number) => {
      const el = screen.getByRole('article')
      fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 200, clientY: 300 })
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx / 2, clientY: 300 + dy / 2 })
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, clientY: 300 + dy })
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 300 + dy })
    }
    drag(40, 0)
    expect(whole()).toBe('A\nB')
    drag(-140, 10)
    expect(whole()).toBe('B\n@Later\n  A')
    drag(20, -150)
    expect(whole()).toBe('\n@Later\n  A\n@Today\n  ~B')
  })

  it('picking a left pad sends the card there and keeps it for the next ones; right has no picker', async () => {
    const user = userEvent.setup()
    await mount('A\nB\nC')
    await user.click(button('New pad'))
    await user.type(screen.getByLabelText('Pad name'), 'Someday')
    await user.click(button('Create'))
    await user.click(screen.getByRole('tab', { name: 'Main' }))
    await user.click(button('Sort'))
    expect(screen.queryByLabelText('Pad for a right or up swipe')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Pad for a left swipe'), 'Someday')
    expect(card().value).toBe('B')
    expect(button('Left: Someday')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}{ArrowLeft}')
    expect(whole()).toBe('\n@Someday\n  \n  A\n  C\n@Today\n  B')
  })

  it('New pad… in the left select makes a pad on the spot and sends the card to it; Cancel changes nothing', async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(button('Sort'))
    await user.selectOptions(screen.getByLabelText('Pad for a left swipe'), 'New pad…')
    await user.type(screen.getByLabelText('Name for the new pad'), 'Someday{Enter}')
    expect(button('Left: Someday')).toBeInTheDocument()
    expect(card().value).toBe('B') // A went to Someday; still sorting Main
    expect(whole()).toBe('B\n@Someday\n  A')
    await user.selectOptions(screen.getByLabelText('Pad for a left swipe'), 'New pad…')
    await user.click(button('Cancel'))
    expect(card().value).toBe('B')
    expect(button('Left: Someday')).toBeInTheDocument()
  })

  it('Cycle moves the card to the bottom of the pad and deals it again at the end; it still counts as to go', async () => {
    const user = userEvent.setup()
    await mount('A\nB\nC')
    await user.click(button('Sort'))
    expect(screen.getByText(/3 to go/)).toBeInTheDocument()
    await user.click(button(/^Cycle/))
    expect(card().value).toBe('B')
    expect(whole()).toBe('B\nC\nA')
    expect(screen.getByText(/3 to go/)).toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    await user.keyboard('c')
    expect(card().value).toBe('C')
    expect(whole()).toBe('C\nA\nB')
    await user.keyboard('{ArrowRight}')
    expect(card().value).toBe('A')
    expect(screen.getByText(/2 to go/)).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    await user.click(button('Back'))
    expect(card().value).toBe('C')
    await user.keyboard('{ArrowRight}{ArrowLeft}{ArrowLeft}')
    expect(screen.getByText('All sorted.')).toBeInTheDocument()
    expect(screen.getByText('1 to Today, 2 to Later')).toBeInTheDocument()
  })

  it("the card's top right shows the hour it is in and an Hours-icon button that opens the picker for that line", async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    const a = Object.values(usePad.getState().rows).find((r) => r.text === 'A')!
    const slot = slotKey(todayKey(), 15)
    cmdSetSlot(slot, [a.id])
    await user.click(button('Sort'))
    expect(screen.getByText(slotLabel(slot, todayKey()))).toBeInTheDocument()
    const asked: string[][] = []
    setSlotPickerOpener((ids) => asked.push([...ids]))
    await user.click(button(/^Hour: .*, change$/))
    expect(asked).toEqual([[a.id]])
    await user.keyboard('{ArrowLeft}')
    expect(card().value).toBe('B')
    expect(button('Put in an hour')).toBeInTheDocument()
  })
})
