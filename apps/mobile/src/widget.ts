// The app's end of the home-screen widgets, Siri and the watch app (iOS). None of them can
// run this code: the widget is a separate process, the watch a separate device (reached
// through native/WatchBridge.swift, which reads the same storage). So the
// two trade JSON through the App Group's UserDefaults (the Swift end is in
// targets/widget/Shared.swift, the shapes in packages/state/src/widget.ts):
//   - whenever the pads change, the app writes a snapshot and asks the widget to redraw;
//   - when the app comes to the front, it applies the buttons pressed on the widget.
// Tapping the widget opens hissypad://pad?pad=… and its + opens hissypad://add?pad=…,
// where pad=inbox means the pad named Inbox. The Add control (Lock Screen, Control Center)
// opens the app and leaves the same link, without the scheme, under widget.open. A line added through
// Siri arrives in the same queue as the button presses.
// The watch syncs by itself once it is signed in, and this is also where the phone signs
// it in (signInWatch below): two more values in the same storage, both passed along by
// WatchBridge.swift.
//   watch.state    the account the watch says it is signed in to (the bridge writes it)
//   watch.handoff  a sign-in for the watch, or "signout" (written here; the bridge sends
//                  it and takes it out)
// On a build from before the widget, the storage module is missing and its JS falls back
// to no-ops, so all of this quietly does nothing.
import { useEffect } from 'react'
import { Alert, AppState, Platform } from 'react-native'
import { ExtensionStorage } from '@bacons/apple-targets'
import {
  cmdAddToPad, cmdWidgetActions, loadSortTargets, log, openPad, usePad, useSort, watchHandoffDue, watchSignedIn, widgetPadName,
  widgetSnapshot, WIDGET_MAIN,
  type WidgetAction,
} from '@hissypad/state'
import { supabase } from './supabase'

export const APP_GROUP = 'group.ph.marcelo.hissypad'
const SNAPSHOT_KEY = 'widget.snapshot'
const ACTIONS_KEY = 'widget.actions'
const OPEN_KEY = 'widget.open'
const WATCH_STATE_KEY = 'watch.state'
const WATCH_HANDOFF_KEY = 'watch.handoff'
const POLL_MS = 4000

const storage = new ExtensionStorage(APP_GROUP)
let published = ''

// Write the snapshot if it changed, and have the widget redraw.
function publish() {
  if (usePad.getState().load !== 'ready') return
  const json = JSON.stringify(widgetSnapshot())
  if (json === published) return
  published = json
  storage.set(SNAPSHOT_KEY, json)
  ExtensionStorage.reloadWidget()
}

// Apply what was pressed on the widget while the app was away, then publish the result.
function drain(force = true) {
  if (usePad.getState().load !== 'ready') return
  let actions: WidgetAction[] = []
  try {
    const raw = storage.get(ACTIONS_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) actions = parsed as WidgetAction[]
    }
  } catch {
    actions = []
  }
  if (actions.length > 0) {
    storage.remove(ACTIONS_KEY)
    const n = cmdWidgetActions(actions)
    log('widget:drain', { queued: actions.length, applied: n })
  }
  if (actions.length > 0 || force) {
    published = '' // the widget may have edited the snapshot: write ours again
    publish()
  }
}

// Follow the link the Add control left, if there is one. The control's intent runs as the
// app comes to the front, a moment before or after the app hears about it, so this is
// tried a few times.
function followOpen() {
  if (usePad.getState().load !== 'ready') return
  let link: string | null = null
  try {
    link = storage.get(OPEN_KEY)
  } catch {
    link = null
  }
  if (!link) return
  storage.remove(OPEN_KEY)
  handleWidgetUrl(`hissypad://${link}`)
}

// Sign the watch in to this phone's account when it is not: get a one-time token for a
// session of its own (the watch-token Edge Function) and leave it for the bridge to send.
// Called whenever the app comes to the front and every few seconds while it is there;
// watchHandoffDue decides whether this is one of the times to act.
let watchTries = 0
let watchLastAt = 0
let watchBusy = false
async function signInWatch() {
  const session = usePad.getState().session
  if (!supabase || !session || watchBusy) return
  let state: string | null = null
  try {
    state = storage.get(WATCH_STATE_KEY)
  } catch {
    return
  }
  if (watchSignedIn(state, session.user.id)) watchTries = 0
  if (!watchHandoffDue(state, session.user.id, watchTries, watchLastAt, Date.now())) return
  watchBusy = true
  watchTries++
  watchLastAt = Date.now()
  try {
    const { data, error } = await supabase.functions.invoke<{ token_hash?: string }>('watch-token', { method: 'POST' })
    const token = data?.token_hash
    log('watch:handoff', { try: watchTries, ok: !!token, error: error?.message })
    // Still the same account after the wait?
    if (!token || usePad.getState().session?.user.id !== session.user.id) return
    storage.set(WATCH_HANDOFF_KEY, JSON.stringify({
      url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, token, user: session.user.id,
    }))
  } catch (e) {
    log('watch:handoff', { try: watchTries, ok: false, error: (e as Error).message })
  } finally {
    watchBusy = false
  }
}

// Signing out on the phone signs the watch out too: it forgets the account and its lines.
export function signOutWatch() {
  if (Platform.OS !== 'ios') return
  try {
    if (storage.get(WATCH_STATE_KEY)) storage.set(WATCH_HANDOFF_KEY, 'signout')
  } catch {
    // no shared storage on this build
  }
  watchTries = 0
}

// hissypad://add?pad=<key> and hissypad://pad?pad=<key>. Returns true when the URL was
// one of the widget's (so the sign-in handler leaves it alone).
export function handleWidgetUrl(url: string): boolean {
  const m = /^hissypad:\/\/(add|pad)\b/.exec(url)
  if (!m) return false
  const key = /[?&]pad=([^&#]+)/.exec(url)?.[1]
  const pad = key ? decodeURIComponent(key) : WIDGET_MAIN
  const all = usePad.getState().all
  const name = widgetPadName(pad, all)
  if (m[1] === 'pad') {
    openPad(pad === WIDGET_MAIN || !all[pad] ? null : pad)
    return true
  }
  if (Platform.OS === 'ios') {
    Alert.prompt(`Add to ${name}`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add', onPress: (text?: string) => { if (text) cmdAddToPad(pad, text) } },
    ], 'plain-text')
  }
  return true
}

// Mount once, after the pad has loaded.
export function useWidgetBridge(ready: boolean) {
  useEffect(() => {
    if (!ready || Platform.OS !== 'ios') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const soon = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(publish, 400)
    }
    const waits: ReturnType<typeof setTimeout>[] = []
    const arrive = () => {
      drain()
      followOpen()
      void signInWatch()
      waits.push(setTimeout(followOpen, 300), setTimeout(followOpen, 1200))
    }
    void loadSortTargets().then(arrive)
    const unPad = usePad.subscribe((s, prev) => { if (s.all !== prev.all) soon() })
    const unSort = useSort.subscribe(soon)
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') arrive()
      else publish() // leaving: do not wait for the timer
    })
    // A line crossed out on a watch without an account, or a watch saying it needs a
    // sign-in, arrives while the app is open with nothing to announce it, so look every
    // few seconds while in front.
    const poll = setInterval(() => {
      if (AppState.currentState !== 'active') return
      drain(false)
      followOpen()
      void signInWatch()
    }, POLL_MS)
    return () => {
      clearInterval(poll)
      waits.forEach(clearTimeout)
      if (timer) clearTimeout(timer)
      unPad()
      unSort()
      app.remove()
    }
  }, [ready])
}
