// Hours: Oras-oras inside HissyPad. One row per hour with a plan and what happened, plus
// the pad's lines assigned to each hour. The screens are React Native, shared with the
// phone (packages/ui) and drawn here through react-native-web; they are loaded on first
// use so the pad itself does not carry them.
import { lazy, Suspense, useEffect, useState } from 'react'
import { useCategoryChoices } from '@hissypad/state/hours'
import type { ColorKey } from '@hissypad/core/hours'

const HoursApp = lazy(() => import('@hissypad/ui').then((m) => ({ default: m.HoursApp })))
const SlotPicker = lazy(() => import('@hissypad/ui').then((m) => ({ default: m.SlotPicker })))
const CategoriesApp = lazy(() => import('@hissypad/ui').then((m) => ({ default: m.CategoriesApp })))
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

// Drawn under the app's own header: the mode switcher there is the way back to the pad.
export function Hours() {
  const scheme = useScheme()
  return (
    <section className="hours" aria-label="Hours">
      <Suspense fallback={<p className="hint" aria-busy="true">Opening your hours…</p>}>
        <HoursApp scheme={scheme} />
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
