// The Recently done panel: a <dialog> (the window key handler ignores keys inside one),
// entries grouped by day, an Undone button per line. The Archive is a screen: Archive.tsx.
import type { RefObject } from 'react'
import { cmdUndone, doneEntries, firstLine, groupByDay, usePad, underLabel } from '@hissypad/state'

function Children({ n }: { n: number }) {
  const label = underLabel(n)
  return label ? <span className="sub">{label}</span> : null
}

export function DonePanel({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  const rows = usePad((s) => s.all)
  const entries = doneEntries(rows)
  const groups = groupByDay(entries, (e) => e.doneAt)

  return (
    <dialog ref={dialog} className="import list" aria-labelledby="done-title">
      <form method="dialog">
        <div className="head">
          <h2 id="done-title">Recently done</h2>
          <button type="submit">Close</button>
        </div>
        {entries.length === 0 ? (
          <p className="empty">Nothing is crossed out.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="day">
              <h3>{g.label}</h3>
              <ul>
                {g.items.map((e) => (
                  <li key={e.id}>
                    <span className="line">
                      <span className="txt is-done">{firstLine(e.text)}</span>
                      <Children n={e.childCount} />
                    </span>
                    <button type="button" onClick={() => cmdUndone(e.id)}>Undone</button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <div className="actions">
          <p className="note">Crossed-out lines stay in the pad until you archive them.</p>
        </div>
      </form>
    </dialog>
  )
}
