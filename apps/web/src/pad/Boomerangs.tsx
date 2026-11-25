// Under Later's own lines: what is out on a boomerang, grouped by the day it comes back.
// The lines are not the pad's (no pad's view holds them), so they are drawn plainly here:
// the first line of the text, how many lines ride under it, and two things to do with it:
// another day, or back to the Inbox now.
import { useMemo } from 'react'
import { buildIndex, countLines, descendantIds, dueLabel, fixedPadOf } from '@hissypad/core'
import { dayOf } from '@hissypad/core/hours'
import { boomerangList, cmdComeBack, cmdPickBoomerang, usePad } from '@hissypad/state'
import { hoursIfOpen } from '@hissypad/state/hours'
import { LineIcon } from '../app/icons'
import { showToast } from '../app/toast'
import { MOD } from '../platform/os'

export function Boomerangs() {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const scoped = usePad((s) => s.zoomId !== null || s.slotId !== null)
  const here = !scoped && fixedPadOf(all, padId) === 'Later'
  const groups = useMemo(() => (here ? boomerangList(all) : []), [here, all])
  const index = useMemo(() => (groups.length ? buildIndex(all) : null), [groups, all])
  if (!index) return null
  // The day this moment belongs to, by the hour a day starts at in Hours.
  const today = dayOf(new Date(), hoursIfOpen()?.day.getState().start ?? 0)
  return (
    <section className="boomerangs" aria-label="Out on a boomerang">
      <h2><LineIcon icon="boomerang" /> Boomerang</h2>
      {groups.map((g) => (
        <div key={g.due} className="bgroup">
          <h3>{g.due <= today ? 'Due back' : dueLabel(g.due, today)}</h3>
          <ul>
            {g.lines.map((r) => {
              const under = countLines(descendantIds(index, r.id).map((id) => all[id]))
              const text = r.text.split('\n')[0] || 'Blank line'
              return (
                <li key={r.id} className={r.done ? 'is-done' : undefined}>
                  <span className="btext">{text}{under > 0 && <span className="chip" title={`${under} ${under === 1 ? 'line' : 'lines'} under it`}>+{under}</span>}</span>
                  <button type="button" onClick={() => cmdPickBoomerang([r.id])} aria-label={`Another day for ${text}`} title="Pick another day">Day…</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (cmdComeBack([r.id])) showToast(`Back in the Inbox. ${MOD}+Z undoes it.`)
                    }}
                    aria-label={`Bring ${text} back to the Inbox now`}
                    title="Back to the top of the Inbox now"
                  >
                    Back now
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
