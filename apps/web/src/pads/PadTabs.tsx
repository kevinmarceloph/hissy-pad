import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { cmdDeletePad, cmdMovePad, cmdNewPad, cmdPadToLine, cmdRenamePad, cmdSetPadCount, openPad, openSubPad, padList, padTopLines, placeList, usePad } from '@hissypad/state'
import type { FixedPad, PadId } from '@hissypad/core'
import { showToast } from '../app/toast'
import { MOD } from '../platform/os'
import { CalendarIcon, HoursIcon, SortIcon } from '../app/icons'

// The fixed pads' icons: Today is the day (Hours' clock), Inbox is what is still to sort,
// Later is the calendar.
const FIXED_ICON: Record<FixedPad, () => ReactElement> = { Today: HoursIcon, Inbox: SortIcon, Later: CalendarIcon }


type Sheet = { mode: 'new' } | { mode: 'edit'; padId: string }

// The pads as a row of tabs under the title. Today, Inbox and Later are always first, each
// with its icon, and cannot be renamed, moved or deleted; clicking the open tab of any
// other pad opens its name, place and delete.
export function PadTabs() {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const pads = useMemo(() => padList(all), [all])
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [into, setInto] = useState('')
  // The sub-pad menu of one tab: which pad, and where its chevron is on screen.
  const [subs, setSubs] = useState<{ key: string; left: number; top: number } | null>(null)
  const places = useMemo(() => placeList(all), [all])

  useEffect(() => {
    if (!sheet) return
    setName(sheet.mode === 'edit' ? (all[sheet.padId]?.text ?? '') : '')
    setConfirming(false)
    setInto('')
    dialog.current?.showModal()
    input.current?.focus()
    input.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet])

  function pick(id: PadId, fixed: boolean) {
    if (id === padId) {
      if (id !== null && !fixed) setSheet({ mode: 'edit', padId: id })
      return
    }
    openPad(id)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!sheet) return
    if (sheet.mode === 'new') cmdNewPad(name)
    else cmdRenamePad(sheet.padId, name)
    dialog.current?.close()
  }

  function remove() {
    if (!sheet || sheet.mode !== 'edit') return
    const label = all[sheet.padId]?.text || 'Untitled pad'
    const n = cmdDeletePad(sheet.padId)
    dialog.current?.close()
    showToast(`Archived “${label}”${n ? ` and its ${n} ${n === 1 ? 'line' : 'lines'}` : ''}. ${MOD}+Z brings it back.`)
  }

  // The opposite of Make pad: the pad becomes a line at the top of the pad picked.
  function fold() {
    if (!sheet || sheet.mode !== 'edit') return
    const target = foldTargets.find((p) => p.key === into) ?? foldTargets[0]
    if (!target) return
    const label = cmdPadToLine(sheet.padId, target)
    dialog.current?.close()
    if (label) showToast(`“${label}” is a line in ${target.label} now. ${MOD}+Z brings the pad back.`)
  }

  // A pad folds into any other pad or sub-pad, not into one of its own.
  const foldTargets = sheet?.mode === 'edit' ? places.filter((p) => p.padId !== sheet.padId) : []

  useEffect(() => {
    if (!subs) return
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.('.pads .subs, .sub-menu')) setSubs(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSubs(null)
    }
    const gone = () => setSubs(null)
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', gone)
    window.addEventListener('scroll', gone, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', gone)
      window.removeEventListener('scroll', gone, true)
    }
  }, [subs])

  function toggleSubs(key: string, el: HTMLElement) {
    if (subs?.key === key) return setSubs(null)
    const r = el.getBoundingClientRect()
    const half = 96
    setSubs({ key, left: Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8), top: r.bottom + 4 })
  }

  const lines = sheet?.mode === 'edit' ? padTopLines(all, sheet.padId) : 0

  return (
    <nav className="pads" aria-label="Pads">
      <div role="tablist" aria-label="Pads">
        {pads.map((p) => {
          const key = p.id ?? 'main'
          const Glyph = p.fixed ? FIXED_ICON[p.fixed] : null
          const showCounts = p.countShown
          return (
            <span key={key} className={p.fixed ? 'pad-tab fixed' : 'pad-tab'}>
              <button
                type="button"
                role="tab"
                aria-selected={p.id === padId}
                title={(p.id === padId && p.id !== null && !p.fixed ? 'Rename, fold in or delete this pad' : `Open ${p.name}`) + (p.count > 0 ? `: ${p.count} open ${p.count === 1 ? 'line' : 'lines'}` : '')}
                onClick={() => pick(p.id, p.fixed !== null)}
              >
                {Glyph && <span className="glyph"><Glyph /></span>}
                <span className="name">{p.name}</span>
                {showCounts && p.count > 0 && <span className="n" aria-hidden="true"> {p.count}</span>}
              </button>
              {p.subs.length > 0 && (
                <button
                  type="button"
                  className="subs"
                  aria-label={`Sub-pads of ${p.name}`}
                  aria-haspopup="menu"
                  aria-expanded={subs?.key === key}
                  title={`Jump to a sub-pad of ${p.name}`}
                  onClick={(e) => toggleSubs(key, e.currentTarget)}
                />
              )}
              {subs?.key === key && createPortal(
                <div className="bar moveto-menu sub-menu" role="menu" aria-label={`Sub-pads of ${p.name}`} style={{ left: subs.left, top: subs.top }}>
                  {p.subs.map((sp) => (
                    <button key={sp.id} type="button" role="menuitem" title={sp.name} onClick={() => { setSubs(null); openSubPad(sp.id) }}>
                      {sp.name}{showCounts && sp.count > 0 && <span className="n" aria-hidden="true"> {sp.count}</span>}
                    </button>
                  ))}
                </div>,
                document.body,
              )}
            </span>
          )
        })}
      </div>
      <button type="button" className="add" aria-label="New pad" title="New pad" onClick={() => setSheet({ mode: 'new' })}>+</button>
      <dialog ref={dialog} className="import pad-sheet" aria-labelledby="pad-title" onClose={() => setSheet(null)}>
        <form onSubmit={submit}>
          <h2 id="pad-title">{sheet?.mode === 'new' ? 'New pad' : 'This pad'}</h2>
          <label className="field">
            <span>Name</span>
            <input ref={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={sheet?.mode === 'new' ? 'Work, Ideas, a trip…' : ''} aria-label="Pad name" />
          </label>
          {sheet?.mode === 'edit' && (() => {
            const i = pads.findIndex((p) => p.id === sheet.padId)
            const first = pads.findIndex((p) => !p.fixed && p.id !== null)
            return (
              <div className="field order">
                <span>Place among the pads</span>
                <div>
                  <button type="button" onClick={() => cmdMovePad(sheet.padId, -1)} disabled={i <= first} aria-label="Move pad left">← Move left</button>
                  <button type="button" onClick={() => cmdMovePad(sheet.padId, 1)} disabled={i < 0 || i >= pads.length - 1} aria-label="Move pad right">Move right →</button>
                </div>
              </div>
            )
          })()}
          {sheet?.mode === 'edit' && (
            <label className="field check-field">
              <input type="checkbox" checked={all[sheet.padId]?.countHidden !== true} onChange={(e) => cmdSetPadCount(sheet.padId, e.target.checked)} />
              <span>Show the count of open lines on this tab</span>
            </label>
          )}
          {sheet?.mode === 'edit' && (
            <div className="field order">
              <span>Fold into another pad, as a line with this pad's lines under it</span>
              <div>
                <select value={into} onChange={(e) => setInto(e.target.value)} aria-label="Fold into">
                  {foldTargets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                <button type="button" onClick={fold} aria-label="Fold in">Fold in</button>
              </div>
            </div>
          )}
          {confirming && (
            <p role="status">Archive this pad{lines ? ` and the ${lines} ${lines === 1 ? 'line' : 'lines'} at its top level, with everything under them` : ''}? Undo or the Archive brings it back.</p>
          )}
          <div className="actions">
            {sheet?.mode === 'edit' && !confirming && (
              <button type="button" className="danger" onClick={() => setConfirming(true)}>Archive pad…</button>
            )}
            {sheet?.mode === 'edit' && confirming && (
              <button type="button" className="danger" onClick={remove}>Archive</button>
            )}
            <span className="grow" />
            <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className="primary" disabled={!name.trim()}>{sheet?.mode === 'new' ? 'Create' : 'Save'}</button>
          </div>
        </form>
      </dialog>
    </nav>
  )
}
