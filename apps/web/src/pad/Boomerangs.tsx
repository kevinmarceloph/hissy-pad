// In Later, the lines that are out on a boomerang are rows of the pad, under Later's own
// lines and in groups by the day they come back (core/boomerang.ts keeps the groups). This
// is the heading drawn before the first row of each group; the first one also carries the
// section's name.
import { dueLabel } from '@hissypad/core'
import { dayOf } from '@hissypad/core/hours'
import { hoursIfOpen } from '@hissypad/state/hours'
import { LineIcon } from '../app/icons'

export function DueHead({ due, first }: { due: string; first: boolean }) {
  // The day this moment belongs to, by the hour a day starts at in Hours.
  const today = dayOf(new Date(), hoursIfOpen()?.day.getState().start ?? 0)
  return (
    <div className={first ? 'due-head is-first' : 'due-head'}>
      {first && <h2><LineIcon icon="boomerang" /> Boomerang</h2>}
      <h3>{due <= today ? 'Due back' : dueLabel(due, today)}</h3>
    </div>
  )
}
