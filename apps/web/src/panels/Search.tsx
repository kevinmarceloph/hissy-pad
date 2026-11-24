// Search every pad: a <dialog> with one field and the matching lines under it, grouped by
// pad. Up and Down walk the list without leaving the field, Enter (or a click) goes to the
// line: its pad opens, anything folded over it unfolds, and the line is selected. A text
// toggle under the field adds the archived lines; going to one opens the Archive at it.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { cmdOpenHit, search, searchCount, usePad, type SearchHit } from '@hissypad/state'

// `onOpen` runs when a line found is gone to: the app comes back to the pad from Hours or Sort.
// `onArchived` is handed an archived line that was picked: the app shows it in the Archive.
export function SearchPanel({ dialog, onOpen, onArchived }: { dialog: RefObject<HTMLDialogElement | null>; onOpen?: () => void; onArchived?: (id: string) => void }) {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [archived, setArchived] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  const result = useMemo(() => search(all, query, padId, undefined, archived), [all, query, padId, archived])
  const hits = useMemo(() => result.groups.flatMap((g) => g.hits), [result])
  const at = Math.min(active, hits.length - 1)

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [at, result])

  function open(hit: SearchHit | undefined) {
    if (!hit) return
    dialog.current?.close()
    if (hit.archived) return onArchived?.(hit.id)
    cmdOpenHit(hit.id)
    onOpen?.()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (hits.length === 0) return
    setActive((at + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length)
  }

  const typed = query.trim() !== ''
  let n = 0

  return (
    <dialog ref={dialog} className="import search" aria-label="Search" onClose={() => { setQuery(''); setActive(0) }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); open(hits[at]) }}>
        <div className="bar">
        <input
          ref={field}
          type="search"
          role="combobox"
          aria-label="Search every pad"
          aria-expanded={hits.length > 0}
          aria-controls="search-results"
          aria-activedescendant={hits[at] ? `hit-${hits[at].id}` : undefined}
          aria-autocomplete="list"
          placeholder="Search every pad"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
        />
        <button type="button" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        <button type="button" className="link toggle" aria-pressed={archived} onClick={() => { setArchived(!archived); setActive(0); field.current?.focus() }}>
          {archived ? 'Leave out archived lines' : 'Search archived lines too'}
        </button>
        <div className="results" id="search-results" role="listbox" aria-label="Lines found" ref={list}>
          {result.groups.map((g) => (
            <div key={g.archived ? 'archive' : g.padId ?? 'main'} role="group" aria-label={g.name}>
              <h3 aria-hidden="true">{g.name}</h3>
              {g.hits.map((h) => {
                const i = n++
                return (
                  <div
                    key={h.id}
                    id={`hit-${h.id}`}
                    role="option"
                    aria-selected={i === at}
                    className={['hit', h.done && 'is-done', h.archived && 'is-archived'].filter(Boolean).join(' ')}
                    onClick={() => open(h)}
                    onMouseMove={() => { if (i !== at) setActive(i) }}
                  >
                    <span className="txt">
                      {h.parts.map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
                    </span>
                    <span className="sub">{[h.isPad && 'Pad', ...h.path].filter(Boolean).join(' › ')}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <p className="note" role="status">
          {!typed ? `Lines from every pad, crossed-out ones${archived ? ' and archived ones' : ''} too. Enter goes to the line${archived ? ', or to an archived one in the Archive' : ''}.` : hits.length === 0 ? 'Nothing found.' : `${searchCount(result)}.`}
        </p>
      </form>
    </dialog>
  )
}
