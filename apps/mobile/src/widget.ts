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
// Siri goes to the server from Siri itself (native/SiriSync.swift) and comes back with the
// next sync; one it could not send arrives in the same queue as the button presses.
// The watch syncs by itself once it is signed in, and this is also where the phone signs
// it in, and Siri (signInOthers below): four more values in the same storage.
//   watch.state    the account the watch says it is signed in to (the bridge writes it)
//   watch.handoff  a sign-in for the watch, or "signout" (written here; the bridge sends
//                  it and takes it out)
//   siri.state     the account Siri's sender is signed in to (SiriSync.swift writes it)
//   siri.handoff   a sign-in for it, or "signout" (written here; SiriSync.swift takes it)
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
const SIRI_STATE_KEY = 'siri.state'
const SIRI_HANDOFF_KEY = 'siri.handoff'
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

// Sign the watch in to this phone's account when it is not, and Siri likewise: get a
// one-time token for a session of its own (the watch-token Edge Function) and leave it for
// the Swift side to take (the bridge sends the watch's on; native/SiriSync.swift trades
// Siri's in itself). Called whenever the app comes to the front and every few seconds
// while it is there; watchHandoffDue decides whether this is one of the times to act.
interface Other { name: string; stateKey: string; handoffKey: string; tries: number; lastAt: number }
const watch: Other = { name: 'watch', stateKey: WATCH_STATE_KEY, handoffKey: WATCH_HANDOFF_KEY, tries: 0, lastAt: 0 }
const siri: Other = { name: 'siri', stateKey: SIRI_STATE_KEY, handoffKey: SIRI_HANDOFF_KEY, tries: 0, lastAt: 0 }
let handingOver = false

// One at a time, Siri first: the server keeps one such token per account, so a second
// one asked for before the first is traded in would void it. Siri trades its own in at
// once; the watch's has to travel.
async function signInOthers() {
  if (handingOver) return
  handingOver = true
  try {
    if (!(await signIn(siri))) await signIn(watch)
  } finally {
    handingOver = false
  }
}

// True when a token was handed over.
async function signIn(to: Other): Promise<boolean> {
  const session = usePad.getState().session
  if (!supabase || !session) return false
  let state: string | null = null
  try {
    state = storage.get(to.stateKey)
  } catch {
    return false
  }
  if (watchSignedIn(state, session.user.id)) to.tries = 0
  if (!watchHandoffDue(state, session.user.id, to.tries, to.lastAt, Date.now())) return false
  to.tries++
  to.lastAt = Date.now()
  try {
    const { data, error } = await supabase.functions.invoke<{ token_hash?: string }>('watch-token', { method: 'POST' })
    const token = data?.token_hash
    log(`${to.name}:handoff`, { try: to.tries, ok: !!token, error: error?.message })
    // Still the same account after the wait?
    if (!token || usePad.getState().session?.user.id !== session.user.id) return false
    storage.set(to.handoffKey, JSON.stringify({
      url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, token, user: session.user.id,
    }))
    return true
  } catch (e) {
    log(`${to.name}:handoff`, { try: to.tries, ok: false, error: (e as Error).message })
    return false
  }
}

// Signing out on the phone signs the watch and Siri out too: they forget the account.
export function signOutOthers() {
  if (Platform.OS !== 'ios') return
  for (const to of [watch, siri]) {
    try {
      if (storage.get(to.stateKey)) storage.set(to.handoffKey, 'signout')
    } catch {
      // no shared storage on this build
    }
    to.tries = 0
  }
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
      void signInOthers()
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
      void signInOthers()
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
