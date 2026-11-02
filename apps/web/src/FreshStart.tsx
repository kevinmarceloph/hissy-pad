import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { resolveSides, sendTo, sideRows, type Side, type Sides } from '@hissypad/core'
import { archiveNameFor, cmdFreshStart, padName, usePad } from '@hissypad/state'
import { showToast } from './toast'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const NONE: Sides = { right: new Set(), left: new Set() }

interface Pick {
  side: Side
  ids: string[]       // in pane order
  anchor: string | null
}

// Two panes. The left is the pad as it is; the right is what stays after the fresh start.
// Lines go across with the arrows (or a double-click), nothing is written until "Start
// fresh", and then it is one undo step. The left side becomes a new pad, named below it.
export function FreshStart({ onClose }: { onClose: () => void }) {
  const rows = usePad((s) => s.rows)
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const [sides, setSides] = useState<Sides>(NONE)
  const [pick, setPick] = useState<Pick>({ side: 'left', ids: [], anchor: null })
  const [name, setName] = useState(() => archiveNameFor(all, padId))

  const resolved = useMemo(() => resolveSides(rows, sides), [rows, sides])
  const left = useMemo(() => sideRows(rows, resolved, 'left'), [rows, resolved])
  const right = useMemo(() => sideRows(rows, resolved, 'right'), [rows, resolved])
  const picked = useMemo(() => new Set(pick.ids), [pick])
  // Lines under a picked line on the same side move with it: a fainter wash.
  const pickedChild = useMemo(() => {
    const list = pick.side === 'left' ? left : right
    const set = new Set<string>()
    for (const r of list) {
      let p = r.parentId
      while (p !== null) {
        if (picked.has(p)) { set.add(r.id); break }
        p = list.find((x) => x.id === p)?.parentId ?? null
      }
    }
    return set
  }, [pick.side, left, right, picked])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function clickRow(side: Side, id: string, e: MouseEvent) {
    const list = side === 'left' ? left : right
    const order = list.map((r) => r.id)
    setPick((cur) => {
      const same = cur.side === side
      if (e.shiftKey && same && cur.anchor) {
        const a = order.indexOf(cur.anchor)
        const b = order.indexOf(id)
        const [lo, hi] = a < b ? [a, b] : [b, a]
        return { side, ids: order.slice(lo, hi + 1), anchor: cur.anchor }
      }
      if ((e.metaKey || e.ctrlKey) && same) {
        const has = cur.ids.includes(id)
        const ids = has ? cur.ids.filter((x) => x !== id) : order.filter((x) => cur.ids.includes(x) || x === id)
        return { side, ids, anchor: has ? (ids.at(-1) ?? null) : id }
      }
      if (same && cur.ids.length === 1 && cur.ids[0] === id) return { side, ids: [], anchor: null }
      return { side, ids: [id], anchor: id }
    })
  }

  function send(ids: string[], to: Side) {
    if (ids.length === 0) return
    setSides((s) => sendTo(rows, s, ids, to))
    setPick({ side: to === 'right' ? 'left' : 'right', ids: [], anchor: null })
  }

  function commit() {
    const res = cmdFreshStart(sides, name)
    const n = res.moved
    showToast(n === 0 ? 'Nothing to move: every line stayed.' : `Fresh start. ${n} ${n === 1 ? 'line' : 'lines'} went to “${name.trim() || archiveNameFor(all, padId)}”. ${isMac ? '⌘' : 'Ctrl'}+Z brings them back.`)
    onClose()
  }

  const here = padName(all, padId)
  const canRight = pick.side === 'left' && pick.ids.length > 0
  const canLeft = pick.side === 'right' && pick.ids.length > 0

  const pane = (side: Side, list: typeof left) => (
    <div className="pane-rows" role="listbox" aria-multiselectable="true" aria-label={side === 'left' ? 'Lines that will move to the new pad' : 'Lines that stay'}>
      {list.length === 0 && (
        <p className="hint">{side === 'left' ? 'Nothing left to put away.' : 'Nothing here yet. Pick lines on the left and send them over with →.'}</p>
      )}
      {list.map((r) => {
        const row = rows[r.id]!
        const sel = pick.side === side && picked.has(r.id)
        const cls = ['row', 'is-static', row.done && 'is-done', row.text === '' && 'is-empty', row.header && 'is-header', sel && 'is-selected', pick.side === side && pickedChild.has(r.id) && 'is-selected-child'].filter(Boolean).join(' ')
        return (
          <div
            key={r.id}
            className={cls}
            style={{ '--depth': r.depth } as React.CSSProperties}
            role="option"
            aria-selected={sel}
            onClick={(e) => clickRow(side, r.id, e)}
            onDoubleClick={() => send([r.id], side === 'left' ? 'right' : 'left')}
          >
            <span className="bullet" aria-hidden="true" />
            <div className="text">{row.text === '' ? '​' : row.text}</div>
          </div>
        )
      })}
    </div>
  )

  return (
    <section className="fresh" aria-labelledby="fresh-title">
      <header className="fresh-head">
        <div>
          <h2 id="fresh-title">Fresh start</h2>
          <p>Send across what stays in <strong>{here}</strong>. Everything left behind moves to a new pad, order and nesting kept. One undo step.</p>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={commit} disabled={left.length === 0 && right.length === 0}>Start fresh</button>
        </div>
      </header>
      <div className="panes">
        <section className="pane" aria-label="Leaving">
          <h3>
            <span className="pane-label">Goes to a new pad</span>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name for the new pad" placeholder={archiveNameFor(all, padId)} />
          </h3>
          {pane('left', left)}
        </section>
        <div className="arrows">
          <button type="button" onClick={() => send(pick.ids, 'right')} disabled={!canRight} aria-label="Keep the selected lines" title="Keep the selected lines (they stay in this pad)">→</button>
          <button type="button" onClick={() => send(pick.ids, 'left')} disabled={!canLeft} aria-label="Put the selected lines back" title="Put the selected lines back">←</button>
          <button type="button" className="all" onClick={() => send(left.map((r) => r.id), 'right')} disabled={left.length === 0} title="Keep everything">Keep all</button>
          <button type="button" className="all" onClick={() => setSides(NONE)} disabled={right.length === 0} title="Put everything back">Reset</button>
        </div>
        <section className="pane" aria-label="Staying">
          <h3><span className="pane-label">Stays in</span> <strong>{here}</strong> <span className="count">{right.length ? `${right.length} ${right.length === 1 ? 'line' : 'lines'}` : ''}</span></h3>
          {pane('right', right)}
        </section>
      </div>
    </section>
  )
}
