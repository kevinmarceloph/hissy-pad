import { useEffect, useState } from 'react'
import { cmdApplyBoomerang, cmdCreateBegin, dismissStorageError, loadPad, resumeEditing, setSortMode, setBoomerangPickerOpener, targetDue, usePad } from '@hissypad/state'
import { Pad } from '../pad/Pad'
import { SelectionBar } from '../pad/SelectionBar'
import { TopBar, type View } from './TopBar'
import { Account } from './Account'
import { PullToRefresh } from './PullToRefresh'
import { FreshStart } from '../pads/FreshStart'
import { Sort } from '../panels/Sort'
import { Archive } from '../panels/Archive'
import { CreateDialog } from '../panels/Create'
import { BoomerangDialog, CategoryDialog, Hours, preloadHours, SlotDialog } from '../panels/Hours'
import {
  cmdAddCategory, cmdApplyCategory, cmdApplySlot, openHours, setCategoryPickerOpener, setSlotPickerOpener, targetCategory, targetSlot, targetsHaveCategory,
} from '@hissypad/state/hours'
import { showToast } from './toast'
import { MOD } from '../platform/os'

const VIEWS: Record<string, View> = { '#hours': 'hours', '#pads': 'pad', '#sort': 'sort', '#archive': 'archive' }
const HASHES: Record<View, string> = { hours: '#hours', pad: '#pads', fresh: '#pads', sort: '#sort', archive: '#archive' }
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
  // The archived line the Archive screen opens at (one found in Search). `rev` makes a second
  // trip to the same line scroll to it again.
  const [archiveAt, setArchiveAt] = useState<{ id: string; rev: number } | null>(null)
  // The hour picker the toolbar's "Hour…" opens: the slot the lines share and how many they are.
  const [picking, setPicking] = useState<{ value: string | null; count: number } | null>(null)
  // The same for "Category…".
  const [categorizing, setCategorizing] = useState<{ value: string | null; hasAny: boolean; count: number } | null>(null)
  // And for the floating Boomerang button: the day the lines are out until, if they are.
  const [sending, setSending] = useState<{ value: string | null; count: number } | null>(null)
  // The new item's card (the + in the top bar). The pad is taken off the page under it: the
  // card draws the pad's own rows and toolbar for the sub items, and two pads would both
  // answer the keys.
  // It holds the undo depth the card opened at.
  const [creating, setCreating] = useState<number | null>(null)

  // Sort keeps a pad of its own: the store swaps to it in Sort and back out of it.
  useEffect(() => { if (load === 'ready') setSortMode(view === 'sort') }, [view, load])

  useEffect(() => {
    void loadPad()
    // Hours' rows are opened with the pad: a line's category icon comes from its list.
    void openHours()
    // And Hours' screens are fetched once the page is idle, so switching to Hours does not
    // wait for them. Not under test: nothing there waits for the fetch to finish.
    const idle = import.meta.env.MODE === 'test' ? null : setTimeout(preloadHours, 1200)
    setSlotPickerOpener((ids) => setPicking({ value: targetSlot(ids), count: ids.length }))
    setCategoryPickerOpener((ids) => setCategorizing({ value: targetCategory(ids), hasAny: targetsHaveCategory(ids), count: ids.length }))
    setBoomerangPickerOpener((ids) => setSending({ value: targetDue(ids), count: ids.length }))
    return () => {
      if (idle) clearTimeout(idle)
      setSlotPickerOpener(null)
      setCategoryPickerOpener(null)
      setBoomerangPickerOpener(null)
    }
  }, [])

  return (
    <main className={view === 'fresh' ? 'app is-wide' : view === 'hours' ? 'app is-hours' : 'app'}>
      <PullToRefresh />
      <TopBar
        view={view}
        onView={setView}
        onCreate={() => setCreating(cmdCreateBegin())}
        onArchived={(id) => {
          setArchiveAt((at) => ({ id, rev: (at?.rev ?? 0) + 1 }))
          setView('archive')
        }}
      />
      {storageError && (
        <div className="banner" role="alert">
          <span>{storageError}</span>
          <button type="button" onClick={dismissStorageError} aria-label="Dismiss">×</button>
        </div>
      )}
      {load === 'loading' ? <p className="hint" aria-busy="true">Opening your pad…</p> : view === 'fresh' ? <FreshStart onClose={() => setView('pad')} /> : view === 'sort' ? <Sort key={padId ?? 'main'} paused={creating !== null} onClose={() => setView('pad')} /> : view === 'hours' ? <Hours /> : view === 'archive' ? <Archive at={archiveAt} onClose={() => setView('pad')} /> : creating !== null ? null : <Pad />}
      {/* In Hours too: an open hour's lines are the pad's own rows (panels/Hours.tsx). */}
      {(view === 'pad' || view === 'hours') && creating === null && <SelectionBar />}
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
      {sending && (
        <BoomerangDialog
          value={sending.value}
          count={sending.count}
          onClose={() => {
            setSending(null)
            resumeEditing()
          }}
          onPick={(due, today) => {
            const said = cmdApplyBoomerang(due, today)
            if (said) showToast(`${said} ${MOD}+Z undoes it.`)
            setSending(null)
            resumeEditing()
          }}
        />
      )}
      {categorizing && (
        <CategoryDialog
          value={categorizing.value}
          hasAny={categorizing.hasAny}
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
