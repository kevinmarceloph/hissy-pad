// Debug log: a ring buffer of what the app did, for chasing undo and drag bugs. Off by
// default. Turn on with ?debug=1 (sticks in localStorage) or localStorage.setItem(
// 'hissypad.debug', '1'); off with ?debug=0. When on, entries also go to console.debug,
// the top bar shows a Log button, and window.hissypad.log() returns the text.
export interface LogEntry {
  t: string
  kind: string
  data?: unknown
}

const LIMIT = 1000
const entries: LogEntry[] = []
let enabled = false

export interface LogPersist {
  get(): string | null
  set(v: string | null): void
}

let persist: LogPersist = { get: () => null, set: () => {} }

// `flag` is the platform's one-shot request ('1' / '0', e.g. from ?debug=), `store` keeps
// the choice across launches (localStorage on web, AsyncStorage on mobile).
export function initLog(store: LogPersist, flag: string | null = null) {
  persist = store
  try {
    if (flag === '1') store.set('1')
    if (flag === '0') store.set(null)
    enabled = store.get() === '1'
  } catch {
    enabled = false
  }
  ;(globalThis as { hissypad?: unknown }).hissypad = { log: dumpLog, entries, enable: setLogEnabled }
  return enabled
}

export function logEnabled() {
  return enabled
}

export function setLogEnabled(v: boolean) {
  enabled = v
  try {
    persist.set(v ? '1' : null)
  } catch { /* per-device */ }
}

export function log(kind: string, data?: unknown) {
  if (!enabled) return
  const e: LogEntry = { t: new Date().toISOString(), kind, data }
  entries.push(e)
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT)
  console.log(`[pad] ${kind}`, data === undefined ? '' : safe(data))
}

export function dumpLog(): string {
  return entries
    .map((e) => `${e.t.slice(11, 23)} ${e.kind}${e.data === undefined ? '' : ' ' + safe(e.data)}`)
    .join('\n')
}

export function clearLog() {
  entries.length = 0
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

// A compact view of a row for the log: enough to see what changed, short enough to read.
export function rowBrief(r: { id: string; parentId: string | null; rank: string; text: string; done: boolean; collapsed: boolean; numbered: boolean; header?: boolean; deletedAt: string | null } | undefined) {
  if (!r) return null
  return {
    id: r.id.slice(0, 8),
    p: r.parentId?.slice(0, 8) ?? null,
    rank: r.rank,
    text: r.text.length > 24 ? r.text.slice(0, 24) + '…' : r.text,
    ...(r.done ? { done: true } : {}),
    ...(r.collapsed ? { collapsed: true } : {}),
    ...(r.numbered ? { numbered: true } : {}),
    ...(r.header ? { header: true } : {}),
    ...(r.deletedAt ? { deleted: true } : {}),
  }
}
