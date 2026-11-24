import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { idOf, scopePad, shape } from '@hissypad/core'
import { clock, cmdDeleteSelection, cmdMoveToPad, cmdNewPad, openPad, resetStore, select, setAll, usePad } from '@hissypad/state'
import { App } from '../app/App'

const all = () => usePad.getState().all
const id = (t: string) => Object.values(all()).find((r) => r.text === t)!.id
const inbox = () => shape(scopePad(all(), null))
// Archive these lines of the pad on screen, as one archive of its own.
const archive = (...texts: string[]) => {
  clock.observe(new Date(Date.parse(clock.last()) + 5000).toISOString())
  const ids = texts.map((t) => idOf(usePad.getState().rows, t))
  select(ids, ids[0]!)
  cmdDeleteSelection()
  select([], null)
}

// The Inbox holds keep, a Trip tree and two more lines; a second pad, Work, holds one.
async function mount() {
  resetStore('keep\nTrip\n  Flights\n  Hotel\nmilk\nbread\nreport')
  render(<App />)
  await screen.findByRole('tree')
  const work = cmdNewPad('Work')
  openPad(null)
  select([id('report')], id('report'))
  cmdMoveToPad(work)
  select([], null)
  return work
}

const openArchive = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'More' }))
  await user.click(screen.getByRole('menuitem', { name: 'Archive' }))
  return screen.getByRole('tree', { name: 'Archived lines' })
}
const lines = () => screen.queryAllByRole('treeitem')
// Each line as "words [chip]", indented by its level.
const listed = () => lines().map((el) => `${'  '.repeat(Number(el.getAttribute('aria-level')) - 1)}${el.querySelector('.text')!.textContent}${el.querySelector('.src') ? ` [${el.querySelector('.src')!.textContent}]` : ''}`)
const line = (t: string) => lines().find((el) => el.querySelector('.text')!.textContent === t)!

describe('the Archive screen', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('is a screen of its own: the newest archive first, lines as the pad draws them, each with its pad', async () => {
    const user = userEvent.setup()
    const work = await mount()
    archive('Trip')
    openPad(work)
    archive('report')
    openPad(null)
    await openArchive(user)
    expect(screen.getByRole('heading', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Archive' })).toBeNull()
    expect(location.hash).toBe('#archive')
    expect(listed()).toEqual(['report [Work]', 'Trip [Inbox]', '  Flights', '  Hotel'])
    expect(screen.getByText('Today')).toBeInTheDocument()
    // Not the pad: no tabs, no mode lit, nothing to type in.
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pad', pressed: true })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Back to the pad' }))
    expect(location.hash).toBe('#pads')
  })

  it('says so when nothing is archived', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(screen.getByText('Nothing is archived.')).toBeInTheDocument()
  })

  it('a click selects a line, Shift a run; Unarchive is the one action and puts each at the top of its pad', async () => {
    const user = userEvent.setup()
    const work = await mount()
    archive('milk')
    archive('Trip')
    openPad(work)
    archive('report')
    openPad(null)
    await openArchive(user)
    expect(screen.queryByRole('toolbar')).toBeNull()
    await user.click(line('report'))
    expect(line('report')).toHaveAttribute('aria-selected', 'true')
    const bar = screen.getByRole('toolbar', { name: 'Selected lines' })
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Unarchive', '×'])
    // A line under a selected one goes with it.
    await user.click(line('Trip'))
    expect(line('Flights')).toHaveClass('is-selected-child')
    expect(bar).toHaveTextContent('4 lines')
    await user.click(line('Trip'))
    await user.keyboard('{Shift>}')
    await user.click(line('milk'))
    await user.keyboard('{/Shift}')
    expect(lines().filter((el) => el.getAttribute('aria-selected') === 'true').map((el) => el.querySelector('.text')!.textContent)).toEqual(['report', 'Trip', 'Flights', 'Hotel', 'milk'])
    await user.click(within(bar).getByRole('button', { name: 'Unarchive' }))
    expect(screen.getByRole('status')).toHaveTextContent('Unarchived 5 lines to Work and Inbox.')
    expect(inbox()).toBe('Trip\n  Flights\n  Hotel\nmilk\nkeep\nbread')
    // Above the blank line the pad was left with when its one line went.
    expect(shape(scopePad(all(), work))).toBe('report\n')
    // Still on the Archive, which is empty now.
    expect(screen.getByText('Nothing is archived.')).toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('a sub item unarchived alone leaves what it sat under in the archive', async () => {
    const user = userEvent.setup()
    await mount()
    archive('Trip')
    await openArchive(user)
    await user.click(line('Hotel'))
    await user.keyboard('{Enter}')
    expect(inbox()).toBe('Hotel\nkeep\nmilk\nbread')
    expect(listed()).toEqual(['Trip [Inbox]', '  Flights'])
    // Cmd+Z takes it back; Esc clears a selection.
    await user.keyboard('{Meta>}z{/Meta}')
    expect(listed()).toEqual(['Trip [Inbox]', '  Flights', '  Hotel'])
    await user.click(line('Trip'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('opens on the last 30 days, with the older lines behind a link', async () => {
    const user = userEvent.setup()
    await mount()
    archive('milk')
    archive('bread')
    const old = id('milk')
    setAll({ ...all(), [old]: { ...all()[old]!, deletedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() } })
    await openArchive(user)
    expect(listed()).toEqual(['bread [Inbox]'])
    await user.click(screen.getByRole('button', { name: 'Show the 1 older line' }))
    expect(listed()).toEqual(['bread [Inbox]', 'milk [Inbox]'])
  })
})
