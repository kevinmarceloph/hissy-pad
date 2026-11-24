// Per-device preferences: kept on the device (localStorage on web, AsyncStorage on the
// phone), not synced. The platform hands in its storage and the saved values at start.
// Nothing lives here at the moment. Which pads hide their count used to (`hiddenCounts`,
// 2026-11-24); it is a column on the pad row now (`countHidden`, synced), and the store
// moves what a device had saved into the rows once, after its first load (`adoptLegacyCounts`).
import { create } from 'zustand'

export type Prefs = Record<string, never>

export const DEFAULT_PREFS: Prefs = {}

export interface PrefsPersist {
  get(key: string): string | null
  set(key: string, v: string | null): void
}

const KEY = 'hissypad.prefs'
let persist: PrefsPersist = { get: () => null, set: () => {} }
let legacyHidden: string[] = []

export const usePrefs = create<Prefs>(() => ({ ...DEFAULT_PREFS }))

export function initPrefs(store: PrefsPersist) {
  persist = store
  let saved: { hiddenCounts?: unknown } = {}
  try {
    saved = JSON.parse(store.get(KEY) ?? '{}') as { hiddenCounts?: unknown }
  } catch { /* a bad value reads as the defaults */ }
  legacyHidden = Array.isArray(saved.hiddenCounts) ? saved.hiddenCounts.filter((k): k is string => typeof k === 'string') : []
  usePrefs.setState({ ...DEFAULT_PREFS }, true)
}

// The pad ids this device had hidden the count of, before it synced; handed over once,
// then cleared from the device.
export function takeLegacyHiddenCounts(): string[] {
  const out = legacyHidden
  if (!out.length) return out
  legacyHidden = []
  try {
    persist.set(KEY, JSON.stringify(usePrefs.getState()))
  } catch { /* per-device */ }
  return out
}
