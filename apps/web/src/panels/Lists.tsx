// The Archive and Recently done panels: a <dialog> each (the window key handler ignores keys
// inside one), entries grouped by day, a Restore or Undone button per line.
import type { RefObject } from 'react'
import {
  cmdRestore, cmdUndone, doneEntries, firstLine, groupByDay, timeLabel, trashEntries, usePad, TRASH_DAYS, underLabel,
} from '@hissypad/state'

function Children({ n }: { n: number }) {
  const label = underLabel(n)
  return label ? <span className="sub">{label}</span> : null
}

export function TrashPanel({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  const rows = usePad((s) => s.all)
  const batches = trashEntries(rows)
  const groups = groupByDay(batches, (b) => b.deletedAt)

  function restore(ids: string[]) {
    cmdRestore(ids)
    dialog.current?.close()
  }

  return (
    <dialog ref={dialog} className="import list" aria-labelledby="trash-title">
      <form method="dialog">
        <div className="head">
          <h2 id="trash-title">Archive</h2>
          <button type="submit">Close</button>
        </div>
        {batches.length === 0 ? (
          <p className="empty">Nothing archived in the last {TRASH_DAYS} days.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="day">
              <h3>{g.label}</h3>
              {g.items.map((b) => (
                <div key={b.deletedAt} className="batch">
                  <div className="when">
                    <span>{timeLabel(b.deletedAt)}</span>
                    {b.entries.length > 1 && (
                      <button type="button" className="link" onClick={() => restore(b.entries.map((e) => e.id))}>
                        Restore all {b.count}
                      </button>
                    )}
                  </div>
                  <ul>
                    {b.entries.map((e) => (
                      <li key={e.id}>
                        <span className="line">
                          <span className="txt">{firstLine(e.text)}</span>
                          <Children n={e.childCount} />
                        </span>
                        <button type="button" onClick={() => restore([e.id])}>Restore</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))
        )}
        <div className="actions">
          <p className="note">Archived lines stay here for {TRASH_DAYS} days.</p>
        </div>
      </form>
    </dialog>
  )
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
