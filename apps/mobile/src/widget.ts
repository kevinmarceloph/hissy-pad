// The app's end of the home-screen widget (iOS). The widget is a separate process, so the
// two trade JSON through the App Group's UserDefaults (the Swift end is in
// targets/widget/Shared.swift, the shapes in packages/state/src/widget.ts):
//   - whenever the pads change, the app writes a snapshot and asks the widget to redraw;
//   - when the app comes to the front, it applies the buttons pressed on the widget.
// Tapping the widget opens hissypad://pad?pad=… and its + opens hissypad://add?pad=….
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
function drain() {
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
  published = '' // the widget may have edited the snapshot: write ours again
  publish()
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
    void loadSortTargets().then(drain)
    const unPad = usePad.subscribe((s, prev) => { if (s.all !== prev.all) soon() })
    const unSort = useSort.subscribe(soon)
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') drain()
      else publish() // leaving: do not wait for the timer
    })
    return () => {
      if (timer) clearTimeout(timer)
      unPad()
      unSort()
      app.remove()
    }
  }, [ready])
}
