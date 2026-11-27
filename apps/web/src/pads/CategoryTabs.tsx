import { useEffect, useMemo, useRef } from 'react'
import { categoryCounts } from '@hissypad/core'
import { openCategory, subName, usePad } from '@hissypad/state'
import { cmdOpenCategories, useCategoryChoices } from '@hissypad/state/hours'
import { CatMark } from '../pad/CatMark'

// The Categories mode's row of tabs, where the Pad mode has its pads: one per category, with
// its mark and how many lines are in it. The open one's lines, from every pad, are the pad
// drawn under it (the store's catId, scopeCategory in core).
export function CategoryTabs() {
  const all = usePad((s) => s.all)
  const catId = usePad((s) => s.catId)
  const load = usePad((s) => s.load)
  const categories = useCategoryChoices()
  const counts = useMemo(() => categoryCounts(all), [all])
  const tablist = useRef<HTMLDivElement>(null)

  // The categories can arrive after the mode is open (they load with Hours' store).
  useEffect(() => {
    if (catId === null && load === 'ready' && categories.length > 0) cmdOpenCategories()
  }, [catId, load, categories.length])

  // The open tab stays in view when the row is wider than the page.
  useEffect(() => {
    const list = tablist.current
    const tab = list?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")
    if (!list || !tab) return
    const l = tab.offsetLeft - list.offsetLeft
    if (l < list.scrollLeft) list.scrollLeft = l - 8
    else if (l + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = l + tab.offsetWidth - list.clientWidth + 8
  }, [catId, categories.length])

  if (categories.length === 0) return null
  return (
    <nav className="pads cats" aria-label="Categories">
      <div role="tablist" aria-label="Categories" ref={tablist}>
        {categories.map((c) => {
          const n = counts.get(c.id) ?? 0
          return (
            <span key={c.id} className="pad-tab">
              <button type="button" role="tab" aria-selected={c.id === catId} title={`${c.label}${n > 0 ? `: ${n} ${n === 1 ? 'line' : 'lines'}` : ''}`} onClick={() => openCategory(c.id)}>
                <CatMark id={c.id} /><span className="name">{subName(c.label)}</span>
                {n > 0 && <span className="n" aria-hidden="true"> {n}</span>}
              </button>
            </span>
          )
        })}
      </div>
    </nav>
  )
}
