// The Archive as a screen of its own: every archived line drawn like a pad's, the newest
// archive first, in an order that cannot be changed. A click on a line selects it (Shift
// for a run); the one action is Unarchive, which puts each line at the top of the pad its
// chip names. The list, the selection rules and the command are the state package's
// archive.ts, the same as the phone's screen.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  ARCHIVE_DAYS, NO_ARCHIVE_SELECTION, archiveCovered, archiveLines, archivePrune, archiveRecent, archiveTap, cmdUnarchive, dayLabel,
  redo, unarchivedLabel, undo, usePad, type ArchiveLine, type ArchiveSelection,
} from '@hissypad/state'
import { slotLabel, todayKey } from '@hissypad/core'
import { useLineCategory } from '@hissypad/state/hours'
import { markClass } from '../pad/CatMark'
import { Styled } from '../pad/Row'
import { showToast } from '../app/toast'
import { MOD } from '../platform/os'

function Line({ line, selected, covered, found, onTap }: { line: ArchiveLine; selected: boolean; covered: boolean; found: boolean; onTap: (id: string, e: MouseEvent) => void }) {
  const { row } = line
  const category = useLineCategory(row.category)
  const cls = [
    'row', 'is-static', row.done && 'is-done', row.doing && 'is-doing', line.number !== null && 'is-numbered', row.header && line.number === null && 'is-header', row.divider && 'is-divider', category && 'has-category',
    selected && 'is-selected', covered && 'is-selected-child', found && 'is-found',
  ].filter(Boolean).join(' ')
  // The pad it was in; an archived pad says what it is. A line under another has no chip:
  // it was in the same pad as the line on top.
  const chip = line.isPad ? 'Pad' : line.depth === 0 ? line.source : null
  const where = line.isPad ? 'A pad: it comes back as a tab, with its lines' : line.sourceLive ? `It was in ${line.source}: unarchiving puts it at the top there` : `It was in ${line.source}, which is archived too: unarchived alone, it goes to the Inbox`
  return (
    <div
      className={cls}
      style={{ '--depth': line.depth } as React.CSSProperties}
      data-id={line.id}
      role="treeitem"
      aria-selected={selected}
      aria-level={line.depth + 1}
      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
      onClick={(e) => onTap(line.id, e)}
    >
      <button type="button" className="bullet" data-num={line.number !== null ? `${line.number}.` : undefined} aria-label={selected ? 'Deselect line' : 'Select line'} />
      {category && (
        <span className={`category ${markClass(category)}`} title={category.label} aria-label={`Category: ${category.label}`}>
          {category.icon || category.label}
        </span>
      )}
      <div className="text">
        {row.text.trim() === '' ? <span className="placeholder" aria-hidden="true">{'​'}</span> : row.divider ? <span className="divider-label"><Styled text={row.text} /></span> : <Styled text={row.text} />}
        {row.slot && <span className="slot" data-slot={row.slot} title="The hour this line is in">{slotLabel(row.slot, todayKey())}</span>}
      </div>
      {chip && <span className={line.isPad || line.sourceLive ? 'src' : 'src is-gone'} title={where}>{chip}</span>}
    </div>
  )
}

