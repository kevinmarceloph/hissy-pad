import { useEffect, useRef, useState } from 'react'
import { usePad } from '@hissypad/state'
import { cmdDeleteDone } from '@hissypad/state'
import { copyText } from '../platform/clipboard'
import { DonePanel, TrashPanel } from '../panels/Lists'
import { SearchPanel } from '../panels/Search'
import { clearLog, dumpLog, logEnabled } from '@hissypad/state'
import { PadTabs } from '../pads/PadTabs'
import { showToast, useToast } from './toast'
import { MOD } from '../platform/os'

type Theme = 'system' | 'light' | 'dark'


function readTheme(): Theme {
  try {
    const t = localStorage.getItem('hissypad.theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t === 'system' ? '' : t
}

export function TopBar({ onFreshStart, onSort, onHours, view }: { onFreshStart: () => void; onSort: () => void; onHours: () => void; view: 'pad' | 'fresh' | 'sort' | 'hours' }) {
  const rows = usePad((s) => s.rows)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const toast = useToast((s) => s.text)
  const toastAt = useToast((s) => s.at)
  const setToast = showToast
  const logDialog = useRef<HTMLDialogElement>(null)
  const trashDialog = useRef<HTMLDialogElement>(null)
  const doneDialog = useRef<HTMLDialogElement>(null)
  const searchDialog = useRef<HTMLDialogElement>(null)
  const [logText, setLogText] = useState('')

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem('hissypad.theme', theme) } catch { /* per-device */ }
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast, toastAt])

  // Cmd+K opens Search from anywhere in the pad, a line being typed in included. Not over
  // another dialog, and not from Sort or Fresh start, which have no pad to jump into.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return
      if (view !== 'pad' || document.querySelector('dialog[open]')) return
      e.preventDefault()
      searchDialog.current?.showModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  const liveCount = Object.values(rows).filter((r) => r.deletedAt === null).length
  const doneCount = Object.values(rows).filter((r) => r.deletedAt === null && r.done).length

  function deleteDone() {
    const n = cmdDeleteDone()
    setToast(n === 0 ? 'Nothing crossed out' : `Deleted ${n} ${n === 1 ? 'line' : 'lines'}. ${MOD}+Z brings them back.`)
  }

  return (
    <header className="top">
      <h1>HissyPad</h1>
      <nav className="bar" aria-label="Pad actions">
        <button type="button" onClick={() => searchDialog.current?.showModal()} disabled={view !== 'pad'} title={`Find a line in any pad (${MOD}+K)`}>Search</button>
        <button type="button" onClick={deleteDone} disabled={doneCount === 0 || view !== 'pad'} title="Delete every crossed-out line (undo brings them back)">
          Delete done
        </button>
        <button type="button" onClick={onFreshStart} disabled={liveCount === 0 || view !== 'pad'} title="Pick what stays; the rest moves to a new pad">Fresh start…</button>
        <button type="button" onClick={onSort} disabled={liveCount === 0 || view !== 'pad'} title="One line at a time: swipe left for later, right for today, up for done, down to delete">Sort…</button>
        <button type="button" onClick={onHours} disabled={view !== 'pad'} title="The day, one row per hour: what each was for, what happened, and the lines you put in it">Hours…</button>
        <button type="button" onClick={() => doneDialog.current?.showModal()} aria-label="Recently done" title="Crossed-out lines, newest first">Done</button>
        <button type="button" onClick={() => trashDialog.current?.showModal()} title="Deleted lines from the last 30 days">Trash</button>
        {logEnabled() && (
          <button type="button" onClick={() => { setLogText(dumpLog()); logDialog.current?.showModal() }} title="Debug log (?debug=1 turned this on)">Log</button>
        )}
        <label className="select">
          <span className="sr-only">Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </nav>
      <PadTabs />
      {toast && <output className="toast" aria-live="polite">{toast}</output>}
      <TrashPanel dialog={trashDialog} />
      <DonePanel dialog={doneDialog} />
      <SearchPanel dialog={searchDialog} />
      <dialog ref={logDialog} className="import" aria-labelledby="log-title">
        <form method="dialog">
          <h2 id="log-title">Debug log</h2>
          <p>Every op with the rows it touched, undo and redo, selection, drag and sync events. Newest at the bottom. Turn off with <code>?debug=0</code>.</p>
          <textarea readOnly value={logText} rows={16} aria-label="Debug log text" />
          <div className="actions">
            <button type="button" onClick={() => { clearLog(); setLogText('') }}>Clear</button>
            <button type="button" onClick={() => void copyText(logText)}>Copy</button>
            <button type="submit" className="primary">Close</button>
          </div>
        </form>
      </dialog>
    </header>
  )
}
