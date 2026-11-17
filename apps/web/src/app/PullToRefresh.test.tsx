import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { PullToRefresh, PULL_THRESHOLD } from './PullToRefresh'

const sync = vi.hoisted(() => ({ refresh: vi.fn(() => Promise.resolve()) }))
vi.mock('@hissypad/state', async (importActual) => ({ ...(await importActual<typeof import('@hissypad/state')>()), refresh: sync.refresh }))
import { usePad } from '@hissypad/state'

const touch = (y: number) => ({ touches: [{ clientX: 100, clientY: y }] })
const pull = (target: Element, from: number, to: number) => {
  fireEvent.touchStart(target, touch(from))
  fireEvent.touchMove(target, touch(to))
}

describe('PullToRefresh', () => {
  beforeEach(() => {
    sync.refresh.mockClear()
    usePad.setState({ session: { user: { id: 'u1', email: 'k@example.com' } } as unknown as Session, sync: { state: 'idle', pending: 0, lastSyncAt: null, error: null } })
  })

  it('does nothing when signed out', () => {
    usePad.setState({ session: null })
    render(<PullToRefresh />)
    pull(document.body, 10, 400)
    fireEvent.touchEnd(document.body)
    expect(screen.queryByRole('status')).toBeNull()
    expect(sync.refresh).not.toHaveBeenCalled()
  })

  it('a short pull shows the hint and lets go without syncing', () => {
    render(<PullToRefresh />)
    pull(document.body, 10, 50) // 40px of travel, damped to 20
    expect(screen.getByRole('status')).toHaveTextContent('Pull to sync')
    fireEvent.touchEnd(document.body)
    expect(screen.queryByRole('status')).toBeNull()
    expect(sync.refresh).not.toHaveBeenCalled()
  })

  it('a pull past the threshold arms, and releasing syncs then settles', async () => {
    vi.useFakeTimers()
    try {
      render(<PullToRefresh />)
      pull(document.body, 10, 10 + PULL_THRESHOLD * 2 + 20)
      expect(screen.getByRole('status')).toHaveTextContent('Release to sync')
      fireEvent.touchEnd(document.body)
      expect(sync.refresh).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('status')).toHaveTextContent('Syncing…')
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
      expect(screen.getByRole('status')).toHaveTextContent('Synced')
      await act(async () => { await vi.advanceTimersByTimeAsync(1300) })
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says so when the sync failed', async () => {
    vi.useFakeTimers()
    try {
      sync.refresh.mockImplementationOnce(async () => { usePad.setState({ sync: { state: 'error', pending: 1, lastSyncAt: null, error: 'offline' } }) })
      render(<PullToRefresh />)
      pull(document.body, 10, 400)
      fireEvent.touchEnd(document.body)
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })
      expect(screen.getByRole('status')).toHaveTextContent('Sync failed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a pull that starts in a text field or on a bullet', () => {
    render(
      <>
        <textarea aria-label="t" />
        <button type="button" className="bullet">•</button>
        <PullToRefresh />
      </>,
    )
    pull(screen.getByLabelText('t'), 10, 400)
    fireEvent.touchEnd(screen.getByLabelText('t'))
    pull(screen.getByText('•'), 10, 400)
    fireEvent.touchEnd(screen.getByText('•'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(sync.refresh).not.toHaveBeenCalled()
  })

  it('ignores a pull when the page is scrolled down', () => {
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })
    try {
      render(<PullToRefresh />)
      pull(document.body, 10, 400)
      fireEvent.touchEnd(document.body)
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    }
  })
})
