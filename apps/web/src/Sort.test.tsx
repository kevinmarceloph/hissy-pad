import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryStore, pad, shape } from '@hissypad/core'
import { App } from './App'
import { configureLocalStore, usePad, useSort } from '@hissypad/state'

async function mount(outline: string) {
  configureLocalStore(createMemoryStore(Object.values(pad(outline))))
  usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [] })
  useSort.setState({ left: null, right: null })
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

  it('arrow keys and buttons send cards left, right and up; Back takes one back; the end shows a tally', async () => {
    const user = userEvent.setup()
    await mount('A\nB\n  B1\nC\nD')
    await user.click(button('Sort…'))
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
    await user.keyboard('{ArrowDown}{ArrowRight}')
    expect(screen.getByText('All sorted.')).toBeInTheDocument()
    expect(screen.getByText('2 to Today, 1 to Later, 1 skipped')).toBeInTheDocument()
    await user.click(button('Done'))
    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(shape(usePad.getState().rows)).toBe('C')
  })

  it('the card edits before it goes: text, a new sub item, and arrows inside a field do not sort', async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(button('Sort…'))
    await user.click(card())
    await user.keyboard('{ArrowLeft}!')
    expect(card().value).toBe('!A')
    await user.type(screen.getByRole('textbox', { name: 'Add a sub item' }), 'first step{Enter}second{Enter}')
    expect(whole()).toBe('!A\n  first step\n  second\nB')
    await user.keyboard('{Escape}{ArrowRight}')
    expect(whole()).toBe('B\n@Today\n  !A\n    first step\n    second')
  })

  it('a drag past the threshold is a swipe; a short one springs back', async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(button('Sort…'))
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

  it('each side can point at another pad or Main', async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(button('New pad'))
    await user.type(screen.getByLabelText('Pad name'), 'Someday')
    await user.click(button('Create'))
    await user.click(screen.getByRole('tab', { name: 'Main' }))
    await user.click(button('Sort…'))
    await user.selectOptions(screen.getByLabelText('Pad for a left swipe'), 'Someday')
    expect(button('Left: Someday')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    await user.selectOptions(screen.getByLabelText('Pad for a right or up swipe'), 'Main')
    await user.click(button('Up: Main, done'))
    expect(whole()).toBe('~B\n@Someday\n  \n  A')
  })
})
