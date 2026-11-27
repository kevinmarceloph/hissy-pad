// In Later, the lines that are out on a boomerang are rows of the pad, under Later's own
// lines and in groups by the day they come back (core/boomerang.ts keeps the groups). This
// is the heading drawn before the first row of each group; the first one also carries the
// section's name.
import { dueLabel, type PadId } from '@hissypad/core'
import { openPad, padName, usePad } from '@hissypad/state'
import { dayOf } from '@hissypad/core/hours'
import { hoursIfOpen } from '@hissypad/state/hours'
import { LineIcon } from '../app/icons'

// Today's second section: the lines with an hour, kept in the order of their hours
// (core/schedule.ts). Drawn before the first of them.
export function ScheduledHead() {
  return (
    <div className="due-head is-first">
      <h2><LineIcon icon="hour" /> Scheduled</h2>
    </div>
  )
}

// In a category's view: the pad a group of lines is from, before the first of them. A
// press opens that pad.
export function CategoryHead({ padId }: { padId: PadId }) {
  const name = usePad((s) => padName(s.all, padId))
  return (
    <div className="due-head cat-head">
      <h3><button type="button" title={`Open ${name}`} onClick={() => openPad(padId)}>{name}</button></h3>
    </div>
  )
}

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
