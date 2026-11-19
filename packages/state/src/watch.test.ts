import { describe, expect, it } from 'vitest'
import { watchHandoffDue, watchSignedIn, WATCH_RETRY_MAX_MS, WATCH_RETRY_MS } from './watch'

const state = (user: string) => JSON.stringify({ user })

describe('signing the watch in', () => {
  it('hands a sign-in over when the watch is signed out or on another account', () => {
    expect(watchHandoffDue(state(''), 'me', 0, 0, 1000)).toBe(true)
    expect(watchHandoffDue(state('someone-else'), 'me', 0, 0, 1000)).toBe(true)
  })

  it('does nothing without a watch app, without an account here, or when the watch already has it', () => {
    expect(watchHandoffDue(null, 'me', 0, 0, 1000)).toBe(false)
    expect(watchHandoffDue(state(''), null, 0, 0, 1000)).toBe(false)
    expect(watchHandoffDue(state('me'), 'me', 0, 0, 1000)).toBe(false)
    expect(watchSignedIn(state('me'), 'me')).toBe(true)
    expect(watchSignedIn(state(''), 'me')).toBe(false)
    expect(watchSignedIn(null, 'me')).toBe(false)
  })

  it('ignores a report it cannot read', () => {
    expect(watchHandoffDue('not json', 'me', 0, 0, 1000)).toBe(false)
    expect(watchHandoffDue('{"user":7}', 'me', 0, 0, 1000)).toBe(false)
    expect(watchHandoffDue('null', 'me', 0, 0, 1000)).toBe(false)
    expect(watchSignedIn('not json', 'me')).toBe(false)
  })

  it('tries again twice as far apart each time, up to an hour', () => {
    const t = 1_000_000
    expect(watchHandoffDue(state(''), 'me', 1, t, t + WATCH_RETRY_MS - 1)).toBe(false)
    expect(watchHandoffDue(state(''), 'me', 1, t, t + WATCH_RETRY_MS)).toBe(true)
    expect(watchHandoffDue(state(''), 'me', 2, t, t + WATCH_RETRY_MS * 2 - 1)).toBe(false)
    expect(watchHandoffDue(state(''), 'me', 2, t, t + WATCH_RETRY_MS * 2)).toBe(true)
    expect(watchHandoffDue(state(''), 'me', 30, t, t + WATCH_RETRY_MAX_MS - 1)).toBe(false)
    expect(watchHandoffDue(state(''), 'me', 30, t, t + WATCH_RETRY_MAX_MS)).toBe(true)
  })
})
