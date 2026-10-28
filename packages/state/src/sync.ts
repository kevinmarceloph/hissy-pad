// Wires the core sync engine to the Zustand store and Supabase auth. Local-only until a
// session exists; then every local change, realtime event, reconnect or tab focus asks the
// engine to sync.
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createSyncEngine, type NodeRow, type Remote, type SyncEngine, type SyncStatus } from '@hissypad/core'
import { createSupabaseRemote } from './remote'
import { apply, clock, getLocalStore, SEED_KEY, setOnLocalChange, usePad } from './store'
import { remove } from '@hissypad/core'
import { log, rowBrief } from './log'

let engine: SyncEngine | null = null
let detachWindow: (() => void) | null = null

// Platform hook: given `kick` (sync now), attach whatever wakes the app (online, focus,
// visibility on web; AppState on mobile) and return the detach function.
export type SyncTriggers = (kick: () => void) => () => void
let triggers: SyncTriggers = () => () => {}
export function setSyncTriggers(t: SyncTriggers) {
  triggers = t
}

// A device that started with the welcome sample and then signs in to an account that
// already has a pad: the sample rows nobody touched are removed so they do not pile onto
// the real pad. Lines the person edited stay.
async function dropUntouchedSeed(incoming: readonly NodeRow[]) {
  const local = getLocalStore()
  const raw = await local.getMeta(SEED_KEY)
  if (!raw) return
  const seed = JSON.parse(raw) as Record<string, string>
  const foreign = incoming.some((r) => !(r.id in seed))
  if (!foreign) return
  const rows = usePad.getState().rows
  // An edited line keeps its ancestors too, since removing a parent removes its subtree.
  const keep = new Set<string>()
  for (const [id, at] of Object.entries(seed)) {
    const r = rows[id]
    if (!r || r.deletedAt !== null || r.updatedAt === at) continue
    let cur: string | null = id
    while (cur && !keep.has(cur)) {
      keep.add(cur)
      cur = rows[cur]?.parentId ?? null
    }
  }
  const untouched = Object.keys(seed).filter((id) => rows[id]?.deletedAt === null && !keep.has(id))
  await local.setMeta(SEED_KEY, '')
  if (untouched.length) {
    apply((r, ctx) => remove(r, ctx, untouched), { label: 'dropSeed' })
    log('seed:dropped', { n: untouched.length })
  }
}

function mergeRemote(incoming: readonly NodeRow[]) {
  log('sync:merge', { n: incoming.length, rows: incoming.slice(0, 8).map(rowBrief) })
  void dropUntouchedSeed(incoming)
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
    onStatus: (status: SyncStatus) => {
      const prev = usePad.getState().sync
      if (!prev || prev.state !== status.state || prev.pending !== status.pending || prev.error !== status.error) log('sync:status', status)
      usePad.setState({ sync: status })
    },
  })
  setOnLocalChange(() => engine?.requestSync())
  detachWindow = triggers(() => void engine?.sync())
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

// Cmd+S: nothing to "save" (every edit is already on disk), but sync right now.
export function forceSync() {
  log('sync:force')
  void engine?.sync()
}

// Follow auth: a session starts the engine for that user, sign-out stops it.
export function bindAuth(client: SupabaseClient | null) {
  if (!client) return
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
