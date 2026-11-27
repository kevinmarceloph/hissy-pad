import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { categoryCounts, NO_CATEGORY } from '@hissypad/core'
import { openCategory, subName, usePad } from '@hissypad/state'
import { cmdOpenCategories, useCategoryChoices, useLineCategory } from '@hissypad/state/hours'
import { CatMark } from '../pad/CatMark'

// The Categories mode's dropdown, centered where the Pad mode has its pads: the open
// category (its mark, its name, how many lines are in it), and a press lists them all, with
// "No category" last: the lines that have none. The open one's lines, from every pad, are
// the pad drawn under it (the store's catId, scopeCategory in core).
export function CategoryTabs() {
  const all = usePad((s) => s.all)
  const catId = usePad((s) => s.catId)
  const load = usePad((s) => s.load)
  const categories = useCategoryChoices()
  const shown = useLineCategory(catId)
  const counts = useMemo(() => categoryCounts(all), [all])
  // The list, and where the button is on screen.
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null)

  // The categories can arrive after the mode is open (they load with Hours' store).
  useEffect(() => {
    if (catId === null && load === 'ready' && categories.length > 0) cmdOpenCategories()
  }, [catId, load, categories.length])

  useEffect(() => {
    if (!menu) return
    const shut = () => setMenu(null)
    const away = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.('.cats .pick, .cats-menu')) shut()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') shut()
    }
    // Scrolling inside the open list itself keeps it open.
    const gone = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest('.cats-menu'))) shut()
    }
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', shut)
    window.addEventListener('scroll', gone, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', shut)
      window.removeEventListener('scroll', gone, true)
    }
  }, [menu])

  if (categories.length === 0 && catId === null) return null
  const none = catId === NO_CATEGORY
  const name = none ? 'No category' : shown ? subName(shown.label) : 'Category'
  const n = catId === null ? 0 : (counts.get(catId) ?? 0)

  function toggle(el: HTMLElement) {
    if (menu) return setMenu(null)
    const r = el.getBoundingClientRect()
    const half = 104
    setMenu({ left: Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8), top: r.bottom + 4 })
  }

  const item = (id: string, label: string, title: string) => {
    const count = counts.get(id) ?? 0
    return (
      <button key={id} type="button" role="menuitemradio" aria-checked={id === catId} title={title} onClick={() => { setMenu(null); openCategory(id) }}>
        {id === NO_CATEGORY ? <span className="cat-none" aria-hidden="true" /> : <CatMark id={id} />}{label}{count > 0 && <span className="n" aria-hidden="true"> {count}</span>}
      </button>
    )
  }

  return (
    <nav className="pads cats" aria-label="Category">
      <button
        type="button"
        className="pick"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={`Category: ${none ? 'No category' : (shown?.label ?? 'none open')}${n > 0 ? `, ${n} ${n === 1 ? 'line' : 'lines'}` : ''}. Pick another`}
        title="Pick a category"
        onClick={(e) => toggle(e.currentTarget)}
      >
        {none ? <span className="cat-none" aria-hidden="true" /> : <CatMark id={catId} />}
        <span className="name">{name}</span>
        {n > 0 && <span className="n" aria-hidden="true"> {n}</span>}
      </button>
      {menu && createPortal(
        <div className="bar moveto-menu sub-menu cats-menu" role="menu" aria-label="Categories" style={{ left: menu.left, top: menu.top }}>
          {categories.map((c) => item(c.id, subName(c.label), c.label))}
          {item(NO_CATEGORY, 'No category', 'The lines with no category')}
        </div>,
        document.body,
      )}
    </nav>
  )
}
