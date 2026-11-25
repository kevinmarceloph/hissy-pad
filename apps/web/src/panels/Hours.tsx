// Hours: Oras-oras inside HissyPad. One row per hour with a plan and what happened, plus
// the pad's lines assigned to each hour. The screens are React Native, shared with the
// phone (packages/ui) and drawn here through react-native-web; they are loaded on first
// use so the pad itself does not carry them.
import { lazy, Suspense, useEffect, useState } from 'react'
import { useCategoryChoices } from '@hissypad/state/hours'
import type { ColorKey } from '@hissypad/core/hours'
import { Pad } from '../pad/Pad'

// The screens' code is a chunk of its own (react-native-web and packages/ui, about 180 KB).
// It used to be fetched on the first switch to Hours, which is what "Opening your hours…"
// waited on: the hours' rows are already open by then (App opens them with the pad). The
// app now asks for it once the pad is up, so the switch finds it loaded.
export function preloadHours() {
  void import('@hissypad/ui').catch(() => {})
}

const HoursApp = lazy(() => import('@hissypad/ui').then((m) => ({ default: m.HoursApp })))
const SlotPicker = lazy(() => import('@hissypad/ui').then((m) => ({ default: m.SlotPicker })))
const CategoriesApp = lazy(() => import('@hissypad/ui').then((m) => ({ default: m.CategoriesApp })))
const BoomerangPicker = lazy(() => import('@hissypad/ui').then((m) => ({ default: m.BoomerangPicker })))
const CategoryPicker = lazy(() => import('@hissypad/ui').then((m) => ({ default: m.CategoryPicker })))

// The scheme the page is drawn in: the top bar's Light / Dark choice, else the device's.
export function useScheme(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' => {
    const forced = document.documentElement.dataset.theme
    if (forced === 'light' || forced === 'dark') return forced
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  const [scheme, setScheme] = useState(read)
  useEffect(() => {
    const update = () => setScheme(read())
    const seen = new MutationObserver(update)
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener('change', update)
    return () => {
      seen.disconnect()
      media?.removeEventListener('change', update)
    }
  }, [])
  return scheme
}

// An open hour's lines are the pad itself: the store shows that hour (openSlot, asked for
// by the shared screen), so these are the pad's own rows, keys, drag and undo, and the
// app's SelectionBar is the toolbar. `embedded`: no hint, tail or floating +.
// A line's chip for the hour it is in says nothing inside that hour, so it is left out
// there; a run of hours, or another hour on a line further in, still shows.
const hourLines = ({ slot }: { slot: string }) => (
  <div className="hour-lines">
    <style>{`.hour-lines .slot[data-slot="${slot}"] { display: none; }`}</style>
    <Pad embedded />
  </div>
)

// Drawn under the app's own header: the mode switcher there is the way back to the pad.
export function Hours() {
  const scheme = useScheme()
  return (
    <section className="hours" aria-label="Hours">
      <Suspense fallback={<p className="hint" aria-busy="true">Opening your hours…</p>}>
        <HoursApp scheme={scheme} renderLines={hourLines} />
      </Suspense>
    </section>
  )
}

// The hour picker the pad's toolbar opens ("Hour…"), in a dialog.
export function SlotDialog({ value, count, onPick, onClose }: { value: string | null; count: number; onPick: (slot: string | null) => void; onClose: () => void }) {
  const scheme = useScheme()
  return (
    <dialog
      className="import slot-dialog"
      aria-label="Pick an hour"
      ref={(d) => {
        if (d && !d.open) d.showModal()
      }}
      onClose={onClose}
    >
      <Suspense fallback={<p className="hint" aria-busy="true">Opening…</p>}>
        <SlotPicker value={value} count={count} scheme={scheme} onPick={onPick} onCancel={onClose} />
      </Suspense>
    </dialog>
  )
}

// The day picker the pad's floating Boomerang button opens, in a dialog.
export function BoomerangDialog({ value, count, onPick, onClose }: { value: string | null; count: number; onPick: (due: string | null, today: string) => void; onClose: () => void }) {
  const scheme = useScheme()
  return (
    <dialog
      className="import slot-dialog boomerang-dialog"
      aria-label="Pick a day"
      ref={(d) => {
        if (d && !d.open) d.showModal()
      }}
      onClose={onClose}
    >
      <Suspense fallback={<p className="hint" aria-busy="true">Opening…</p>}>
        <BoomerangPicker value={value} count={count} scheme={scheme} onPick={onPick} onCancel={onClose} />
      </Suspense>
    </dialog>
  )
}

// The category picker the pad's toolbar opens ("Category…"), in a dialog.
type CategoryDialogProps = {
  value: string | null
  count: number
  onPick: (category: string | null) => void
  onCreate: (label: string, icon: string, color: ColorKey) => void
  onClose: () => void
}
export function CategoryDialog({ value, count, onPick, onCreate, onClose }: CategoryDialogProps) {
  const scheme = useScheme()
  const categories = useCategoryChoices()
  return (
    <dialog
      className="import slot-dialog"
      aria-label="Pick a category"
      ref={(d) => {
        if (d && !d.open) d.showModal()
      }}
      onClose={onClose}
    >
      <Suspense fallback={<p className="hint" aria-busy="true">Opening…</p>}>
        <CategoryPicker categories={categories} value={value} count={count} scheme={scheme} onPick={onPick} onCreate={onCreate} onCancel={onClose} />
      </Suspense>
    </dialog>
  )
}

// The category list, from the top menu: categories are for hours and lines alike.
export function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const scheme = useScheme()
  return (
    <dialog
      className="import slot-dialog categories-dialog"
      aria-label="Categories"
      ref={(d) => {
        if (d && !d.open) d.showModal()
      }}
      onClose={onClose}
    >
      <Suspense fallback={<p className="hint" aria-busy="true">Opening…</p>}>
        <CategoriesApp scheme={scheme} onClose={onClose} />
      </Suspense>
    </dialog>
  )
}
