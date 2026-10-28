import { useEffect, useRef, useState } from 'react'
import { toOutline } from '@hissypad/core'
import { importOutline, usePad } from './store'
import { cmdDeleteDone } from './commands'
import { copyText } from './clipboard'
import { clearLog, dumpLog, logEnabled } from './log'

type Theme = 'system' | 'light' | 'dark'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

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

export function TopBar() {
  const rows = usePad((s) => s.rows)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [toast, setToast] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const logDialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState('')
  const [logText, setLogText] = useState('')

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem('hissypad.theme', theme) } catch { /* per-device */ }
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const liveCount = Object.values(rows).filter((r) => r.deletedAt === null).length
  const doneCount = Object.values(rows).filter((r) => r.deletedAt === null && r.done).length

  function deleteDone() {
    const n = cmdDeleteDone()
    setToast(n === 0 ? 'Nothing crossed out' : `Deleted ${n} ${n === 1 ? 'line' : 'lines'}. ${isMac ? '⌘' : 'Ctrl'}+Z brings them back.`)
  }

  function exportAll() {
    const live = Object.values(rows).filter((r) => r.deletedAt === null && r.parentId === null).map((r) => r.id)
    const text = toOutline(rows, live, { bullet: '', indent: '\t', done: '' })
    void copyText(text).then((ok) => setToast(ok ? 'Copied the whole pad as text' : null))
  }

  function doImport(where: 'top' | 'bottom') {
    const ids = importOutline(draft, where)
    setDraft('')
    dialog.current?.close()
    setToast(ids.length ? `Added ${ids.length} ${ids.length === 1 ? 'line' : 'lines'}` : 'Nothing to add')
  }

  return (
    <header className="top">
      <h1>HissyPad</h1>
      <nav className="bar" aria-label="Pad actions">
        <button type="button" onClick={deleteDone} disabled={doneCount === 0} title="Delete every crossed-out line (undo brings them back)">
          Delete done
        </button>
        <button type="button" onClick={() => dialog.current?.showModal()}>Paste in…</button>
        <button type="button" onClick={exportAll} disabled={liveCount === 0}>Copy all</button>
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
      {toast && <output className="toast" aria-live="polite">{toast}</output>}
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
      <dialog ref={dialog} className="import" aria-labelledby="import-title" onClose={() => setDraft('')}>
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); doImport('top') }}>
          <h2 id="import-title">Paste an outline</h2>
          <p>Plain text from Google Docs, Workflowy or anywhere. Indentation becomes nesting, bullets and numbers are dropped, blank lines stay as spacers.</p>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} aria-label="Outline text" placeholder={'1. IGS Meal Planning\n2. Job Hunt (before 9pm)\n\t• Fix current copy'} />
          <div className="actions">
            <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="button" onClick={() => doImport('bottom')} disabled={!draft.trim()}>Add at bottom</button>
            <button type="submit" className="primary" disabled={!draft.trim()}>Add at top</button>
          </div>
        </form>
      </dialog>
    </header>
  )
}
