// Keyboard height, so a toolbar can sit right above it (KeyboardAvoidingView was not
// reliable here). The pad and the new item's sheet both use it.
import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

export function useKeyboardHeight() {
  const [h, setH] = useState(0)
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow', (e) => {
      const screenH = e.endCoordinates.screenY + e.endCoordinates.height
      setH(Math.max(0, screenH - e.endCoordinates.screenY))
    })
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return h
}
