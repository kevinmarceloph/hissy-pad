import { useEffect, useRef, useState, type FormEvent } from 'react'
import { usePad } from './store'
import { supabase } from './supabase'
import { requestSync, syncEnabled } from './sync'

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// The footer line: where the data lives right now, and the way in or out of syncing.
export function Account() {
  const session = usePad((s) => s.session)
  const sync = usePad((s) => s.sync)
  const dialog = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  if (!syncEnabled) return <span>Saved in this browser only.</span>

  async function sendLink(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
    setBusy(false)
    setNote(error ? error.message : `Link sent to ${email}. Open it on this device.`)
  }

  async function google() {
    if (!supabase) return
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (error) setNote(error.message)
  }

  async function signOut() {
    await supabase?.auth.signOut()
  }

  if (!session) {
    return (
      <>
        <span>Saved in this browser. </span>
        <button type="button" className="link" onClick={() => dialog.current?.showModal()}>Sign in to sync across devices</button>
        <dialog ref={dialog} className="import" aria-labelledby="signin-title" onClose={() => setNote(null)}>
          <form onSubmit={sendLink}>
            <h2 id="signin-title">Sign in</h2>
            <p>Your lines stay in this browser either way. Signing in copies them to your account and keeps every device the same.</p>
            <label className="field">
              <span>Email for a magic link</span>
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            {note && <p role="status">{note}</p>}
            <div className="actions">
              <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
              <button type="button" onClick={google}>Continue with Google</button>
              <button type="submit" className="primary" disabled={busy || !email}>Send link</button>
            </div>
          </form>
        </dialog>
      </>
    )
  }

  let line: string
  if (!online) line = sync && sync.pending > 0 ? `Offline. ${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'} waiting.` : 'Offline. Changes will sync when you are back.'
  else if (!sync || sync.state === 'syncing') line = 'Syncing…'
  else if (sync.state === 'error') line = `Sync failed: ${sync.error ?? 'unknown error'}.`
  else if (sync.pending > 0) line = `${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'} waiting.`
  else line = sync.lastSyncAt ? `Synced ${timeOf(sync.lastSyncAt)}.` : 'Synced.'

  return (
    <span className="account">
      <span aria-live="polite">{line}</span>
      {sync?.state === 'error' && <button type="button" className="link" onClick={requestSync}>Retry</button>}
      <span className="who">{session.user.email}</span>
      <button type="button" className="link" onClick={signOut}>Sign out</button>
    </span>
  )
}
