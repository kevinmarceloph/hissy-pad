// Per-device preferences: kept on the device (localStorage on web, AsyncStorage on the
// phone), not synced. The platform hands in its storage and the saved values at start.
import { create } from 'zustand'

export interface Prefs {
  // The number of open lines beside each pad's name in the tabs.
  padCounts: boolean
}

export const DEFAULT_PREFS: Prefs = { padCounts: true }

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
  usePrefs.setState({ ...DEFAULT_PREFS, ...saved }, true)
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  usePrefs.setState({ [key]: value } as Pick<Prefs, K>)
  try {
    persist.set(KEY, JSON.stringify(usePrefs.getState()))
  } catch { /* per-device */ }
}
