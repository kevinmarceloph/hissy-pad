// Sort keeps a pad of its own, apart from the Pads tab's.
import { beforeEach, describe, expect, it } from 'vitest'
import { findFixedPad, idOf } from '@hissypad/core'
import { resetStore } from './testing'
import { loadPad, openPad, PAD_KEY, setSortMode, SORT_PAD_KEY, usePad } from './store'
import { cmdOpenHit } from './search'

const fixed = (name: 'Today' | 'Later') => findFixedPad(usePad.getState().all, name)!.id
const shown = () => usePad.getState().padId

describe('a pad for Sort and one for the Pads tab', () => {
  let mem: ReturnType<typeof resetStore>
  beforeEach(async () => {
    mem = resetStore('A\nB')
    await loadPad()
    setSortMode(false)
  })

  it('starts on the same pad, then each side keeps its own', () => {
    openPad(fixed('Today'))
    setSortMode(true)
    expect(shown()).toBe(fixed('Today'))
    openPad(fixed('Later'))
    setSortMode(false)
    expect(shown()).toBe(fixed('Today'))
    openPad(null)
    setSortMode(true)
    expect(shown()).toBe(fixed('Later'))
    setSortMode(false)
    expect(shown()).toBeNull()
  })

  it('remembers each under its own key', async () => {
    openPad(fixed('Today'))
    setSortMode(true)
    openPad(fixed('Later'))
    expect(await mem.getMeta(PAD_KEY)).toBe(fixed('Today'))
    expect(await mem.getMeta(SORT_PAD_KEY)).toBe(fixed('Later'))
    // After a reload, Sort opens on its own pad again.
    setSortMode(false)
    await loadPad()
    expect(shown()).toBe(fixed('Today'))
    setSortMode(true)
    expect(shown()).toBe(fixed('Later'))
  })

  it('a jump to a line from Sort lands in the Pads tab on the line’s pad', () => {
    setSortMode(true)
    const a = idOf(usePad.getState().all, 'A')
    openPad(fixed('Later'))
    cmdOpenHit(a)
    expect(shown()).toBeNull()
    setSortMode(false) // the app's own switch afterwards changes nothing
    expect(shown()).toBeNull()
    expect(usePad.getState().selection).toEqual([a])
  })
})
