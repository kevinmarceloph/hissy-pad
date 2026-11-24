import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { idOf, shape } from '@hissypad/core'
import { cmdToggleDone, resetStore, select, usePad } from '@hissypad/state'
import { App } from './App'
import { useToast } from './toast'

async function mount(outline?: string) {
  resetStore(outline)
  useToast.setState({ text: null, at: 0 })
  render(<App />)
  await screen.findByRole('tree')
}

const texts = () => shape(usePad.getState().rows)
const button = (name: string | RegExp) => screen.getByRole('button', { name })

describe('top bar', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
    localStorage.clear()
  })

  it('Clear completed shows only once something is crossed out, then removes it and says how many', async () => {
    const user = userEvent.setup()
    await mount('a\nb\n  b1\nc')
    expect(screen.queryByRole('button', { name: /completed/ })).toBeNull()
    const b = idOf(usePad.getState().rows, 'b')
    select([b], b)
    cmdToggleDone()
    await user.click(await screen.findByRole('button', { name: /^Archive \d+ completed$/ }))
    expect(texts()).toBe('a\nc')
    expect(screen.getByRole('status')).toHaveTextContent('Archived 2 lines.')
    expect(screen.queryByRole('button', { name: /completed/ })).toBeNull()
  })

  it('the theme choice is applied to the page and remembered', async () => {
    const user = userEvent.setup()
    await mount('a')
    await user.click(button('More'))
    await user.selectOptions(screen.getByLabelText('Theme'), 'Dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('hissypad.theme')).toBe('dark')
    await user.selectOptions(screen.getByLabelText('Theme'), 'System')
    expect(document.documentElement.dataset.theme).toBe('')
  })

  it('the switcher goes between Pad, Hours and Sort, and marks the open one', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    expect(button('Pad')).toHaveAttribute('aria-pressed', 'true')
    await user.click(button('Sort'))
    expect(button('Sort')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'Line text' })).toHaveValue('a')
    // Sort sits above the pads: the tabs are still there to pick what to sort next.
    expect(screen.getByRole('tab', { name: /Main/ })).toBeInTheDocument()
    await user.click(button('Hours'))
    expect(button('Hours')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('tab', { name: /Main/ })).toBeNull()
    await user.click(button('Pad'))
    expect(screen.getByRole('tree')).toBeInTheDocument()
  })

  it('with no mode in the address the app opens on Hours', async () => {
    history.replaceState(null, '', '/')
    resetStore('a\nb')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Hours', pressed: true })).toBeInTheDocument()
    expect(screen.queryByRole('tree')).toBeNull()
  })

  it('Hours comes first, and #hours, #pads and #sort open each mode and follow the switcher', async () => {
    const user = userEvent.setup()
    history.replaceState(null, '', '/#sort')
    resetStore('a\nb')
    render(<App />)
    await screen.findByRole('textbox', { name: 'Line text' })
    expect(button('Sort')).toHaveAttribute('aria-pressed', 'true')
    const modes = screen.getAllByRole('button', { name: /^(Hours|Pad|Sort)$/ }).map((b) => b.getAttribute('aria-label'))
    expect(modes).toEqual(['Hours', 'Pad', 'Sort'])
    await user.click(button('Hours'))
    expect(location.hash).toBe('#hours')
    await user.click(button('Pad'))
    expect(location.hash).toBe('#pads')
    location.hash = '#hours'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(await screen.findByRole('button', { name: 'Hours', pressed: true })).toBeInTheDocument()
  })

  it('Done, Archive and Fresh start are behind More; Fresh start still counts as the pad', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull()
    await user.click(button('More'))
    expect(screen.getByRole('menuitem', { name: 'Recently done' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Fresh start…' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(button('Pad')).toHaveAttribute('aria-pressed', 'true')
    await user.click(button('Cancel'))
    expect(screen.getByRole('tree')).toBeInTheDocument()
  })
})
