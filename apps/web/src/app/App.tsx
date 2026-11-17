import { useEffect, useState } from 'react'
import { dismissStorageError, loadPad, usePad } from '@hissypad/state'
import { Pad } from '../pad/Pad'
import { SelectionBar } from '../pad/SelectionBar'
import { TopBar } from './TopBar'
import { Account } from './Account'
import { PullToRefresh } from './PullToRefresh'
import { FreshStart } from '../pads/FreshStart'
import { Sort } from '../panels/Sort'

export function App() {
  const load = usePad((s) => s.load)
  const storageError = usePad((s) => s.storageError)
  const padId = usePad((s) => s.padId)
  const [view, setView] = useState<'pad' | 'fresh' | 'sort'>('pad')

  useEffect(() => {
    void loadPad()
  }, [])

  return (
    <main className={view === 'fresh' ? 'app is-wide' : 'app'}>
      <PullToRefresh />
      <TopBar view={view} onFreshStart={() => setView('fresh')} onSort={() => setView('sort')} />
      {storageError && (
        <div className="banner" role="alert">
          <span>{storageError}</span>
          <button type="button" onClick={dismissStorageError} aria-label="Dismiss">×</button>
        </div>
      )}
      {load === 'loading' ? <p className="hint" aria-busy="true">Opening your pad…</p> : view === 'fresh' ? <FreshStart onClose={() => setView('pad')} /> : view === 'sort' ? <Sort key={padId ?? 'main'} onClose={() => setView('pad')} /> : <Pad />}
      {view === 'pad' && <SelectionBar />}
      <footer className="foot"><Account /></footer>
    </main>
  )
}
