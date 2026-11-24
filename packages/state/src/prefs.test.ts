import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, initPrefs, takeLegacyHiddenCounts, usePrefs } from './prefs'

function memory(initial: Record<string, string> = {}) {
  const m = { ...initial }
  return { m, store: { get: (k: string) => m[k] ?? null, set: (k: string, v: string | null) => { if (v === null) delete m[k]; else m[k] = v } } }
}

describe('prefs', () => {
  beforeEach(() => initPrefs(memory().store))

  it('the hidden counts a device saved are handed over once, then gone from it', () => {
    const { m, store } = memory({ 'hissypad.prefs': '{"hiddenCounts":["p1","Today",3]}' })
    initPrefs(store)
    expect(takeLegacyHiddenCounts()).toEqual(['p1', 'Today'])
    expect(takeLegacyHiddenCounts()).toEqual([])
    initPrefs(memory(m).store)
    expect(takeLegacyHiddenCounts()).toEqual([])
  })

  it('a bad saved value reads as the defaults', () => {
    initPrefs(memory({ 'hissypad.prefs': '{nope' }).store)
    expect(usePrefs.getState()).toEqual(DEFAULT_PREFS)
    expect(takeLegacyHiddenCounts()).toEqual([])
  })
})
