// Search every pad: a <dialog> with one field and the matching lines under it, grouped by
// pad. Up and Down walk the list without leaving the field, Enter (or a click) goes to the
// line: its pad opens, anything folded over it unfolds, and the line is selected.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { cmdOpenHit, search, searchCount, usePad } from '@hissypad/state'

export function SearchPanel({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const result = useMemo(() => search(all, query, padId), [all, query, padId])
  const hits = useMemo(() => result.groups.flatMap((g) => g.hits), [result])
  const at = Math.min(active, hits.length - 1)

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [at, result])

  function open(id: string | undefined) {
    if (!id) return
    dialog.current?.close()
    cmdOpenHit(id)
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
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); open(hits[at]?.id) }}>
        <div className="bar">
        <input
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
        <div className="results" id="search-results" role="listbox" aria-label="Lines found" ref={list}>
          {result.groups.map((g) => (
            <div key={g.padId ?? 'main'} role="group" aria-label={g.name}>
              <h3 aria-hidden="true">{g.name}</h3>
              {g.hits.map((h) => {
                const i = n++
                return (
                  <div
                    key={h.id}
                    id={`hit-${h.id}`}
                    role="option"
                    aria-selected={i === at}
                    className={h.done ? 'hit is-done' : 'hit'}
                    onClick={() => open(h.id)}
                    onMouseMove={() => { if (i !== at) setActive(i) }}
                  >
                    <span className="txt">
                      {h.parts.map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
                    </span>
                    <span className="sub">{h.isPad ? 'Pad' : h.path.join(' › ')}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <p className="note" role="status">
          {!typed ? 'Lines from every pad, crossed-out ones too. Enter goes to the line.' : hits.length === 0 ? 'Nothing found.' : `${searchCount(result)}.`}
        </p>
      </form>
    </dialog>
  )
}
