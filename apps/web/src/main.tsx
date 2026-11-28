import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app/App'
import { bindAuth, configureLocalStore, initLog, initPrefs, setClipboard, setClipboardReader, setSyncTriggers } from '@hissypad/state'
import { configureChimes, configureHoursBackend } from '@hissypad/state/hours'
import { createIdbStore } from './platform/idb'
import { webChimes } from './platform/chimes'
import { supabase } from './platform/supabase'
import { copyText, readClipboard } from './platform/clipboard'
import { isMacApp } from './platform/os'
import { bindMacLinks } from './platform/mac'
import { showToast } from './app/toast'
import './styles.css'

initLog(
  {
    get: () => localStorage.getItem('hissypad.debug'),
    set: (v) => (v === null ? localStorage.removeItem('hissypad.debug') : localStorage.setItem('hissypad.debug', v)),
  },
  new URLSearchParams(location.search).get('debug'),
)
initPrefs({
  get: (k) => localStorage.getItem(k),
  set: (k, v) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)),
})
setClipboard(copyText)
setClipboardReader(readClipboard)
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
const idb = createIdbStore()
configureLocalStore(idb)
configureHoursBackend(idb.hours)
configureChimes(webChimes)
bindAuth(supabase)
// The Mac app serves the page from its own folder and keeps it current itself.
if (isMacApp()) bindMacLinks(supabase, showToast)
else registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
