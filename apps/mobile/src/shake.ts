// Shake to undo. The accelerometer feeds the detector in state/shake.ts; a shake asks
// before it undoes, like the system's own "Undo Typing" (which the withNoShakeToEdit
// plugin turns off, so a shake while typing gets this prompt and not both). A build from
// before expo-sensors was added has no accelerometer module: the require fails and
// shaking simply does nothing there.
import { useEffect } from 'react'
import { Alert, AppState } from 'react-native'
import * as Haptics from 'expo-haptics'
import { createShakeDetector, log, redo, undo, usePad } from '@hissypad/state'

type Sub = { remove: () => void }
interface AccelerometerModule {
  setUpdateInterval: (ms: number) => void
  addListener: (fn: (e: { x: number; y: number; z: number }) => void) => Sub
}

function accelerometer(): AccelerometerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-sensors') as { Accelerometer: AccelerometerModule }).Accelerometer
  } catch {
    return null
  }
}

let asking = false

function ask() {
  const { past, future } = usePad.getState()
  if (asking || (past.length === 0 && future.length === 0)) return
  asking = true
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
  const done = () => { asking = false }
  Alert.alert(past.length ? 'Undo the last change?' : 'Redo the last change?', undefined, [
    ...(past.length ? [{ text: 'Undo', onPress: () => { done(); undo() } }] : []),
    ...(future.length ? [{ text: 'Redo', onPress: () => { done(); redo() } }] : []),
    { text: 'Cancel', style: 'cancel' as const, onPress: done },
  ], { cancelable: true, onDismiss: done })
}

export function useShakeToUndo() {
  useEffect(() => {
    const acc = accelerometer()
    if (!acc) {
      log('shake', { available: false })
      return
    }
    let sub: Sub | null = null
    const start = () => {
      if (sub) return
      const detect = createShakeDetector()
      try {
        acc.setUpdateInterval(60)
        sub = acc.addListener(({ x, y, z }) => {
          if (detect(x, y, z, Date.now())) {
            log('shake')
            ask()
          }
        })
      } catch {
        sub = null
      }
    }
    const stop = () => {
      sub?.remove()
      sub = null
    }
    // The sensor only runs while the app is in front.
    if (AppState.currentState === 'active') start()
    const app = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()))
    return () => {
      app.remove()
      stop()
    }
  }, [])
}
