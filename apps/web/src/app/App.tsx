import { useEffect, useState } from 'react'
import { dismissStorageError, loadPad, usePad } from '@hissypad/state'
import { Pad } from '../pad/Pad'
import { SelectionBar } from '../pad/SelectionBar'
import { TopBar, type View } from './TopBar'
import { Account } from './Account'
import { PullToRefresh } from './PullToRefresh'
import { FreshStart } from '../pads/FreshStart'
import { Sort } from '../panels/Sort'
import { Hours, SlotDialog } from '../panels/Hours'
import { cmdApplySlot, setSlotPickerOpener, targetSlot } from '@hissypad/state/hours'
import { targets } from '@hissypad/state'
import { showToast } from './toast'

export function App() {
  const load = usePad((s) => s.load)
  const storageError = usePad((s) => s.storageError)
  const padId = usePad((s) => s.padId)
  const [view, setView] = useState<View>('pad')
  // The hour picker the toolbar's "Hour…" opens: the slot the lines share and how many they are.
  const [picking, setPicking] = useState<{ value: string | null; count: number } | null>(null)

  useEffect(() => {
    void loadPad()
    setSlotPickerOpener(() => setPicking({ value: targetSlot(), count: targets().length }))
    return () => setSlotPickerOpener(null)
  }, [])

  return (
    <main className={view === 'fresh' ? 'app is-wide' : view === 'hours' ? 'app is-hours' : 'app'}>
      <PullToRefresh />
      <TopBar view={view} onView={setView} />
      {storageError && (
        <div className="banner" role="alert">
          <span>{storageError}</span>
          <button type="button" onClick={dismissStorageError} aria-label="Dismiss">×</button>
        </div>
      )}
      {load === 'loading' ? <p className="hint" aria-busy="true">Opening your pad…</p> : view === 'fresh' ? <FreshStart onClose={() => setView('pad')} /> : view === 'sort' ? <Sort key={padId ?? 'main'} onClose={() => setView('pad')} /> : view === 'hours' ? <Hours /> : <Pad />}
      {view === 'pad' && <SelectionBar />}
      {picking && (
        <SlotDialog
          value={picking.value}
          count={picking.count}
          onClose={() => setPicking(null)}
          onPick={(slot) => {
            showToast(cmdApplySlot(slot))
            setPicking(null)
          }}
        />
      )}
      {view !== 'hours' && <footer className="foot"><Account /></footer>}
    </main>
  )
}
