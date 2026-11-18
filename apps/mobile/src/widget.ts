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
// On a build from before the widget, the storage module is missing and its JS falls back
// to no-ops, so all of this quietly does nothing.
import { useEffect } from 'react'
import { Alert, AppState, Platform } from 'react-native'
import { ExtensionStorage } from '@bacons/apple-targets'
import {
  cmdAddToPad, cmdWidgetActions, loadSortTargets, log, openPad, usePad, useSort, widgetPadName, widgetSnapshot, WIDGET_MAIN,
  type WidgetAction,
} from '@hissypad/state'

export const APP_GROUP = 'group.ph.marcelo.hissypad'
const SNAPSHOT_KEY = 'widget.snapshot'
const ACTIONS_KEY = 'widget.actions'
const OPEN_KEY = 'widget.open'
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
      waits.push(setTimeout(followOpen, 300), setTimeout(followOpen, 1200))
    }
    void loadSortTargets().then(arrive)
    const unPad = usePad.subscribe((s, prev) => { if (s.all !== prev.all) soon() })
    const unSort = useSort.subscribe(soon)
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') arrive()
      else publish() // leaving: do not wait for the timer
    })
    // A line crossed out on the watch while the app is open arrives in the queue with
    // nothing to announce it, so look every few seconds while in front.
    const poll = setInterval(() => {
      if (AppState.currentState !== 'active') return
      drain(false)
      followOpen()
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
