import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { findFixedPad, shape } from '@hissypad/core'
import { App } from '../app/App'
import { deliverBoomerangs, openPad, resetStore, stopBoomerangTimer, tableShape, usePad } from '@hissypad/state'

async function mount(outline: string) {
  resetStore(outline)
  history.replaceState(null, '', '#pads')
  const utils = render(<App />)
  await screen.findByRole('tree')
  return utils
}

const rowByText = (t: string) => screen.getAllByRole('treeitem').find((el) => (el.textContent ?? '').replace(/​/g, '').trim() === t)!

describe('Boomerang', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
    stopBoomerangTimer()
  })

  // The picker is in the chunk the app loads on first use, so the first wait is a long one.
  it('the floating button sends a line out until tomorrow; Later lists it and brings it back', { timeout: 15000 }, async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(within(rowByText('A')).getByRole('button', { name: /Select line/ }))
    await user.click(screen.getByRole('button', { name: /^Boomerang/ }))
    await user.click(await screen.findByRole('button', { name: /^Tomorrow/ }, { timeout: 8000 }))
    expect(shape(usePad.getState().rows)).toBe('B')
    expect(tableShape()).toMatch(/^B\n>\d{4}-\d\d-\d\d A$/)
    expect(screen.getByRole('status').textContent).toMatch(/1 line is out until tomorrow/)

    // Later has it as a row under its own lines, under its day's heading.
    act(() => void openPad(findFixedPad(usePad.getState().all, 'Later')!.id))
    expect(await screen.findByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument()
    await user.click(within(rowByText('A')).getByRole('button', { name: /Select line/ }))
    await user.click(screen.getByRole('button', { name: /^Boomerang/ }))
    await user.click(await screen.findByRole('button', { name: 'Back now' }))
    expect(tableShape()).toBe('B\n@Later\n  A')
    expect(shape(usePad.getState().rows)).toBe('A')
    expect(screen.queryByRole('heading', { name: 'Tomorrow' })).toBeNull()
  })

  it('a line that came back has a dot, which a press takes off', async () => {
    const user = userEvent.setup()
    await mount('A\nB')
    await user.click(within(rowByText('B')).getByRole('button', { name: /Select line/ }))
    await user.click(screen.getByRole('button', { name: /^Boomerang/ }))
    await user.click(await screen.findByRole('button', { name: /^Tomorrow/ }, { timeout: 8000 }))
    await act(async () => void (await deliverBoomerangs(new Date(Date.now() + 3 * 86400_000))))
    expect(tableShape()).toBe('A\n@Later\n  *B')
    act(() => void openPad(findFixedPad(usePad.getState().all, 'Later')!.id))
    await user.click(within(rowByText('B')).getByRole('button', { name: /Came back from a boomerang/ }))
    expect(tableShape()).toBe('A\n@Later\n  B')
  })
})
