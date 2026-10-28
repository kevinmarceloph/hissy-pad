import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as Linking from 'expo-linking'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { loadPad } from '@hissypad/state'
import { setupApp } from './src/setup'
import { Pad } from './src/ui/Pad'
import { completeAuthFromUrl } from './src/ui/Account'
import { useTheme } from './src/theme'

function report(msg: string | null) {
  if (msg && msg !== 'Signed in.') Alert.alert('Sign in', msg)
}

export default function App() {
  const theme = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void (async () => {
      await setupApp()
      await loadPad()
      setReady(true)
      const initial = await Linking.getInitialURL()
      if (initial) report(await completeAuthFromUrl(initial))
    })()
    const sub = Linking.addEventListener('url', (e) => void completeAuthFromUrl(e.url).then(report))
    return () => sub.remove()
  }, [])
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.paper }}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          <StatusBar style="auto" />
          {ready && <Pad />}
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
