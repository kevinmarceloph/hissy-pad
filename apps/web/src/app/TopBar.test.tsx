import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

  it('Delete done is off until something is crossed out, then removes it and says how many', async () => {
    const user = userEvent.setup()
    await mount('a\nb\n  b1\nc')
    expect(button('Delete done')).toBeDisabled()
    const b = idOf(usePad.getState().rows, 'b')
    select([b], b)
    cmdToggleDone()
    await user.click(await screen.findByRole('button', { name: 'Delete done' }))
    expect(texts()).toBe('a\nc')
    expect(screen.getByRole('status')).toHaveTextContent('Deleted 2 lines.')
  })

  it('Paste in… adds an outline at the top or the bottom', async () => {
    const user = userEvent.setup()
    await mount('a')
    await user.click(button('Paste in…'))
    const dlg = screen.getByRole('dialog', { name: 'Paste an outline' })
    expect(within(dlg).getByRole('button', { name: 'Add at top' })).toBeDisabled()
    await user.type(within(dlg).getByLabelText('Outline text'), 'one{Enter}  two')
    await user.click(within(dlg).getByRole('button', { name: 'Add at top' }))
    expect(texts()).toBe('one\n  two\na')
    expect(screen.getByRole('status')).toHaveTextContent('Added 2 lines')
    await user.click(button('Paste in…'))
    await user.type(screen.getByLabelText('Outline text'), 'last')
    await user.click(screen.getByRole('button', { name: 'Add at bottom' }))
    expect(texts()).toBe('one\n  two\na\nlast')
  })

  it('Copy all puts the whole pad on the clipboard as an outline', async () => {
    const user = userEvent.setup() // installs a clipboard on navigator
    await mount('a\n  a1\nb')
    await user.click(button('Copy all'))
    expect(await screen.findByText('Copied the whole pad as text')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('- a\n  - a1\n- b')
  })

  it('the theme choice is applied to the page and remembered', async () => {
    const user = userEvent.setup()
    await mount('a')
    await user.selectOptions(screen.getByLabelText('Theme'), 'Dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('hissypad.theme')).toBe('dark')
    await user.selectOptions(screen.getByLabelText('Theme'), 'System')
    expect(document.documentElement.dataset.theme).toBe('')
  })

  it('Sort… and Fresh start… are off while another view is open, and Done comes back to the pad', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    await user.click(button('Fresh start…'))
    expect(button('Sort…')).toBeDisabled()
    expect(button('Delete done')).toBeDisabled()
    await user.click(button('Cancel'))
    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(button('Sort…')).toBeEnabled()
  })
})
