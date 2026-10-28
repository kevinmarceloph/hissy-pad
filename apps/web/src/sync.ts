// Wires the core sync engine to the Zustand store and Supabase auth. Local-only until a
// session exists; then every local change, realtime event, reconnect or tab focus asks the
// engine to sync.
import type { Session } from '@supabase/supabase-js'
import { createSyncEngine, type NodeRow, type Remote, type SyncEngine, type SyncStatus } from '@hissypad/core'
import { supabase } from './supabase'
import { createSupabaseRemote } from './remote'
import { clock, getLocalStore, setOnLocalChange, usePad } from './store'

let engine: SyncEngine | null = null
let detachWindow: (() => void) | null = null

export const syncEnabled = supabase !== null

function mergeRemote(incoming: readonly NodeRow[]) {
  usePad.setState((s) => {
    const rows: Record<string, NodeRow> = { ...s.rows }
    for (const r of incoming) {
      const cur = rows[r.id]
      if (!cur || r.updatedAt > cur.updatedAt) rows[r.id] = r
    }
    // Keep the selection and the editing line only if they still exist.
    const live = (id: string) => rows[id]?.deletedAt === null
    const selection = s.selection.filter(live)
    return {
      rows,
      selection,
      editing: s.editing && live(s.editing.id) ? s.editing : null,
      anchorId: s.anchorId && live(s.anchorId) ? s.anchorId : null,
      focusId: s.focusId && live(s.focusId) ? s.focusId : null,
    }
  })
}

export function startSync(remote: Remote) {
  stopSync()
  engine = createSyncEngine({
    local: getLocalStore(),
    remote,
    clock,
    getRows: () => usePad.getState().rows,
    applyRemote: mergeRemote,
    onStatus: (status: SyncStatus) => usePad.setState({ sync: status }),
  })
  setOnLocalChange(() => engine?.requestSync())
  const kick = () => void engine?.sync()
  window.addEventListener('online', kick)
  window.addEventListener('focus', kick)
  const onVis = () => {
    if (document.visibilityState === 'visible') kick()
  }
  document.addEventListener('visibilitychange', onVis)
  detachWindow = () => {
    window.removeEventListener('online', kick)
    window.removeEventListener('focus', kick)
    document.removeEventListener('visibilitychange', onVis)
  }
  engine.start()
}

export function stopSync() {
  engine?.stop()
  engine = null
  detachWindow?.()
  detachWindow = null
  setOnLocalChange(null)
  usePad.setState({ sync: null })
}

export function requestSync() {
  engine?.requestSync()
}

// Follow auth: a session starts the engine for that user, sign-out stops it.
export function bindAuth() {
  if (!supabase) return
  const client = supabase
  const apply = (session: Session | null) => {
    usePad.setState({ session })
    if (session) startSync(createSupabaseRemote(client, session.user.id))
    else stopSync()
  }
  void client.auth.getSession().then(({ data }) => apply(data.session))
  client.auth.onAuthStateChange((_event, session) => {
    const cur = usePad.getState().session
    if (session?.user.id === cur?.user.id && session?.access_token === cur?.access_token) return
    apply(session)
  })
}
