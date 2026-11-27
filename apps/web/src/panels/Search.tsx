// Search every pad: a <dialog> with one field and the matching lines under it, grouped by
// pad. Up and Down walk the list without leaving the field, Enter (or a click) goes to the
// line: its pad opens, anything folded over it unfolds, and the line is selected. A text
// toggle under the field adds the archived lines; going to one opens the Archive at it.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { parseSlot, slotLabel, todayKey } from '@hissypad/core'
import { cmdOpenHit, hitBullet, hitBulletSaid, hitKids, hitNote, search, searchCount, usePad, type SearchHit } from '@hissypad/state'
import { cmdSlotPut, inSlot } from '@hissypad/state/hours'
import { CatMark } from '../pad/CatMark'

// `onOpen` runs when a line found is gone to: the app comes back to the pad from Hours or Sort.
// `onArchived` is handed an archived line that was picked: the app shows it in the Archive.
// `assign` is an hour (a slot key) the search was opened for, from that hour in Hours: the
// line picked is put in the hour instead of gone to, and the view stays where it is. Pads,
// archived lines and the lines already in the hour are left out then.
export function SearchPanel({ dialog, onOpen, onArchived, assign = null, onDone }: { dialog: RefObject<HTMLDialogElement | null>; onOpen?: () => void; onArchived?: (id: string) => void; assign?: string | null; onDone?: () => void }) {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [archived, setArchived] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  const found = useMemo(() => search(all, query, padId, undefined, archived && assign === null), [all, query, padId, archived, assign])
  const result = useMemo(() => {
    if (assign === null) return found
    const groups = found.groups.map((g) => ({ ...g, hits: g.hits.filter((h) => !h.isPad && !h.archived && !inSlot(h.id, assign)) })).filter((g) => g.hits.length > 0)
    return { groups, total: groups.reduce((n, g) => n + g.hits.length, 0) }
  }, [found, assign])
  const hits = useMemo(() => result.groups.flatMap((g) => g.hits), [result])
  const hour = assign === null ? null : parseSlot(assign)
  const what = hour && assign ? `Find a line for ${slotLabel(assign, todayKey())}` : 'Search every pad'
  const at = Math.min(active, hits.length - 1)

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [at, result])

  function open(hit: SearchHit | undefined) {
    if (!hit) return
    dialog.current?.close()
    if (hour) return cmdSlotPut(hit.id, hour.day, hour.hour)
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
    <dialog ref={dialog} className="import search" aria-label={hour ? what : 'Search'} onClose={() => { setQuery(''); setActive(0); onDone?.() }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); open(hits[at]) }}>
        <div className="bar">
        <input
          ref={field}
          type="search"
          role="combobox"
          aria-label={what}
          aria-expanded={hits.length > 0}
          aria-controls="search-results"
          aria-activedescendant={hits[at] ? `hit-${hits[at].id}` : undefined}
          aria-autocomplete="list"
          placeholder={what}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
        />
        <button type="button" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        {!hour && (
        <button type="button" className="link toggle" aria-pressed={archived} onClick={() => { setArchived(!archived); setActive(0); field.current?.focus() }}>
          {archived ? 'Leave out archived lines' : 'Search archived lines too'}
        </button>
        )}
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
                    className={['hit', h.done && 'is-done', h.archived && 'is-archived', h.kind === 'header' && !h.isPad && 'is-header'].filter(Boolean).join(' ')}
                    onClick={() => open(h)}
                    onMouseMove={() => { if (i !== at) setActive(i) }}
                  >
                    <span className="line">
                      <HitMark hit={h} />
                      <CatMark id={h.category} />
                      <span className="txt">
                        {h.parts.map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
                      </span>
                      {hitKids(h) && <span className="kids" title={`${h.children} ${h.children === 1 ? 'line' : 'lines'} under it`}>{hitKids(h)}</span>}
                    </span>
                    <span className="sub">{hitNote(h)}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <p className="note" role="status">
          {hour ? (!typed ? 'Lines from every pad. Enter puts the line in this hour, where it is in its pad.' : hits.length === 0 ? 'Nothing found.' : `${searchCount(result)}.`) : !typed ? `Lines from every pad, crossed-out ones${archived ? ' and archived ones' : ''} too. Enter goes to the line${archived ? ', or to an archived one in the Archive' : ''}.` : hits.length === 0 ? 'Nothing found.' : `${searchCount(result)}.`}
        </p>
      </form>
    </dialog>
  )
}

// The hit's bullet, as its pad draws it: a dot, a dot in a ring (doing), a cross (done), a
// "#" for a header, its number for a numbered line, a short rule for a divider (styles.css).
// A pad's name has none; its column stays so the words line up.
function HitMark({ hit }: { hit: SearchHit }) {
  const b = hitBullet(hit)
  if (!b) return <span className="hit-mark" aria-hidden="true" />
  const said = hitBulletSaid(hit)
  return (
    <span
      className={`hit-mark kind-${b.kind} state-${b.state}`}
      data-label={b.label ?? undefined}
      role={said ? 'img' : undefined}
      aria-label={said || undefined}
      aria-hidden={said ? undefined : true}
    />
  )
}
