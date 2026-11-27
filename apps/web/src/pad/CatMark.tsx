import { iconIsCode, type Category } from '@hissypad/core/hours'
import { useLineCategory } from '@hissypad/state/hours'
import { addCategoryCss } from './categoryColors'

// The classes a category's mark takes: its color, and how its icon is drawn. A code ("HP")
// is bold text in the ink that reads on the color; no icon at all draws the name (is-word).
export function markClass(c: Pick<Category, 'color' | 'icon'>): string {
  return `cat-${c.color}${iconIsCode(c.icon) ? ' is-code' : c.icon ? '' : ' is-word'}`
}

// A pad's or a sub-pad's category in a menu (Move to…, the sub-pad list of a tab): its icon
// in a small square of its color, or the bare square where it has no icon. Nothing for none.
// The name beside it says the rest, so the mark is hidden from screen readers.
export function CatMark({ id }: { id: string | null | undefined }) {
  addCategoryCss()
  const c = useLineCategory(id)
  if (!c) return null
  return <span className={`cat-mark cat-${c.color}${iconIsCode(c.icon) ? ' is-code' : ''}`} aria-hidden="true">{c.icon}</span>
}
