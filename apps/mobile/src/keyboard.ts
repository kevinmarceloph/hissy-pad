// Keyboard height, so a toolbar can sit right above it (KeyboardAvoidingView was not
// reliable here). The pad and the new item's sheet both use it.
import { useEffect, useState } from 'react'
import { Dimensions, Keyboard, Platform } from 'react-native'

export function useKeyboardHeight() {
  const [h, setH] = useState(0)
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow', (e) => {
      // Android draws edge to edge, and the height it reports can leave out the strip under
      // the keyboard (the navigation bar), so there it is measured from the keyboard's top
      // to the bottom of the screen.
      const c = e.endCoordinates
      setH(Math.max(0, Platform.OS === 'android' ? Dimensions.get('screen').height - c.screenY : c.height))
    })
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return h
}
