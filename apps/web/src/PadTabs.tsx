import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { cmdDeletePad, cmdNewPad, cmdRenamePad, openPad, padList, usePad } from '@hissypad/state'
import type { PadId } from '@hissypad/core'
import { showToast } from './toast'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

type Sheet = { mode: 'new' } | { mode: 'edit'; padId: string }

// The pads as a row of tabs under the title. The main pad is always first and cannot be
// renamed or deleted; clicking the open tab of any other pad opens its name and delete.
export function PadTabs() {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const pads = useMemo(() => padList(all), [all])
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!sheet) return
    setName(sheet.mode === 'edit' ? (all[sheet.padId]?.text ?? '') : '')
    setConfirming(false)
    dialog.current?.showModal()
    input.current?.focus()
    input.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet])

  function pick(id: PadId) {
    if (id === padId) {
      if (id !== null) setSheet({ mode: 'edit', padId: id })
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
    showToast(`Deleted “${label}”${n ? ` and its ${n} ${n === 1 ? 'line' : 'lines'}` : ''}. ${isMac ? '⌘' : 'Ctrl'}+Z brings it back.`)
  }

  const lines = sheet?.mode === 'edit' ? Object.values(all).filter((r) => r.deletedAt === null && r.parentId === sheet.padId).length : 0

  return (
    <nav className="pads" aria-label="Pads">
      <div role="tablist" aria-label="Pads">
        {pads.map((p) => (
          <button
            key={p.id ?? 'main'}
            type="button"
            role="tab"
            aria-selected={p.id === padId}
            title={p.id === padId && p.id !== null ? 'Rename or delete this pad' : `Open ${p.name}`}
            onClick={() => pick(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <button type="button" className="add" aria-label="New pad" title="New pad" onClick={() => setSheet({ mode: 'new' })}>+</button>
      <dialog ref={dialog} className="import pad-sheet" aria-labelledby="pad-title" onClose={() => setSheet(null)}>
        <form onSubmit={submit}>
          <h2 id="pad-title">{sheet?.mode === 'new' ? 'New pad' : 'This pad'}</h2>
          <label className="field">
            <span>Name</span>
            <input ref={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={sheet?.mode === 'new' ? 'Work, Ideas, a trip…' : ''} aria-label="Pad name" />
          </label>
          {confirming && (
            <p role="status">Delete this pad{lines ? ` and the ${lines} ${lines === 1 ? 'line' : 'lines'} at its top level, with everything under them` : ''}? Undo brings it back.</p>
          )}
          <div className="actions">
            {sheet?.mode === 'edit' && !confirming && (
              <button type="button" className="danger" onClick={() => setConfirming(true)}>Delete pad…</button>
            )}
            {sheet?.mode === 'edit' && confirming && (
              <button type="button" className="danger" onClick={remove}>Delete</button>
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
