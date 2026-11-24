import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePad } from '@hissypad/state'
import { cmdDeleteDone } from '@hissypad/state'
import { copyText } from '../platform/clipboard'
import { DonePanel, TrashPanel } from '../panels/Lists'
import { SearchPanel } from '../panels/Search'
import { CategoriesDialog } from '../panels/Hours'
import { clearLog, dumpLog, logEnabled } from '@hissypad/state'
import { PadTabs } from '../pads/PadTabs'
import { showToast, useToast } from './toast'
import { MOD } from '../platform/os'
import { HoursIcon, MenuIcon, PadIcon, PlusIcon, SearchIcon, SortIcon } from './icons'

type Theme = 'system' | 'light' | 'dark'
export type View = 'pad' | 'fresh' | 'sort' | 'hours'


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

const MODES: { view: 'pad' | 'hours' | 'sort'; label: string; title: string; icon: () => ReactNode }[] = [
  { view: 'hours', label: 'Hours', title: 'Hours: the day, one row per hour, with what each was for, what happened, and the lines you put in it', icon: HoursIcon },
  { view: 'pad', label: 'Pad', title: 'Pad: the outline', icon: PadIcon },
  { view: 'sort', label: 'Sort', title: 'Sort: one line of the open pad at a time. Left for later, right for today, up for done, down to archive', icon: SortIcon },
]

// `onCreate` opens the new item's card (the + beside Search).
export function TopBar({ view, onView, onCreate }: { view: View; onView: (view: View) => void; onCreate: () => void }) {
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
  const [menu, setMenu] = useState(false)
  const [categories, setCategories] = useState(false)
  // Sort's card or the new item's: `rows` is only what is under one line then.
  const zoomed = usePad((s) => s.zoomId !== null)

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem('hissypad.theme', theme) } catch { /* per-device */ }
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast, toastAt])

  // Cmd+K opens Search from any mode, a line being typed in included. Not over another
  // dialog. Going to a line found comes back to the pad.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      searchDialog.current?.showModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The menu closes on a press outside it and on Escape.
  useEffect(() => {
    if (!menu) return
    const away = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.('.top .more')) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
    }
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const liveCount = Object.values(rows).filter((r) => r.deletedAt === null).length
  const doneCount = Object.values(rows).filter((r) => r.deletedAt === null && r.done).length
  // Fresh start is a way of looking at the pad, so the switcher still says Pad.
  const mode = view === 'fresh' ? 'pad' : view

  function deleteDone() {
    const n = cmdDeleteDone()
    setToast(n === 0 ? 'Nothing crossed out' : `Archived ${n} ${n === 1 ? 'line' : 'lines'}. ${MOD}+Z brings them back.`)
  }

  function pick(run: () => void) {
    setMenu(false)
    run()
  }

  return (
    <header className="top">
      <h1>HissyPad</h1>
      <div className="modes" role="group" aria-label="Mode">
        {MODES.map((m) => (
          <button key={m.view} type="button" aria-label={m.label} aria-pressed={mode === m.view} title={m.title} onClick={() => onView(m.view)}>
            <m.icon />
          </button>
        ))}
      </div>
      <nav className="tools" aria-label="New item, search and more">
        <button type="button" className="icon" aria-label="New item" title="A new item: its words, its pad, its hour and its sub items" onClick={onCreate}>
          <PlusIcon />
        </button>
        <button type="button" className="icon" aria-label="Search" title={`Find a line in any pad (${MOD}+K)`} onClick={() => searchDialog.current?.showModal()}>
          <SearchIcon />
        </button>
        <span className="more">
          <button type="button" className="icon" aria-label="More" aria-haspopup="menu" aria-expanded={menu} title="Done, Archive, Categories, Fresh start and the theme" onClick={() => setMenu((open) => !open)}>
            <MenuIcon />
          </button>
          {menu && (
            <div className="more-menu" role="menu" aria-label="More">
              <button type="button" role="menuitem" aria-label="Recently done" title="Crossed-out lines, newest first" onClick={() => pick(() => doneDialog.current?.showModal())}>Done</button>
              <button type="button" role="menuitem" title="Archived lines from the last 30 days" onClick={() => pick(() => trashDialog.current?.showModal())}>Archive</button>
              <button type="button" role="menuitem" title="The categories hours and lines can go in: add, rename, recolor, reorder, archive" onClick={() => pick(() => setCategories(true))}>Categories</button>
              {logEnabled() && (
                <button type="button" role="menuitem" title="Debug log (?debug=1 turned this on)" onClick={() => pick(() => { setLogText(dumpLog()); logDialog.current?.showModal() })}>Log</button>
              )}
              <button type="button" role="menuitem" disabled={(liveCount === 0 && !zoomed) || view === 'fresh'} title="Pick what stays in the open pad; the rest moves to a new pad" onClick={() => pick(() => onView('fresh'))}>Fresh start…</button>
              <label className="select">
                <span>Theme</span>
                <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
            </div>
          )}
        </span>
      </nav>
      {/* The pad tabs are the pad's only: Sort picks its pad in its own title. */}
      {mode === 'pad' && <PadTabs />}
      {view === 'pad' && doneCount > 0 && (
        <button type="button" className="clear-done" onClick={deleteDone} title="Archive every crossed-out line in this pad (undo brings them back)">
          Archive {doneCount} completed
        </button>
      )}
      {toast && <output className="toast" aria-live="polite">{toast}</output>}
      <TrashPanel dialog={trashDialog} />
      <DonePanel dialog={doneDialog} />
      {categories && <CategoriesDialog onClose={() => setCategories(false)} />}
      <SearchPanel dialog={searchDialog} onOpen={() => onView('pad')} />
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
