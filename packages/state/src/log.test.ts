import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearLog, dumpLog, initLog, log, logEnabled, rowBrief, setLogEnabled } from './log'

function memory(initial: string | null = null) {
  let v = initial
  return { get: () => v, set: (x: string | null) => { v = x } }
}

describe('debug log', () => {
  afterEach(() => {
    setLogEnabled(false)
    clearLog()
    vi.restoreAllMocks()
  })

  it('is off until asked for, and the choice sticks in the store it is given', () => {
    const store = memory()
    expect(initLog(store)).toBe(false)
    log('ignored')
    expect(dumpLog()).toBe('')
    expect(initLog(store, '1')).toBe(true)
    expect(store.get()).toBe('1')
    expect(initLog(memory('1'))).toBe(true)
    expect(initLog(store, '0')).toBe(false)
    expect(store.get()).toBeNull()
    expect(logEnabled()).toBe(false)
  })

  it('records entries with a time, the kind and the data, and clears', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    initLog(memory('1'))
    log('op:test', { n: 1 })
    log('bare')
    const circular: { self?: unknown } = {}
    circular.self = circular
    log('odd', circular)
    const lines = dumpLog().split('\n')
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} op:test \{"n":1\}$/)
    expect(lines[1]).toMatch(/ bare$/)
    expect(lines[2]).toContain('[object Object]')
    expect((globalThis as { hissypad?: { log(): string } }).hissypad!.log()).toBe(dumpLog())
    clearLog()
    expect(dumpLog()).toBe('')
  })

  it('a store that throws leaves the log off instead of breaking the app', () => {
    const broken = { get: () => { throw new Error('no storage') }, set: () => { throw new Error('no storage') } }
    expect(initLog(broken)).toBe(false)
    setLogEnabled(true) // the failed write is swallowed
    expect(logEnabled()).toBe(true)
  })

  it('rowBrief keeps a row short and shows only the flags that are on', () => {
    expect(rowBrief(undefined)).toBeNull()
    const base = { id: 'abcdefgh-1234', parentId: null, rank: 'a0', text: 'x'.repeat(30), done: false, collapsed: false, numbered: false, deletedAt: null }
    expect(rowBrief(base)).toEqual({ id: 'abcdefgh', p: null, rank: 'a0', text: 'x'.repeat(24) + '…' })
    expect(rowBrief({ ...base, text: 'hi', parentId: 'parent-000-111', done: true, collapsed: true, numbered: true, header: true, pad: true, deletedAt: 't' }))
      .toEqual({ id: 'abcdefgh', p: 'parent-0', rank: 'a0', text: 'hi', done: true, collapsed: true, numbered: true, header: true, pad: true, deleted: true })
  })
})
