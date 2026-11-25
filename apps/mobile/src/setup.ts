// Platform wiring for the shared state package: storage, clipboard, sync wake-ups, log.
import { AppState } from 'react-native'
import { randomUUID } from 'expo-crypto'

// Hermes has no crypto.randomUUID; core's id generator reads globalThis.crypto at call time.
const g = globalThis as { crypto?: { randomUUID?: () => string } }
if (!g.crypto?.randomUUID) g.crypto = { ...(g.crypto ?? {}), randomUUID }

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import { bindAuth, configureLocalStore, initLog, initPrefs, refreshClipboard, setClipboard, setClipboardProbe, setClipboardReader, setLogEnabled, setSyncTriggers } from '@hissypad/state'
import { configureChimes, configureHoursBackend } from '@hissypad/state/hours'
import { createSqliteStore } from './local/sqlite'
import { mobileChimes } from './chimes'
import { supabase } from './supabase'

let done = false
export async function setupApp() {
  if (done) return
  done = true
  const flag = await AsyncStorage.getItem('hissypad.debug')
  let cached = flag
  initLog({
    get: () => cached,
    set: (v) => {
      cached = v
      void (v === null ? AsyncStorage.removeItem('hissypad.debug') : AsyncStorage.setItem('hissypad.debug', v))
    },
  })
  const prefs = await AsyncStorage.getItem('hissypad.prefs')
  initPrefs({
    get: (k) => (k === 'hissypad.prefs' ? prefs : null),
    set: (k, v) => void (v === null ? AsyncStorage.removeItem(k) : AsyncStorage.setItem(k, v)),
  })
  // Plain text only. expo-clipboard's HTML format replaces the plain-text half with iOS's
  // own rendering of the HTML, which drops the list markers and indents, so a plain paste
  // would lose the structure. Both halves need a native module.
  setClipboard(async (text) => {
    await Clipboard.setStringAsync(text)
    return true
  })
  setClipboardReader(async () => {
    try {
      return await Clipboard.getStringAsync()
    } catch {
      return null
    }
  })
  // Paste above / below are off while the clipboard holds no text. hasStringAsync checks
  // without reading, so iOS shows no paste banner. Asked again when the toolbar shows and
  // when the app comes back (something may have been copied in another app).
  setClipboardProbe(() => Clipboard.hasStringAsync())
  AppState.addEventListener('change', (s) => {
    if (s === 'active') void refreshClipboard()
  })
  setSyncTriggers((kick) => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') kick()
    })
    return () => sub.remove()
  })
  if (__DEV__) setLogEnabled(true) // Metro shows the op log while developing
  const store = createSqliteStore()
  configureLocalStore(store)
  configureHoursBackend(store.hours)
  configureChimes(mobileChimes())
  bindAuth(supabase)
}
