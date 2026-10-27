import { useEffect } from 'react'
import { dismissStorageError, loadPad, usePad } from './store'
import { Pad } from './Pad'
import { SelectionBar } from './SelectionBar'
import { TopBar } from './TopBar'

export function App() {
  const load = usePad((s) => s.load)
  const storageError = usePad((s) => s.storageError)

  useEffect(() => {
    void loadPad()
  }, [])

  return (
    <main className="app">
      <TopBar />
      {storageError && (
        <div className="banner" role="alert">
          <span>{storageError}</span>
          <button type="button" onClick={dismissStorageError} aria-label="Dismiss">×</button>
        </div>
      )}
      {load === 'loading' ? <p className="hint" aria-busy="true">Opening your pad…</p> : <Pad />}
      <SelectionBar />
      <footer className="foot">Saved in this browser only. Sync between devices comes in phase 3.</footer>
    </main>
  )
}
