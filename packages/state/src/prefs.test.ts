import { beforeEach, describe, expect, it } from 'vitest'
import { countShown, DEFAULT_PREFS, initPrefs, toggleCount, usePrefs } from './prefs'

function memory(initial: Record<string, string> = {}) {
  const m = { ...initial }
  return { m, store: { get: (k: string) => m[k] ?? null, set: (k: string, v: string | null) => { if (v === null) delete m[k]; else m[k] = v } } }
}

describe('prefs', () => {
  beforeEach(() => initPrefs(memory().store))

  it('every pad count is on until turned off on that pad, and the choice is kept', () => {
    const { m, store } = memory()
    initPrefs(store)
    expect(countShown(usePrefs.getState().hiddenCounts, 'Today')).toBe(true)
    toggleCount('Today')
    toggleCount('p1')
    expect(countShown(usePrefs.getState().hiddenCounts, 'Today')).toBe(false)
    expect(countShown(usePrefs.getState().hiddenCounts, 'Later')).toBe(true)
    toggleCount('Today')
    initPrefs(memory(m).store)
    expect(usePrefs.getState().hiddenCounts).toEqual(['p1'])
  })

  it('the old global switch reads as every count on', () => {
    initPrefs(memory({ 'hissypad.prefs': '{"padCounts":false}' }).store)
    expect(usePrefs.getState()).toEqual(DEFAULT_PREFS)
  })

  it('a bad saved value reads as the defaults', () => {
    initPrefs(memory({ 'hissypad.prefs': '{nope' }).store)
    expect(usePrefs.getState()).toEqual(DEFAULT_PREFS)
  })
})
