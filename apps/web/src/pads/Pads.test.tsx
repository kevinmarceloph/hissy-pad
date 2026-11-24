import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { listPads, shape } from '@hissypad/core'
import { App } from '../app/App'
import { initPrefs, resetStore, usePad } from '@hissypad/state'

async function mount(outline?: string) {
  resetStore(outline)
  const utils = render(<App />)
  await screen.findByRole('tree')
  return utils
}

const texts = () => shape(usePad.getState().rows)
const tab = (name: string) => screen.getAllByRole('tab').find((t) => t.querySelector('.name')!.textContent === name)!
const rowByText = (t: string) => screen.getAllByRole('treeitem').find((el) => (el.textContent ?? '').replace(/​/g, '').trim() === t)!

describe('pads', () => {
  beforeEach(() => {
    initPrefs({ get: () => null, set: () => {} })
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
    expect(screen.getAllByRole('tab').map((t) => t.querySelector('.name')!.textContent)).toEqual(['Main', 'Work'])
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
    expect(screen.queryByRole('button', { name: 'Move to…' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New pad' }))
    await user.type(screen.getByLabelText('Pad name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await user.click(tab('Main'))
    await user.click(within(rowByText('b')).getByRole('button', { name: /Select line/ }))
    await user.click(screen.getByRole('button', { name: 'Move to…' }))
    await user.click(screen.getByRole('menuitem', { name: 'Work' }))
    expect(texts()).toBe('a\nc')
    expect(screen.getByRole('status')).toHaveTextContent(/Moved 2 lines to “Work”/)
    await user.click(tab('Work'))
    expect(texts()).toBe('b\n  b1\n')
  })

  it('Fresh start keeps what was sent right and archives the rest into a dated pad', async () => {
    const user = userEvent.setup()
    await mount('a\nb\n  b1\nc')
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Fresh start…' }))
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
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Fresh start…' }))
    await user.click(screen.getByRole('option', { name: 'a' }))
    await user.click(screen.getByRole('button', { name: 'Keep the selected lines' }))
    await user.keyboard('{Escape}')
    await screen.findByRole('tree')
    expect(texts()).toBe('a\nb')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('the pad sheet moves a pad left and right among the tabs', async () => {
    const user = userEvent.setup()
    await mount('a')
    for (const name of ['One', 'Two']) {
      await user.click(screen.getByRole('button', { name: 'New pad' }))
      await user.type(screen.getByLabelText('Pad name'), name)
      await user.click(screen.getByRole('button', { name: 'Create' }))
    }
    const names = () => screen.getAllByRole('tab').map((t) => t.querySelector('.name')!.textContent)
    await user.click(tab('Two'))
    expect(screen.getByRole('button', { name: 'Move pad right' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move pad left' }))
    expect(names()).toEqual(['Main', 'Two', 'One'])
    expect(screen.getByRole('button', { name: 'Move pad left' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move pad right' }))
    expect(names()).toEqual(['Main', 'One', 'Two'])
  })

  it('each tab shows how many open lines its pad has, and nothing at zero; blank lines are not counted', async () => {
    const user = userEvent.setup()
    await mount('keep\n\ntrip\n  flights\n  hotel')
    const counts = () => screen.getAllByRole('tab').map((t) => t.querySelector('.n')?.textContent?.trim() ?? '')
    expect(counts()).toEqual(['2'])
    await user.click(within(rowByText('trip')).getByRole('button', { name: 'Select line' }))
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Make pad' }))
    expect(counts()).toEqual(['1', '2'])
    await user.click(screen.getByRole('button', { name: 'New pad' }))
    await user.type(screen.getByLabelText('Pad name'), 'Empty')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(counts()).toEqual(['1', '2', ''])
  })

  it('Pad counts in the menu turns the numbers on the tabs off and back on', async () => {
    const user = userEvent.setup()
    await mount('keep\nthis')
    const counts = () => screen.getAllByRole('tab').map((t) => t.querySelector('.n')?.textContent?.trim() ?? '')
    expect(counts()).toEqual(['2'])
    await user.click(screen.getByRole('button', { name: 'More' }))
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Pad counts' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(counts()).toEqual([''])
    await user.click(toggle)
    expect(counts()).toEqual(['2'])
  })

  it('a top-level header is a sub-pad: Move to lists it as "Pad → Sub-pad", and the chevron beside the tab jumps to it', async () => {
    const user = userEvent.setup()
    await mount('keep\ntrip\n  flights\nlater')
    expect(screen.queryByRole('button', { name: 'Sub-pads of Main' })).toBeNull()
    await user.click(within(rowByText('trip')).getByRole('button', { name: 'Select line' }))
    await user.click(screen.getByRole('button', { name: 'Header' }))
    await user.click(within(rowByText('trip')).getByRole('button', { name: 'Deselect line' }))
    // Send a line of the same pad into the sub-pad.
    await user.click(within(rowByText('later')).getByRole('button', { name: 'Select line' }))
    await user.click(screen.getByRole('button', { name: 'Move to…' }))
    expect(within(screen.getByRole('menu', { name: 'Move to pad' })).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Main → trip'])
    await user.click(screen.getByRole('menuitem', { name: 'Main → trip' }))
    expect(texts()).toBe('keep\n#trip\n  later\n  flights')
    // From another pad, the chevron beside Main lists its sub-pads and opens Main at it.
    await user.click(screen.getByRole('button', { name: 'New pad' }))
    await user.type(screen.getByLabelText('Pad name'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await user.click(screen.getByRole('button', { name: 'Sub-pads of Main' }))
    await user.click(within(screen.getByRole('menu', { name: 'Sub-pads of Main' })).getByRole('menuitem', { name: /trip/ }))
    expect(tab('Main')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('menu', { name: 'Sub-pads of Main' })).toBeNull()
    expect(usePad.getState().reveal?.id).toBe(rowByText('trip').getAttribute('data-id'))
  })

  it('Fold in turns the open pad back into a line of the pad picked, with its lines under it', async () => {
    const user = userEvent.setup()
    await mount('keep\ntrip\n  flights\n  hotel')
    await user.click(within(rowByText('trip')).getByRole('button', { name: 'Select line' }))
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Make pad' }))
    await user.click(tab('trip'))
    await user.click(tab('trip'))
    expect(screen.getByLabelText('Fold into')).toHaveValue('main')
    await user.click(screen.getByRole('button', { name: 'Fold in' }))
    expect(screen.getAllByRole('tab').map((t) => t.querySelector('.name')!.textContent)).toEqual(['Main'])
    expect(texts()).toBe('trip\n  flights\n  hotel\nkeep')
    expect(screen.getByText(/“trip” is a line in Main now/)).toBeInTheDocument()
  })

  it('Make pad in the toolbar turns a line into a tab with its sub items inside', async () => {
    const user = userEvent.setup()
    await mount('keep\ntrip\n  flights\n  hotel')
    await user.click(within(rowByText('trip')).getByRole('button', { name: 'Select line' }))
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Make pad' }))
    expect(screen.getAllByRole('tab').map((t) => t.querySelector('.name')!.textContent)).toEqual(['Main', 'trip'])
    expect(texts()).toBe('keep')
    expect(screen.getByText(/“trip” is a pad now/)).toBeInTheDocument()
    await user.click(tab('trip'))
    expect(texts()).toBe('flights\nhotel')
  })
})
