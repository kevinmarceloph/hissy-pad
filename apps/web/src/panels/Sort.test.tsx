import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { shape } from '@hissypad/core'
import { App } from '../app/App'
import { resetStore, tableShape, usePad } from '@hissypad/state'
import { cmdSetSlot, setSlotPickerOpener } from '@hissypad/state/hours'
import { slotKey, slotLabel, todayKey } from '@hissypad/core'

async function mount(outline: string) {
  resetStore(outline)
  render(<App />)
  await screen.findByRole('tree')
}

const whole = () => tableShape()
const card = () => screen.getByRole('textbox', { name: 'Line text' }) as HTMLTextAreaElement
const button = (name: string | RegExp) => screen.getByRole('button', { name })

describe('sort', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('Archive (the button after Skip, or A) sends the card to the Archive, Back restores it', async () => {
    const user = userEvent.setup()
    await mount('A\nB\nC')
    await user.click(button('Sort'))
    await user.keyboard('a')
    expect(card().value).toBe('B')
    expect(whole()).toBe('B\nC')
    await user.click(button(/^Archive/))
    expect(whole()).toBe('C')
    await user.click(button('Back'))
    expect(card().value).toBe('B')
    await user.keyboard('aa')
    expect(screen.getByText('3 archived')).toBeInTheDocument()
  })

  it("the card's pad icon leaves Sort for the pad, with the line selected and scrolled to the top", async () => {
    const user = userEvent.setup()
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) { const id = (this as HTMLElement).dataset?.id; if (id) scrolled.push(id) }
    await mount('A\nB\nC')
    await user.click(button('Sort'))
    await user.keyboard('s')
    expect(card().value).toBe('B')
    await user.click(button('See it in the pad'))
    expect(screen.queryByRole('textbox', { name: 'Line text' })).toBeNull()
    const s = usePad.getState()
    const b = Object.values(s.rows).find((r) => r.text === 'B')!
    expect(s.selection).toEqual([b.id])
    expect(scrolled).toContain(b.id)
  })

  it('the title picks the pad to sort, with no pad tabs on screen', async () => {
    const user = userEvent.setup()
    resetStore('A\n  A1\n  A2\nB')
    render(<App />)
    await screen.findByRole('tree')
    await user.click(button('Sort'))
    expect(screen.queryByRole('tablist')).toBeNull()
    const pick = () => screen.getByRole('combobox', { name: 'Pad to sort' }) as HTMLSelectElement
    // Each pad says how many top-level lines it holds, sub items left out.
    expect([...pick().options].map((o) => o.text)).toEqual(['Today (0)', 'Inbox (2)', 'Later (0)'])
    await user.selectOptions(pick(), 'Inbox (2)')
    expect(pick()).toHaveDisplayValue('Inbox (2)')
    expect(card().value).toBe('A')
    await user.selectOptions(pick(), 'Later (0)')
    expect(pick()).toHaveDisplayValue('Later (0)')
    expect(screen.getByText('Nothing to sort in this pad.')).toBeInTheDocument()
  })

  it('arrow keys and buttons send cards left, right and up; Back takes one back; the end shows a tally', async () => {
    const user = userEvent.setup()
    await mount('A\nB\n  B1\nC\nD')
    await user.click(button('Sort'))
    expect(card().value).toBe('A')
    expect(screen.getByText(/4 to go/)).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(card().value).toBe('B')
    expect(screen.getByRole('tree')).toHaveTextContent('B1') // its sub items, as the pad's rows
    await user.click(button('Right: Today'))
    await user.keyboard('{ArrowUp}')
    expect(whole()).toBe('D\n@Today\n  ~C\n  B\n    B1\n@Later\n  A')
    await user.click(button('Back'))
    expect(card().value).toBe('C')
    expect(whole()).toBe('C\nD\n@Today\n  B\n    B1\n@Later\n  A')
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
    await user.click(button('Add a sub item'))
    await user.keyboard('first step{Enter}second{Enter}deep{Tab}')
    expect(screen.getByRole('toolbar', { name: 'Current line' })).toBeInTheDocument()
    expect(whole()).toBe('!A\n  first step\n  second\n    deep\nB')
    // Escape leaves the field with the line selected: the arrows are the selection's, not the cards'.
    await user.keyboard('{Escape}{ArrowUp}')
    expect(card().value).toBe('!A')
    await user.keyboard('{Escape}{ArrowRight}')
    expect(whole()).toBe('B\n@Today\n  !A\n    first step\n    second\n      deep')
    expect(card().value).toBe('B')
  })

  it('the card\'s line is one line: Return closes the field and a pasted break becomes a space', async () => {
    const user = userEvent.setup()
    await mount('A\n  A1\nB')
    await user.click(button('Sort'))
    await user.click(card())
    await user.keyboard('{End}x{Enter}')
    expect(card().value).toBe('Ax')
    expect(document.activeElement).not.toBe(card())
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
    expect(whole()).toBe('\n@Today\n  ~B\n@Later\n  A')
  })

  it('picking a left pad sends the card there and keeps it for the next ones', async () => {
    const user = userEvent.setup()
    await mount('A\nB\nC')
    await user.click(button('New pad'))
    await user.type(screen.getByLabelText('Pad name'), 'Someday')
    await user.click(button('Create'))
    await user.click(screen.getByRole('tab', { name: 'Inbox' }))
    await user.click(button('Sort'))
    await user.selectOptions(screen.getByLabelText('Pad for a left swipe'), 'Someday')
    expect(card().value).toBe('B')
    expect(button('Left: Someday')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}{ArrowLeft}')
    expect(whole()).toBe('\n@Today\n  B\n@Someday\n  C\n  A\n  ')
  })

  it('New pad… in the left select makes a pad on the spot and sends the card to it; Cancel changes nothing', async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(button('Sort'))
    await user.selectOptions(screen.getByLabelText('Pad for a left swipe'), 'New pad…')
    await user.type(screen.getByLabelText('Name for the new pad'), 'Someday{Enter}')
    expect(button('Left: Someday')).toBeInTheDocument()
    expect(card().value).toBe('B') // A went to Someday; still sorting the Inbox
    expect(whole()).toBe('B\n@Someday\n  A')
    await user.selectOptions(screen.getByLabelText('Pad for a left swipe'), 'New pad…')
    await user.click(button('Cancel'))
    expect(card().value).toBe('B')
    expect(button('Left: Someday')).toBeInTheDocument()
  })

  it('the cog beside the right button picks its pad and sends the card there; up follows it', async () => {
    const user = userEvent.setup()
    await mount('A\nB\nC')
    await user.click(button('Sort'))
    expect(button('Right: Today')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Pad for a right or up swipe'), 'Later')
    expect(button('Right: Later')).toBeInTheDocument()
    expect(card().value).toBe('B')
    await user.keyboard('{ArrowUp}')
    expect(whole()).toBe('C\n@Later\n  ~B\n  A')
  })

  it('down cycles: the card goes to the bottom of the pad and is dealt again at the end; it still counts as to go', async () => {
    const user = userEvent.setup()
    await mount('A\nB\nC')
    await user.click(button('Sort'))
    expect(screen.getByText(/3 to go/)).toBeInTheDocument()
    await user.click(button('Down: cycle'))
    expect(card().value).toBe('B')
    expect(whole()).toBe('B\nC\nA')
    expect(screen.getByText(/3 to go/)).toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
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
