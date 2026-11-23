import { useEffect, useRef, useState, type ReactNode } from 'react'
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

// The header's icons, drawn in the ink of whatever holds them. Each sits in a button that
// carries the name (aria-label and title), so none of them is read out itself.
function Icon({ d, children }: { d?: string; children?: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d && <path d={d} />}
      {children}
    </svg>
  )
}
// Pad: an outline, three lines with their bullets.
const PadIcon = () => <Icon d="M7.5 5h9M7.5 10h9M7.5 15h9M3.5 5h.01M3.5 10h.01M3.5 15h.01" />
// Hours: a clock.
const HoursIcon = () => <Icon d="M10 5.5V10l3 2"><circle cx="10" cy="10" r="7" /></Icon>
// Sort: a card on a stack, the one on top being dealt.
const SortIcon = () => <Icon d="M6.5 6.5v-2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2"><rect x="3.5" y="6.5" width="10" height="10" rx="1" /></Icon>
const SearchIcon = () => <Icon d="M13 13l4 4"><circle cx="8.5" cy="8.5" r="5" /></Icon>
const MenuIcon = () => <Icon d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />

const MODES: { view: 'pad' | 'hours' | 'sort'; label: string; title: string; icon: () => ReactNode }[] = [
  { view: 'pad', label: 'Pad', title: 'Pad: the outline', icon: PadIcon },
  { view: 'hours', label: 'Hours', title: 'Hours: the day, one row per hour, with what each was for, what happened, and the lines you put in it', icon: HoursIcon },
  { view: 'sort', label: 'Sort', title: 'Sort: one line of the open pad at a time. Left for later, right for today, up for done, down to delete', icon: SortIcon },
]

export function TopBar({ view, onView }: { view: View; onView: (view: View) => void }) {
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
    setToast(n === 0 ? 'Nothing crossed out' : `Deleted ${n} ${n === 1 ? 'line' : 'lines'}. ${MOD}+Z brings them back.`)
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
      <nav className="tools" aria-label="Search and more">
        <button type="button" className="icon" aria-label="Search" title={`Find a line in any pad (${MOD}+K)`} onClick={() => searchDialog.current?.showModal()}>
          <SearchIcon />
        </button>
        <span className="more">
          <button type="button" className="icon" aria-label="More" aria-haspopup="menu" aria-expanded={menu} title="Done, Trash, Fresh start and the theme" onClick={() => setMenu((open) => !open)}>
            <MenuIcon />
          </button>
          {menu && (
            <div className="more-menu" role="menu" aria-label="More">
              <button type="button" role="menuitem" aria-label="Recently done" title="Crossed-out lines, newest first" onClick={() => pick(() => doneDialog.current?.showModal())}>Done</button>
              <button type="button" role="menuitem" title="Deleted lines from the last 30 days" onClick={() => pick(() => trashDialog.current?.showModal())}>Trash</button>
              {logEnabled() && (
                <button type="button" role="menuitem" title="Debug log (?debug=1 turned this on)" onClick={() => pick(() => { setLogText(dumpLog()); logDialog.current?.showModal() })}>Log</button>
              )}
              <button type="button" role="menuitem" disabled={liveCount === 0 || view === 'fresh'} title="Pick what stays in the open pad; the rest moves to a new pad" onClick={() => pick(() => onView('fresh'))}>Fresh start…</button>
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
      {/* Sort sits above the pads: the tabs pick which pad's lines come next. */}
      {mode !== 'hours' && <PadTabs />}
      {view === 'pad' && doneCount > 0 && (
        <button type="button" className="clear-done" onClick={deleteDone} title="Delete every crossed-out line in this pad (undo brings them back)">
          Clear {doneCount} completed
        </button>
      )}
      {toast && <output className="toast" aria-live="polite">{toast}</output>}
      <TrashPanel dialog={trashDialog} />
      <DonePanel dialog={doneDialog} />
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
