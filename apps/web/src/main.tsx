import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { bindAuth, configureLocalStore, initLog, setClipboard, setSyncTriggers } from '@hissypad/state'
import { createIdbStore } from './local/idb'
import { supabase } from './supabase'
import { copyText } from './clipboard'
import './styles.css'

initLog(
  {
    get: () => localStorage.getItem('hissypad.debug'),
    set: (v) => (v === null ? localStorage.removeItem('hissypad.debug') : localStorage.setItem('hissypad.debug', v)),
  },
  new URLSearchParams(location.search).get('debug'),
)
setClipboard(copyText)
setSyncTriggers((kick) => {
  window.addEventListener('online', kick)
  window.addEventListener('focus', kick)
  const onVis = () => {
    if (document.visibilityState === 'visible') kick()
  }
  document.addEventListener('visibilitychange', onVis)
  return () => {
    window.removeEventListener('online', kick)
    window.removeEventListener('focus', kick)
    document.removeEventListener('visibilitychange', onVis)
  }
})
configureLocalStore(createIdbStore())
bindAuth(supabase)
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
