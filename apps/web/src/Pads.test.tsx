import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryStore, listPads, pad, shape } from '@hissypad/core'
import { App } from './App'
import { configureLocalStore, usePad } from '@hissypad/state'

async function mount(outline?: string) {
  const rows = outline ? pad(outline) : {}
  configureLocalStore(createMemoryStore(Object.values(rows)))
  usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [] })
  const utils = render(<App />)
  await screen.findByRole('tree')
  return utils
}

const texts = () => shape(usePad.getState().rows)
const tab = (name: string | RegExp) => screen.getByRole('tab', { name })
const rowByText = (t: string) => screen.getAllByRole('treeitem').find((el) => (el.textContent ?? '').replace(/​/g, '').trim() === t)!

describe('pads', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('starts on Main; + makes a pad that opens empty with a line to type into; tabs switch back', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    expect(tab('Main')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'New pad' }))
    await user.type(screen.getByLabelText('Pad name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(tab('Work')).toHaveAttribute('aria-selected', 'true')
    expect(texts()).toBe('')
    expect(screen.getByRole('textbox', { name: 'Line text' })).toBeInTheDocument()
    await user.keyboard('first thing')
    expect(texts()).toBe('first thing')
    await user.click(tab('Main'))
    expect(texts()).toBe('a\nb')
    expect(usePad.getState().editing).toBeNull()
    await user.click(tab('Work'))
    expect(texts()).toBe('first thing')
  })

  it('clicking the open tab renames or deletes the pad; Main has no such sheet', async () => {
    const user = userEvent.setup()
    await mount('a')
    await user.click(screen.getByRole('button', { name: 'New pad' }))
    await user.type(screen.getByLabelText('Pad name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Main', 'Work'])
    await user.click(tab('Work'))
    const name = screen.getByLabelText('Pad name')
    await user.clear(name)
    await user.type(name, 'Werk')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(tab('Werk')).toBeInTheDocument()
    await user.click(tab('Werk'))
    await user.click(screen.getByRole('button', { name: 'Delete pad…' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(tab('Main')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/Deleted “Werk”/)
    await user.click(tab('Main'))
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('Move to… in the toolbar sends the selection to another pad', async () => {
    const user = userEvent.setup()
    await mount('a\nb\n  b1\nc')
    expect(screen.queryByRole('button', { name: /Move to/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New pad' }))
    await user.type(screen.getByLabelText('Pad name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await user.click(tab('Main'))
    await user.click(within(rowByText('b')).getByRole('button', { name: /Select line/ }))
    await user.click(screen.getByRole('button', { name: /Move to/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Work' }))
    expect(texts()).toBe('a\nc')
    expect(screen.getByRole('status')).toHaveTextContent(/Moved 2 lines to “Work”/)
    await user.click(tab('Work'))
    expect(texts()).toBe('b\n  b1\n')
  })

  it('Fresh start keeps what was sent right and archives the rest into a dated pad', async () => {
    const user = userEvent.setup()
    await mount('a\nb\n  b1\nc')
    await user.click(screen.getByRole('button', { name: 'Fresh start…' }))
    expect(screen.queryByRole('tree')).not.toBeInTheDocument()
    const leaving = screen.getByRole('listbox', { name: /move to the new pad/ })
    expect(within(leaving).getAllByRole('option')).toHaveLength(4)
    await user.click(within(leaving).getByRole('option', { name: 'b' }))
    await user.click(screen.getByRole('button', { name: 'Keep the selected lines' }))
    const staying = screen.getByRole('listbox', { name: /stay/ })
    expect(within(staying).getAllByRole('option').map((o) => o.textContent)).toEqual(['b', 'b1'])
    expect(within(leaving).getAllByRole('option')).toHaveLength(2)
    // b1 can come back on its own; it then sits at the top level of the archive.
    await user.click(within(staying).getByRole('option', { name: 'b1' }))
    await user.click(screen.getByRole('button', { name: 'Put the selected lines back' }))
    expect(within(staying).getAllByRole('option').map((o) => o.textContent)).toEqual(['b'])
    const name = screen.getByLabelText('Name for the new pad') as HTMLInputElement
    expect(name.value).toMatch(/^Before \d/)
    await user.clear(name)
    await user.type(name, 'Old stuff')
    await user.click(screen.getByRole('button', { name: 'Start fresh' }))
    await screen.findByRole('tree')
    expect(texts()).toBe('b')
    expect(screen.getByRole('status')).toHaveTextContent(/3 lines went to “Old stuff”/)
    expect(listPads(usePad.getState().all).map((r) => r.text)).toEqual(['Old stuff'])
    await user.click(tab('Old stuff'))
    expect(texts()).toBe('a\nb1\nc')
    // One undo step brings the whole pad back.
    await user.click(tab('Main'))
    await user.keyboard('{Meta>}z{/Meta}')
    expect(texts()).toBe('a\nb\n  b1\nc')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('Escape leaves Fresh start without changing anything', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    await user.click(screen.getByRole('button', { name: 'Fresh start…' }))
    await user.click(screen.getByRole('option', { name: 'a' }))
    await user.click(screen.getByRole('button', { name: 'Keep the selected lines' }))
    await user.keyboard('{Escape}')
    await screen.findByRole('tree')
    expect(texts()).toBe('a\nb')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })
})
