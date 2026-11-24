// Per-device preferences: kept on the device (localStorage on web, AsyncStorage on the
// phone), not synced. The platform hands in its storage and the saved values at start.
import { create } from 'zustand'
import { fixedPadOf, type PadId, type Rows } from '@hissypad/core'

export interface Prefs {
  // The pads whose tab leaves out its number of open lines (each pad's count is on until
  // turned off there), by countKey. A pad's sub-pads follow it.
  hiddenCounts: string[]
}

export const DEFAULT_PREFS: Prefs = { hiddenCounts: [] }

// A pad's key for hiddenCounts: the fixed pads by name (their row can be remade or folded
// into another one), any other pad by its id.
export function countKey(all: Rows, id: PadId): string {
  return fixedPadOf(all, id) ?? id!
}

export function countShown(hidden: readonly string[], key: string): boolean {
  return !hidden.includes(key)
}

export function toggleCount(key: string) {
  const hidden = usePrefs.getState().hiddenCounts
  setPref('hiddenCounts', hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key])
}

export interface PrefsPersist {
  get(key: string): string | null
  set(key: string, v: string | null): void
}

const KEY = 'hissypad.prefs'
let persist: PrefsPersist = { get: () => null, set: () => {} }

export const usePrefs = create<Prefs>(() => ({ ...DEFAULT_PREFS }))

export function initPrefs(store: PrefsPersist) {
  persist = store
  let saved: Partial<Prefs> = {}
  try {
    saved = JSON.parse(store.get(KEY) ?? '{}') as Partial<Prefs>
  } catch { /* a bad value reads as the defaults */ }
  const hiddenCounts = Array.isArray(saved.hiddenCounts) ? saved.hiddenCounts.filter((k): k is string => typeof k === 'string') : []
  usePrefs.setState({ ...DEFAULT_PREFS, hiddenCounts }, true)
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  usePrefs.setState({ [key]: value } as Pick<Prefs, K>)
  try {
    persist.set(KEY, JSON.stringify(usePrefs.getState()))
  } catch { /* per-device */ }
}
