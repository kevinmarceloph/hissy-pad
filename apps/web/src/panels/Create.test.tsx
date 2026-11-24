import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { idOf } from '@hissypad/core'
import { App } from '../app/App'
import { cmdNewPad, openPad, resetStore, tableShape, usePad } from '@hissypad/state'

async function mount(outline: string) {
  resetStore(outline)
  render(<App />)
  await screen.findByRole('tree')
}

const whole = () => tableShape()
const button = (name: string | RegExp) => screen.getByRole('button', { name })
const line = () => screen.getByRole('textbox', { name: 'Line text' }) as HTMLTextAreaElement

describe('the new item card', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('the + beside Search adds a line at the top of the open pad; Return keeps it', async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(button('New item'))
    expect(screen.getByRole('dialog', { name: 'New item' })).toBeInTheDocument()
    expect(line()).toHaveFocus()
    await user.keyboard('Call Ana{Enter}')
    expect(screen.queryByRole('dialog', { name: 'New item' })).toBeNull()
    expect(whole()).toBe('Call Ana\nA\nB')
    expect(usePad.getState().zoomId).toBeNull()
    await screen.findByRole('tree')
  })

  it('sub items are the pad\'s own rows and toolbar, under the new line', async () => {
    const user = userEvent.setup()
    await mount('A')
    await user.click(button('New item'))
    await user.keyboard('Trip')
    await user.click(button('Add a sub item'))
    await user.keyboard('flights{Enter}dates{Tab}')
    expect(screen.getByRole('toolbar', { name: 'Current line' })).toBeInTheDocument()
    expect(whole()).toBe('Trip\n  flights\n    dates\nA')
    await user.click(button('Add'))
    expect(whole()).toBe('Trip\n  flights\n    dates\nA')
  })

  it('goes to the pad picked, and Cancel takes it all back', async () => {
    const user = userEvent.setup()
    await mount('A')
    const work = cmdNewPad('Work')
    openPad(null)
    await user.click(button('New item'))
    await user.keyboard('N')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Where the new item goes' }), 'Work')
    expect(usePad.getState().all[idOf(usePad.getState().all, 'N')]!.parentId).toBe(work)
    await user.click(button('Cancel'))
    expect(whole()).not.toContain('N')
    expect(usePad.getState().future).toEqual([])

    await user.click(button('New item'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Where the new item goes' }), 'Work')
    await user.keyboard('M')
    await user.click(button('See it in the pad'))
    expect(usePad.getState().padId).toBe(work)
    expect(usePad.getState().selection).toEqual([idOf(usePad.getState().all, 'M')])
  })

  it('a card left without a word adds nothing', async () => {
    const user = userEvent.setup()
    await mount('A')
    await user.click(button('New item'))
    await user.click(button('Add a sub item'))
    await user.click(button('Cancel'))
    expect(whole()).toBe('A')
  })
})
