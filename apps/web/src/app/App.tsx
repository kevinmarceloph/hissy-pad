import { useEffect, useState } from 'react'
import { cmdCreateBegin, dismissStorageError, loadPad, resumeEditing, usePad } from '@hissypad/state'
import { Pad } from '../pad/Pad'
import { SelectionBar } from '../pad/SelectionBar'
import { TopBar, type View } from './TopBar'
import { Account } from './Account'
import { PullToRefresh } from './PullToRefresh'
import { FreshStart } from '../pads/FreshStart'
import { Sort } from '../panels/Sort'
import { CreateDialog } from '../panels/Create'
import { CategoryDialog, Hours, SlotDialog } from '../panels/Hours'
import {
  cmdAddCategory, cmdApplyCategory, cmdApplySlot, openHours, setCategoryPickerOpener, setSlotPickerOpener, targetCategory, targetSlot,
} from '@hissypad/state/hours'
import { showToast } from './toast'

const VIEWS: Record<string, View> = { '#hours': 'hours', '#pads': 'pad', '#sort': 'sort' }
const HASHES: Record<View, string> = { hours: '#hours', pad: '#pads', fresh: '#pads', sort: '#sort' }
const viewFromHash = (): View => VIEWS[location.hash] ?? 'hours'

export function App() {
  const load = usePad((s) => s.load)
  const storageError = usePad((s) => s.storageError)
  const padId = usePad((s) => s.padId)
  const [view, setViewState] = useState<View>(viewFromHash)
  // The address carries the mode (#hours, #pads, #sort), so a link or a bookmark opens it
  // straight away. Written only when the mode changes, so a sign-in's #access_token is left
  // for Supabase to read on load.
  const setView = (next: View) => {
    setViewState(next)
    const hash = HASHES[next]
    if (location.hash !== hash) history.replaceState(null, '', hash)
  }
  useEffect(() => {
    const onHash = () => {
      const next = VIEWS[location.hash]
      if (next) setViewState(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // The hour picker the toolbar's "Hour…" opens: the slot the lines share and how many they are.
  const [picking, setPicking] = useState<{ value: string | null; count: number } | null>(null)
  // The same for "Category…".
  const [categorizing, setCategorizing] = useState<{ value: string | null; count: number } | null>(null)
  // The new item's card (the + in the top bar). The pad is taken off the page under it: the
  // card draws the pad's own rows and toolbar for the sub items, and two pads would both
  // answer the keys.
  // It holds the undo depth the card opened at.
  const [creating, setCreating] = useState<number | null>(null)

  useEffect(() => {
    void loadPad()
    // Hours' rows are opened with the pad: a line's category icon comes from its list.
    void openHours()
    setSlotPickerOpener((ids) => setPicking({ value: targetSlot(ids), count: ids.length }))
    setCategoryPickerOpener((ids) => setCategorizing({ value: targetCategory(ids), count: ids.length }))
    return () => {
      setSlotPickerOpener(null)
      setCategoryPickerOpener(null)
    }
  }, [])

  return (
    <main className={view === 'fresh' ? 'app is-wide' : view === 'hours' ? 'app is-hours' : 'app'}>
      <PullToRefresh />
      <TopBar view={view} onView={setView} onCreate={() => setCreating(cmdCreateBegin())} />
      {storageError && (
        <div className="banner" role="alert">
          <span>{storageError}</span>
          <button type="button" onClick={dismissStorageError} aria-label="Dismiss">×</button>
        </div>
      )}
      {load === 'loading' ? <p className="hint" aria-busy="true">Opening your pad…</p> : view === 'fresh' ? <FreshStart onClose={() => setView('pad')} /> : view === 'sort' ? <Sort key={padId ?? 'main'} onClose={() => setView('pad')} /> : view === 'hours' ? <Hours /> : creating !== null ? null : <Pad />}
      {view === 'pad' && creating === null && <SelectionBar />}
      {creating !== null && <CreateDialog depth={creating} onClose={() => setCreating(null)} onOpen={() => { setCreating(null); setView('pad') }} />}
      {picking && (
        <SlotDialog
          value={picking.value}
          count={picking.count}
          onClose={() => {
            setPicking(null)
            resumeEditing()
          }}
          onPick={(slot) => {
            showToast(cmdApplySlot(slot))
            setPicking(null)
            resumeEditing()
          }}
        />
      )}
      {categorizing && (
        <CategoryDialog
          value={categorizing.value}
          count={categorizing.count}
          onClose={() => {
            setCategorizing(null)
            resumeEditing()
          }}
          onPick={(category) => {
            showToast(cmdApplyCategory(category))
            setCategorizing(null)
            resumeEditing()
          }}
          onCreate={(label, icon, color) => {
            setCategorizing(null)
            void cmdAddCategory(label, icon, color).then((made) => {
              showToast(made ? cmdApplyCategory(made.id) : 'That category was not saved.')
              resumeEditing()
            })
          }}
        />
      )}
      {view !== 'hours' && <footer className="foot"><Account /></footer>}
    </main>
  )
}
