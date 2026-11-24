import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, initPrefs, setPref, usePrefs } from './prefs'

function memory(initial: Record<string, string> = {}) {
  const m = { ...initial }
  return { m, store: { get: (k: string) => m[k] ?? null, set: (k: string, v: string | null) => { if (v === null) delete m[k]; else m[k] = v } } }
}

describe('prefs', () => {
  beforeEach(() => initPrefs(memory().store))

  it('pad counts are on until turned off', () => {
    expect(usePrefs.getState().padCounts).toBe(true)
  })

  it('a change is saved and read back on the next start', () => {
    const { m, store } = memory()
    initPrefs(store)
    setPref('padCounts', false)
    expect(usePrefs.getState().padCounts).toBe(false)
    initPrefs(memory(m).store)
    expect(usePrefs.getState().padCounts).toBe(false)
  })

  it('a bad saved value reads as the defaults', () => {
    initPrefs(memory({ 'hissypad.prefs': '{nope' }).store)
    expect(usePrefs.getState()).toEqual(DEFAULT_PREFS)
  })
})
