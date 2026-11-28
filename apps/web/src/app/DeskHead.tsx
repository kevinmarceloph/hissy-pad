import { useMemo } from 'react'
import { NO_CATEGORY } from '@hissypad/core'
import { padList, subName, usePad } from '@hissypad/state'
import { useLineCategory } from '@hissypad/state/hours'
import { CatMark } from '../pad/CatMark'

// The Mac app's column has no tabs over it (they are the sidebar), so it says what it is
// showing: the open pad's name, or the open category's.
export function DeskHead({ view }: { view: 'pad' | 'category' }) {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const catId = usePad((s) => s.catId)
  const category = useLineCategory(catId)
  const pad = useMemo(() => padList(all).find((p) => p.id === padId), [all, padId])
  if (view === 'category') {
    if (catId === null) return null
    return (
      <div className="desk-head">
        <h2>{catId === NO_CATEGORY ? <span className="cat-none" aria-hidden="true" /> : <CatMark id={catId} />}{catId === NO_CATEGORY ? 'No category' : category ? subName(category.label) : 'Category'}</h2>
      </div>
    )
  }
  return (
    <div className="desk-head">
      <h2><CatMark id={pad?.category ?? null} />{pad?.name ?? 'Pad'}</h2>
    </div>
  )
}
