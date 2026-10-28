// Pointer drag for rows. Press a bullet and move (desktop), or press and hold a bullet
// then move (touch). The dragged set is the selection when the pressed row is selected,
// else just that row, always with its subtree. Drop resolution is core's resolveDrop over
// the rows' live boxes; this hook only measures, draws state and commits the move.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { buildIndex, descendantIds, moveNodes, resolveDrop, topmost, type DropTarget, type LayoutRow } from '@hissypad/core'
import { apply, select, usePad, visibleIds } from '@hissypad/state'
import { log } from '@hissypad/state'

export interface DragState {
  ids: string[]          // topmost moved rows
  count: number          // rows that will move, subtree included
  label: string
  x: number
  y: number
  target: DropTarget | null
  indicatorLeft: number  // px, relative to the rows container
}

const MOVE_THRESHOLD = 5
const HOLD_MS = 280
const EDGE = 48

export function useDrag(rowsEl: React.RefObject<HTMLElement | null>) {
  const [drag, setDragState] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const setDrag = useCallback((next: DragState | null | ((d: DragState | null) => DragState | null)) => {
    dragRef.current = typeof next === 'function' ? next(dragRef.current) : next
    setDragState(dragRef.current)
  }, [])
  const pending = useRef<{ id: string; x: number; y: number; pointerId: number; touch: boolean; timer: number | null } | null>(null)
  const live = useRef<{ ids: string[]; moving: Set<string>; indentPx: number; gutterPx: number; basePx: number } | null>(null)
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

  const begin = useCallback((id: string, x: number, y: number) => {
    const state = usePad.getState()
    const rows = state.rows
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
    setDrag({ ids, count: moving.size, label: first.text || '(blank)', x, y, target: null, indicatorLeft: 0 })
    document.body.classList.add('is-dragging-rows')
  }, [rowsEl, setDrag])

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
      pointerDepth: (x - l.basePx) / l.indentPx,
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
    const target = dragRef.current?.target ?? null
    setDrag(null)
    log('drag:end', { commit, target: target ? { parent: target.placement.parentId?.slice(0, 8) ?? null, after: target.placement.afterId?.slice(0, 8) ?? null, depth: target.depth } : null })
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
          // Moved before the hold finished: this is a scroll, not a drag.
          window.clearTimeout(p.timer)
          pending.current = null
          return
        }
        pending.current = null
        begin(p.id, e.clientX, e.clientY)
      }
      if (live.current) {
        e.preventDefault()
        if (raf.current) cancelAnimationFrame(raf.current)
        const { clientX, clientY } = e
        raf.current = requestAnimationFrame(() => update(clientX, clientY))
      }
    }
    function onUp(e: PointerEvent) {
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
  }, [begin, update, finish])

  // Attach to a row's bullet.
  const onBulletPointerDown = useCallback((id: string, e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const touch = e.pointerType === 'touch'
    const start = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch, timer: null as number | null }
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

  // A click right after a drag must not re-select.
  const onBulletClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [])

  return { drag, onBulletPointerDown, onBulletClickCapture }
}
