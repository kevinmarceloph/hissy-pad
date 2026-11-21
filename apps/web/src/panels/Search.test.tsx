import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { idOf } from '@hissypad/core'
import { cmdMoveToPad, cmdNewPad, cmdToggleCollapsed, openPad, resetStore, select, usePad } from '@hissypad/state'
import { App } from '../app/App'

// Main: milk and a folded Trip; a second pad, Work, with one line. Main is on screen.
async function mount() {
  resetStore('Buy milk\nTrip\n  Book flights\nmilk run')
  render(<App />)
  await screen.findByRole('tree')
  const work = cmdNewPad('Work')
  openPad(null)
  const id = (t: string) => idOf(usePad.getState().rows, t)
  select([id('milk run')], id('milk run'))
  cmdMoveToPad(work)
  select([id('Trip')], id('Trip'))
  cmdToggleCollapsed()
  select([], null)
  return work
}

const field = () => screen.getByRole('combobox', { name: 'Search every pad', hidden: true })
const panel = () => document.querySelector<HTMLDialogElement>('dialog.search')!
const found = () => within(screen.getByRole('listbox', { name: 'Lines found', hidden: true })).queryAllByRole('option')
const options = () => found().map((o) => o.querySelector('.txt')!.textContent)
const selectedText = () => usePad.getState().selection.map((id) => usePad.getState().rows[id]!.text)

describe('search', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('the Search button lists lines from every pad, and Enter on one opens its pad with the line selected', async () => {
    const user = userEvent.setup()
    const work = await mount()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.type(field(), 'milk')
    expect(options()).toEqual(['Buy milk', 'milk run'])
    expect(screen.getByRole('group', { name: 'Work' })).toBeInTheDocument()
    expect(screen.getByText('2 lines.')).toBeInTheDocument()
    expect(found()[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(found()[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(usePad.getState().padId).toBe(work)
    expect(selectedText()).toEqual(['milk run'])
    expect(panel()).not.toHaveAttribute('open')
    expect(field()).toHaveValue('')
  })

  it('Cmd+K opens it while a line is being typed in; a click goes to a line under a fold and unfolds it', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(screen.getByText('Buy milk'))
    fireEvent.keyDown(document.activeElement!, { key: 'k', metaKey: true })
    expect(panel()).toHaveAttribute('open')
    await user.type(field(), 'FLIGHTS')
    expect(options()).toEqual(['Book flights'])
    expect(found()[0]!.querySelector('mark')).toHaveTextContent('flights')
    expect(found()[0]!.querySelector('.sub')).toHaveTextContent('Trip')
    await user.click(found()[0]!)
    expect(usePad.getState().padId).toBeNull()
    expect(selectedText()).toEqual(['Book flights'])
    expect(usePad.getState().editing).toBeNull()
    expect(screen.getByText('Book flights')).toBeInTheDocument()
  })

  it('the Close button closes the panel and clears the field', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.type(field(), 'milk')
    await user.click(within(panel()).getByRole('button', { name: 'Close' }))
    expect(panel().open).toBe(false)
    expect(field()).toHaveValue('')
  })

  it('says so when nothing is found, and Cmd+K does nothing from Sort', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.type(field(), 'zebra')
    expect(options()).toEqual([])
    expect(screen.getByText('Nothing found.')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    panel().close()
    await user.click(screen.getByRole('button', { name: 'Sort…' }))
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(panel()).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  })
})
