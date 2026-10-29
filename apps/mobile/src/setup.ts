// Platform wiring for the shared state package: storage, clipboard, sync wake-ups, log.
import { AppState } from 'react-native'
import { randomUUID } from 'expo-crypto'

// Hermes has no crypto.randomUUID; core's id generator reads globalThis.crypto at call time.
const g = globalThis as { crypto?: { randomUUID?: () => string } }
if (!g.crypto?.randomUUID) g.crypto = { ...(g.crypto ?? {}), randomUUID }

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import { bindAuth, configureLocalStore, initLog, setClipboard, setLogEnabled, setSyncTriggers } from '@hissypad/state'
import { createSqliteStore } from './local/sqlite'
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
  // Plain text only. expo-clipboard's HTML format replaces the plain-text half with iOS's
  // own rendering of the HTML, which drops the list markers and indents, so a plain paste
  // (and Paste in here) would lose the structure. Both halves need a native module.
  setClipboard(async (text) => {
    await Clipboard.setStringAsync(text)
    return true
  })
  setSyncTriggers((kick) => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') kick()
    })
    return () => sub.remove()
  })
  if (__DEV__) setLogEnabled(true) // Metro shows the op log while developing
  configureLocalStore(createSqliteStore())
  bindAuth(supabase)
}
