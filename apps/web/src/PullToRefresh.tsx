// Pull down at the top of the page on a phone to sync now. Touch only: the browser's own
// pull-to-refresh (Chrome on Android) is turned off in CSS so the page is not reloaded
// instead. A pull that starts in a text field, on a bullet (the drag handle) or inside a
// dialog is left to that control.
import { useEffect, useRef, useState } from 'react'
import { refresh, usePad } from '@hissypad/state'

export const PULL_THRESHOLD = 64 // px of travel (after damping) that counts as a pull
const PULL_MAX = 96
const DAMPING = 0.5
const MIN_SPIN_MS = 500 // so a fast sync still visibly happened
const SETTLE_MS = 1200 // how long the result line stays

type Phase = 'idle' | 'pulling' | 'armed' | 'syncing' | 'done' | 'failed'

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function PullToRefresh() {
  const session = usePad((s) => s.session)
  const [phase, setPhase] = useState<Phase>('idle')
  const [offset, setOffset] = useState(0)
  const phaseRef = useRef<Phase>('idle')
  const startY = useRef<number | null>(null)
  const enabled = session !== null

  function go(p: Phase) {
    phaseRef.current = p
    setPhase(p)
  }

  useEffect(() => {
    if (!enabled) return
    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1 || !atTop()) return
      const p = phaseRef.current
      if (p === 'syncing' || p === 'done' || p === 'failed') return
      const t = e.target as Element | null
      if (t?.closest?.('textarea, input, select, .bullet, dialog')) return
      startY.current = e.touches[0]!.clientY
    }

    function onMove(e: TouchEvent) {
      if (startY.current === null) return
      const dy = e.touches[0]!.clientY - startY.current
      if (dy <= 0 || !atTop()) {
        // Scrolled down, or moved up again: not a pull.
        if (phaseRef.current === 'pulling' || phaseRef.current === 'armed') {
          go('idle')
          setOffset(0)
        }
        if (dy <= 0) startY.current = null
        return
      }
      const travel = Math.min(dy * DAMPING, PULL_MAX)
      setOffset(travel)
      go(travel >= PULL_THRESHOLD ? 'armed' : 'pulling')
    }

    async function onEnd() {
      if (startY.current === null) return
      startY.current = null
      if (phaseRef.current !== 'armed') {
        go('idle')
        setOffset(0)
        return
      }
      go('syncing')
      setOffset(PULL_THRESHOLD)
      await Promise.all([refresh(), wait(MIN_SPIN_MS)])
      go(usePad.getState().sync?.state === 'error' ? 'failed' : 'done')
      await wait(SETTLE_MS)
      go('idle')
      setOffset(0)
    }

    const opts: AddEventListenerOptions = { passive: true }
    document.addEventListener('touchstart', onStart, opts)
    document.addEventListener('touchmove', onMove, opts)
    document.addEventListener('touchend', onEnd, opts)
    document.addEventListener('touchcancel', onEnd, opts)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled])

  if (!enabled || phase === 'idle') return null
  const label =
    phase === 'pulling' ? 'Pull to sync' :
    phase === 'armed' ? 'Release to sync' :
    phase === 'syncing' ? 'Syncing…' :
    phase === 'done' ? 'Synced' : 'Sync failed'
  const settled = phase === 'done' || phase === 'failed' || phase === 'syncing'
  return (
    <div
      className={`pull ${settled ? 'is-settled' : ''}`}
      style={{ transform: `translate(-50%, ${offset - PULL_THRESHOLD}px)` }}
      role="status"
      aria-live="polite"
      data-phase={phase}
    >
      {label}
    </div>
  )
}