// `at` is a line to open at (an archived line picked in Search): it is scrolled to and
// marked. `onClose` goes back to the pad.
export function Archive({ at, onClose }: { at: { id: string; rev: number } | null; onClose: () => void }) {
  const all = usePad((s) => s.all)
  const lines = useMemo(() => archiveLines(all), [all])
  const recent = useMemo(() => archiveRecent(lines), [lines])
  const [older, setOlder] = useState(false)
  const [picked, setPicked] = useState<ArchiveSelection>(NO_ARCHIVE_SELECTION)
  const list = useRef<HTMLDivElement>(null)

  // A line found in Search may be older than what the screen opens with.
  const atIndex = at ? lines.findIndex((l) => l.id === at.id) : -1
  const shown = older || atIndex >= recent ? lines : lines.slice(0, recent)
  const sel = archivePrune(picked, lines)
  const selected = useMemo(() => new Set(sel.ids), [sel])
  const covered = useMemo(() => archiveCovered(lines, sel.ids), [lines, sel])
  const count = sel.ids.length + covered.size

  useEffect(() => {
    if (!at) return
    list.current?.querySelector(`[data-id="${at.id}"]`)?.scrollIntoView?.({ block: 'center' })
  }, [at?.id, at?.rev])

  function unarchive() {
    if (sel.ids.length === 0) return
    // In the order they are listed, so they land in that order.
    const order = lines.filter((l) => selected.has(l.id)).map((l) => l.id)
    showToast(`${unarchivedLabel(cmdUnarchive(order))} ${MOD}+Z takes it back.`)
    setPicked(NO_ARCHIVE_SELECTION)
  }

  // Esc clears the selection, Cmd+A takes every line shown, Cmd+Z and Cmd+Shift+Z undo and
  // redo (an unarchive is one step). Not while a dialog is open over the screen.
  const keys = useRef({ unarchive, shown })
  keys.current = { unarchive, shown }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.querySelector('dialog[open]')) return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') setPicked(NO_ARCHIVE_SELECTION)
      else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const ids = keys.current.shown.filter((l) => l.depth === 0).map((l) => l.id)
        setPicked({ ids, anchorId: ids[0] ?? null })
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key === 'Enter' && !mod) keys.current.unarchive()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onTap = (id: string, e: MouseEvent) => {
    // A link in a line opens; it does not also select the line.
    if ((e.target as HTMLElement).closest('a')) return
    setPicked(archiveTap(sel, shown, id, e.shiftKey))
  }

  let day = ''
  return (
    <section className="pad archive" aria-labelledby="archive-title">
      <div className="archive-top">
        <h2 id="archive-title">Archive</h2>
        <button type="button" className="link" onClick={onClose}>Back to the pad</button>
      </div>
      {lines.length === 0 ? (
        <p className="hint">Nothing is archived.</p>
      ) : (
        <div className="rows" role="tree" aria-multiselectable="true" aria-label="Archived lines" ref={list}>
          {shown.map((l) => {
            // A heading where the day changes, as the day of the line on top.
            const label = l.depth === 0 ? dayLabel(l.deletedAt) : day
            const head = label !== day
            day = label
            return (
              <div key={l.id} role="presentation">
                {head && <h3 className="day" role="presentation">{label}</h3>}
                <Line line={l} selected={selected.has(l.id)} covered={covered.has(l.id)} found={at?.id === l.id} onTap={onTap} />
              </div>
            )
          })}
        </div>
      )}
      {shown.length < lines.length && (
        <button type="button" className="link older" onClick={() => setOlder(true)}>
          Show the {lines.length - shown.length} older {lines.length - shown.length === 1 ? 'line' : 'lines'}
        </button>
      )}
      {lines.length > 0 && (
        <p className="hint">
          {shown.length < lines.length ? `Lines archived in the last ${ARCHIVE_DAYS} days, the newest first. ` : 'Every archived line, the newest first. '}
          Click lines to select them. Unarchive puts each at the top of the pad it was in.
        </p>
      )}
      {sel.ids.length > 0 && (
        <div className="selwrap">
          <div className="bar selbar" role="toolbar" aria-label="Selected lines">
            <span className="count">{count} {count === 1 ? 'line' : 'lines'}</span>
            <button type="button" onClick={unarchive} title="Put each line at the top of the pad it was in (Enter)">Unarchive</button>
            <span className="sep" aria-hidden="true" />
            <button type="button" onClick={() => setPicked(NO_ARCHIVE_SELECTION)} aria-label="Clear selection" title="Clear selection (Esc)">×</button>
          </div>
        </div>
      )}
    </section>
  )
}
