// Pointer drag for rows. Press a bullet and move (desktop), or press and hold a bullet
// then move (touch). On touch with lines selected, a quick swipe up or down the bullets
// (no hold) selects the lines it passes instead (paintSelect). The dragged set is the selection when the pressed row is selected,
// else just that row, always with its subtree. Drop resolution is core's resolveDrop over
// the rows' live boxes; this hook only measures, draws state and commits the move.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { buildIndex, countLines, descendantIds, moveNodes, resolveDrop, topmost, type DropTarget, type LayoutRow } from '@hissypad/core'
import { apply, cmdAddAt, paintSelect, select, usePad, visibleIds } from '@hissypad/state'
import { log } from '@hissypad/state'

export interface DragState {
  ids: string[]          // topmost moved rows
  count: number          // lines that will move, subtree included, blank ones not counted
  label: string
  x: number
  y: number
  target: DropTarget | null
  indicatorLeft: number  // px, relative to the rows container
  add?: boolean          // the floating + being carried to where a new line should go: nothing moves
}

const MOVE_THRESHOLD = 5
const HOLD_MS = 280
const EDGE = 48
// The floating +, as a thing being dragged. Let go this close to where it began and nothing is added.
const ADD = '\u0000add'
const ADD_CANCEL = 36

export function useDrag(rowsEl: React.RefObject<HTMLElement | null>) {
  const [drag, setDragState] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const setDrag = useCallback((next: DragState | null | ((d: DragState | null) => DragState | null)) => {
    dragRef.current = typeof next === 'function' ? next(dragRef.current) : next
    setDragState(dragRef.current)
  }, [])
  const pending = useRef<{ id: string; x: number; y: number; pointerId: number; touch: boolean; timer: number | null; paint?: string[] } | null>(null)
  // A swipe down the bullets selecting lines: where it started, the selection then, the pointer.
  const painting = useRef<{ from: string; base: string[]; pointerId: number } | null>(null)
  const live = useRef<{ ids: string[]; moving: Set<string>; indentPx: number; gutterPx: number; basePx: number; add?: { x: number; y: number } } | null>(null)
  const suppressClick = useRef(false)
  const raf = useRef<number | null>(null)

  const measure = useCallback((): LayoutRow[] => {
    const root = rowsEl.current
    if (!root) return []
    const rootTop = root.getBoundingClientRect().top
    return [...root.querySelectorAll<HTMLElement>('.row[data-id]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.id!, depth: Number(el.style.getPropertyValue('--depth') || 0), top: r.top - rootTop, height: r.height }
    })
  }, [rowsEl])

  const begin = useCallback((id: string, x: number, y: number, from?: { x: number; y: number }) => {
    const state = usePad.getState()
    const rows = state.rows
    if (id === ADD) {
      live.current = { ids: [], moving: new Set(), indentPx: 0, gutterPx: 0, basePx: 0, add: from ?? { x, y } }
      log('drag:begin', { add: true })
      setDrag({ ids: [], count: 0, label: 'New line', x, y, target: null, indicatorLeft: 0, add: true })
      document.body.classList.add('is-dragging-rows')
      return
    }
    const index = buildIndex(rows)
    const base = state.selection.includes(id) ? state.selection : [id]
    const ids = topmost(index, base)
    const moving = new Set(ids)
    for (const t of ids) for (const d of descendantIds(index, t)) moving.add(d)
    const root = rowsEl.current!
    const cs = getComputedStyle(document.documentElement)
    const rem = parseFloat(getComputedStyle(document.body).fontSize) || 16
    const indentPx = parseFloat(cs.getPropertyValue('--indent')) * rem || 24
    const gutterPx = parseFloat(cs.getPropertyValue('--gutter')) * rem || 36
    live.current = { ids, moving, indentPx, gutterPx, basePx: root.getBoundingClientRect().left + gutterPx }
    if (state.editing) usePad.setState({ editing: null })
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    const first = rows[ids[0]!]!
    log('drag:begin', { ids: ids.map((i) => i.slice(0, 8)), moving: moving.size })
    setDrag({ ids, count: countLines([...moving].map((m) => rows[m])), label: first.text || '(blank)', x, y, target: null, indicatorLeft: 0 })
    document.body.classList.add('is-dragging-rows')
  }, [rowsEl, setDrag])

  // The row whose box holds `y` (the first or last when it is above or below them all).
  const rowAt = useCallback((y: number): string | null => {
    const root = rowsEl.current
    if (!root) return null
    const els = [...root.querySelectorAll<HTMLElement>('.row[data-id]')]
    if (!els.length) return null
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (y < r.bottom) return el.dataset.id!
    }
    return els.at(-1)!.dataset.id!
  }, [rowsEl])

  const paintTo = useCallback((y: number) => {
    const p = painting.current
    if (!p) return
    const to = rowAt(y)
    if (to) paintSelect(p.base, p.from, to)
    const vh = window.innerHeight
    if (y < EDGE) window.scrollBy(0, -Math.ceil((EDGE - y) / 4))
    else if (y > vh - EDGE) window.scrollBy(0, Math.ceil((y - (vh - EDGE)) / 4))
  }, [rowAt])

  const update = useCallback((x: number, y: number) => {
    const l = live.current
    const root = rowsEl.current
    if (!l || !root) return
    const state = usePad.getState()
    const index = buildIndex(state.rows)
    const rootTop = root.getBoundingClientRect().top
    const target = resolveDrop({
      rows: state.rows,
      index,
      layout: measure(),
      moving: l.moving,
      pointerY: y - rootTop,
      // A new line lands level with the line below it (the shallowest the gap allows); a
      // moved row follows the pointer's x.
      pointerDepth: l.add ? 0 : (x - l.basePx) / l.indentPx,
    })
    const prevT = dragRef.current?.target
    if ((prevT?.placement.parentId ?? null) !== (target?.placement.parentId ?? null) || (prevT?.placement.afterId ?? null) !== (target?.placement.afterId ?? null) || prevT?.depth !== target?.depth) {
      log('drag:target', target ? { parent: target.placement.parentId?.slice(0, 8) ?? null, after: target.placement.afterId?.slice(0, 8) ?? null, depth: target.depth, gap: target.gapIndex } : null)
    }
    setDrag((d) => (d ? { ...d, x, y, target, indicatorLeft: target ? l.gutterPx + target.depth * l.indentPx : 0 } : d))
    // Autoscroll near the viewport edges.
    const vh = window.innerHeight
    if (y < EDGE) window.scrollBy(0, -Math.ceil((EDGE - y) / 4))
    else if (y > vh - EDGE) window.scrollBy(0, Math.ceil((y - (vh - EDGE)) / 4))
  }, [measure, rowsEl, setDrag])

  const finish = useCallback((commit: boolean) => {
    const l = live.current
    const p = pending.current
    if (p?.timer) window.clearTimeout(p.timer)
    pending.current = null
    live.current = null
    document.body.classList.remove('is-dragging-rows')
    if (!l) return
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 0)
    // Commit from the ref, never inside a state updater: updaters run during render.
    const last = dragRef.current
    const target = last?.target ?? null
    setDrag(null)
    log('drag:end', { commit, target: target ? { parent: target.placement.parentId?.slice(0, 8) ?? null, after: target.placement.afterId?.slice(0, 8) ?? null, depth: target.depth } : null })
    if (l.add) {
      const far = last ? Math.hypot(last.x - l.add.x, last.y - l.add.y) > ADD_CANCEL : false
      if (commit && far && target) cmdAddAt(target.placement)
      return
    }
    if (commit && target) {
      apply((rows, ctx) => moveNodes(rows, ctx, l.ids, target.placement), { label: 'drag' })
      const vis = new Set(visibleIds())
      const kept = l.ids.filter((id) => vis.has(id))
      if (kept.length) select(kept, kept[0]!, kept.at(-1)!)
    }
  }, [setDrag])

  // Window listeners only while a press or a drag is in progress.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const p = pending.current
      if (p && e.pointerId === p.pointerId) {
        const dx = e.clientX - p.x
        const dy = e.clientY - p.y
        if (Math.hypot(dx, dy) < MOVE_THRESHOLD) return
        if (p.touch && p.timer !== null) {
          // Moved before the hold finished: not a drag. With lines selected, a swipe that is
          // more up or down than sideways selects the bullets it passes; else it is a scroll.
          window.clearTimeout(p.timer)
          pending.current = null
          if (p.paint && Math.abs(dy) > Math.abs(dx)) {
            painting.current = { from: p.id, base: p.paint, pointerId: p.pointerId }
            suppressClick.current = true
            paintTo(e.clientY)
          }
          return
        }
        pending.current = null
        begin(p.id, e.clientX, e.clientY, { x: p.x, y: p.y })
      }
      if (painting.current && e.pointerId === painting.current.pointerId) {
        e.preventDefault()
        paintTo(e.clientY)
        return
      }
      if (live.current) {
        e.preventDefault()
        if (raf.current) cancelAnimationFrame(raf.current)
        const { clientX, clientY } = e
        raf.current = requestAnimationFrame(() => update(clientX, clientY))
      }
    }
    function onUp(e: PointerEvent) {
      if (painting.current && e.pointerId === painting.current.pointerId) {
        painting.current = null
        setTimeout(() => (suppressClick.current = false), 0)
      }
      if (pending.current && e.pointerId === pending.current.pointerId) {
        if (pending.current.timer) window.clearTimeout(pending.current.timer)
        pending.current = null
      }
      if (live.current) {
        // A fast press-move-release can end before the queued frame ran: resolve the drop
        // from the release point synchronously so nothing is lost.
        if (raf.current) cancelAnimationFrame(raf.current)
        raf.current = null
        update(e.clientX, e.clientY)
        finish(true)
      }
    }
    function onCancel() {
      if (painting.current) {
        painting.current = null
        suppressClick.current = false
      }
      finish(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && live.current) finish(false)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
    }
  }, [begin, update, finish, paintTo])

  // Attach to a row's bullet.
  const onBulletPointerDown = useCallback((id: string, e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const touch = e.pointerType === 'touch'
    const st = usePad.getState()
    const paint = touch && st.selection.length > 0 && !st.editing ? [...st.selection] : undefined
    const start = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch, timer: null as number | null, paint }
    if (touch) {
      start.timer = window.setTimeout(() => {
        if (pending.current !== start) return
        start.timer = null
        pending.current = null
        begin(id, start.x, start.y)
        navigator.vibrate?.(10)
      }, HOLD_MS)
    }
    pending.current = start
  }, [begin])

  // Attach to the floating +: a press that moves carries it onto the pad (no hold: the
  // button takes no scrolling, see touch-action in the CSS); one that does not is a click.
  const onAddPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return
    pending.current = { id: ADD, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch: false, timer: null }
  }, [])

  // A click right after a drag must not re-select.
  const onBulletClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [])

  return { drag, onBulletPointerDown, onBulletClickCapture, onAddPointerDown }
}
