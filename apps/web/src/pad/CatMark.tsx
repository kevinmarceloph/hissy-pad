import { useLineCategory } from '@hissypad/state/hours'
import { addCategoryCss } from './categoryColors'

// A pad's or a sub-pad's category in a menu (Move to…, the sub-pad list of a tab): its icon
// in a small square of its color, or the bare square where it has no icon. Nothing for none.
// The name beside it says the rest, so the mark is hidden from screen readers.
export function CatMark({ id }: { id: string | null | undefined }) {
  addCategoryCss()
  const c = useLineCategory(id)
  if (!c) return null
  return <span className={`cat-mark cat-${c.color}`} aria-hidden="true">{c.icon}</span>
}
