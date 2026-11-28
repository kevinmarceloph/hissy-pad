import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { shape } from '@hissypad/core'
import { cmdNewPad, openPad, resetStore, usePad } from '@hissypad/state'
import { App } from './App'
import { useToast } from './toast'
import { bindMacLinks } from '../platform/mac'
import { authRedirect } from '../platform/os'

type Shell = Window & { hissypadMac?: { version: string; notifications: boolean }; hissypadOpen?: (params: Record<string, string>) => void }

async function mount(outline?: string) {
  resetStore(outline)
  useToast.setState({ text: null, at: 0 })
  location.hash = '#pads'
  render(<App />)
  await screen.findByRole('tree')
}

const texts = () => shape(usePad.getState().rows)
const pads = () => within(screen.getByRole('navigation', { name: 'Pads' }))

describe('the Mac app: a sidebar in place of the top bar', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
    localStorage.clear()
    ;(window as Shell).hissypadMac = { version: 'test', notifications: false }
  })
  afterEach(() => {
    delete (window as Shell).hissypadMac
    location.hash = ''
  })

  it('lists the modes and every pad down the side, and marks the one on screen', async () => {
    await mount('a\nb')
    expect(screen.queryByRole('group', { name: 'Mode' })).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(pads().getByRole('button', { name: /Inbox/ }).getAttribute('aria-current')).toBe('page')
    expect(pads().getByRole('button', { name: /Today/ }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hours' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sort' })).toBeTruthy()
  })

  it('opens a pad from the side, from Sort too, and ends in the Pad mode', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    cmdNewPad('Work')
    openPad(null)
    await user.click(screen.getByRole('button', { name: 'Sort' }))
    expect(screen.getByRole('button', { name: 'Sort' }).getAttribute('aria-current')).toBe('page')
    await user.click(pads().getByRole('button', { name: /Work/ }))
    await screen.findByRole('tree')
    expect(location.hash).toBe('#pads')
    expect(pads().getByRole('button', { name: /^Work/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('heading', { name: 'Work' })).toBeTruthy()
    expect(texts()).toBe('')
    // The open pad has its sheet a press away.
    await user.click(screen.getByRole('button', { name: 'Rename, fold in or delete Work' }))
    expect(screen.getByRole('textbox', { name: 'Pad name' })).toHaveProperty('value', 'Work')
  })

  it('makes a pad from the side and shows it', async () => {
    const user = userEvent.setup()
    await mount('a')
    await user.click(screen.getByRole('button', { name: 'Hours' }))
    await user.click(pads().getByRole('button', { name: 'New pad' }))
    await user.type(screen.getByRole('textbox', { name: 'Pad name' }), 'Trip')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('tree')
    expect(pads().getByRole('button', { name: /^Trip/ }).getAttribute('aria-current')).toBe('page')
  })

  it('opens the new item card when the File menu asks', async () => {
    await mount('a')
    window.dispatchEvent(new CustomEvent('hissypad:menu', { detail: 'new' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('signs in through its own link', () => {
    expect(authRedirect()).toBe('hissypad://auth')
    const calls: unknown[] = []
    const said: string[] = []
    const auth = {
      setSession: (s: unknown) => { calls.push(s); return Promise.resolve({ error: null }) },
      exchangeCodeForSession: (c: unknown) => { calls.push(c); return Promise.resolve({ error: null }) },
    }
    bindMacLinks({ auth } as never, (t) => said.push(t))
    const open = (window as Shell).hissypadOpen!
    open({ access_token: 'a', refresh_token: 'r', type: 'magiclink' })
    open({ code: 'c' })
    open({ error_description: 'Link expired' })
    expect(calls).toEqual([{ access_token: 'a', refresh_token: 'r' }, 'c'])
    expect(said).toEqual(['Sign-in did not go through: Link expired'])
  })
})

describe('in a browser', () => {
  it('keeps the top bar and comes back to the page after a sign-in', async () => {
    Element.prototype.scrollIntoView = () => {}
    await mount('a')
    expect(screen.getByRole('group', { name: 'Mode' })).toBeTruthy()
    expect(screen.getByRole('tablist', { name: 'Pads' })).toBeTruthy()
    expect(authRedirect()).toBe(window.location.origin)
  })
})
