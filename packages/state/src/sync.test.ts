import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeRemote, createMemoryStore, pad, shape, idOf, insertAt } from '@hissypad/core'
import { apply, configureLocalStore, loadPad, usePad } from './store'
import { startSync, stopSync } from './sync'
import { cmdSetText } from './commands'

async function flush(n = 30) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('sync wiring', () => {
  beforeEach(() => {
    stopSync()
    usePad.setState({ rows: {}, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [], session: null, sync: null })
  })

  it('pushes local edits and merges remote rows into the store', async () => {
    const remote = createFakeRemote()
    configureLocalStore(createMemoryStore(Object.values(pad('mine'))))
    await loadPad()
    startSync(remote)
    await flush()
    expect(remote.rows.size).toBe(0) // nothing dirty yet: rows loaded from the store are clean
    const mine = idOf(usePad.getState().rows, 'mine')
    cmdSetText(mine, 'mine, edited')
    await flush()
    // requestSync is debounced (800ms); force a sync by waiting for the timer.
    await new Promise((r) => setTimeout(r, 900))
    expect(remote.rows.get(mine)!.row.text).toBe('mine, edited')
    expect(usePad.getState().sync).toMatchObject({ state: 'idle', pending: 0 })

    // Another device writes; the fake remote nudges; the row appears here.
    const other = insertAt({}, { now: () => new Date(Date.now() + 5000).toISOString(), newId: () => 'other-1' }, { parentId: null, afterId: null }, 'theirs')
    await remote.push(Object.values(other.rows))
    await new Promise((r) => setTimeout(r, 900))
    expect(shape(usePad.getState().rows)).toContain('theirs')
    stopSync()
  })

  it('drops a selection or editing line that a remote tombstone removed', async () => {
    const remote = createFakeRemote()
    configureLocalStore(createMemoryStore(Object.values(pad('a\nb'))))
    await loadPad()
    const a = idOf(usePad.getState().rows, 'a')
    usePad.setState({ selection: [a], anchorId: a, focusId: a })
    const row = usePad.getState().rows[a]!
    // Later than the row's own stamp (the fixture clock is not the wall clock).
    const later = new Date(Date.parse(row.updatedAt) + 5000).toISOString()
    await remote.push([{ ...row, deletedAt: later, updatedAt: later }])
    startSync(remote)
    await new Promise((r) => setTimeout(r, 50))
    expect(shape(usePad.getState().rows)).toBe('b')
    expect(usePad.getState().selection).toEqual([])
    stopSync()
  })

  it('drops the untouched welcome sample when a real pad arrives, keeps edited lines', async () => {
    const remote = createFakeRemote()
    configureLocalStore(createMemoryStore())
    await loadPad() // seeds the sample
    const before = usePad.getState().rows
    const edited = idOf(before, 'Oat milk')
    cmdSetText(edited, 'Oat milk, the barista one')
    // The account already has a pad on the server.
    const theirs = insertAt({}, { now: () => new Date(Date.now() + 5000).toISOString(), newId: () => 'theirs-1' }, { parentId: null, afterId: null }, 'My real pad')
    await remote.push(Object.values(theirs.rows))
    startSync(remote)
    await new Promise((r) => setTimeout(r, 80))
    const s = shape(usePad.getState().rows)
    expect(s).toContain('My real pad')
    expect(s).toContain('Oat milk, the barista one')
    expect(s).not.toContain('Welcome to HissyPad')
    expect(s).not.toContain('Kitchen towels')
    stopSync()
  })

  it('apply still works with no engine attached', () => {
    configureLocalStore(createMemoryStore())
    expect(() => apply((rows, ctx) => insertAt(rows, ctx, { parentId: null, afterId: null }, 'x').rows)).not.toThrow()
  })
})
