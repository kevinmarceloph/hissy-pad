import { describe, expect, it } from 'vitest'
import { fromWire, toWire } from './wire'
import { ROW_KEYS, normalizeRow, sameRow } from '../types'

const row = normalizeRow({
  id: 'r1', parentId: 'p1', rank: 'a5', text: 'hello', done: true, doneAt: '2026-11-01T00:00:01.000Z', collapsed: true,
  numbered: false, header: true, pad: false, updatedAt: '2026-11-01T00:00:02.000Z', deletedAt: '2026-11-01T00:00:03.000Z',
})

describe('wire format', () => {
  it('a row survives the trip to snake_case and back, every column', () => {
    const back = fromWire({ ...toWire(row), synced_at: '2026-11-01T00:00:09.000Z' })
    expect(back.row).toEqual(row)
    expect(sameRow(back.row, row)).toBe(true)
    expect(back.syncedAt).toBe('2026-11-01T00:00:09.000Z')
    expect(Object.keys(back.row).sort()).toEqual([...ROW_KEYS].sort())
  })
  it('timestamps come back as ISO strings whatever offset the server wrote', () => {
    const w = { ...toWire(row), updated_at: '2026-11-01T08:00:02+08:00', deleted_at: null, done_at: '2026-11-01T08:00:01+08:00' }
    const { row: r, syncedAt } = fromWire(w)
    expect(r.updatedAt).toBe('2026-11-01T00:00:02.000Z')
    expect(r.doneAt).toBe('2026-11-01T00:00:01.000Z')
    expect(r.deletedAt).toBeNull()
    expect(syncedAt).toBe('')
  })
  it('rows from before a column existed read as the column\'s default', () => {
    const old = { id: 'o', parent_id: null, rank: 'a0', text: 't', done: true, collapsed: false, numbered: true, updated_at: '2026-10-01T00:00:00Z', deleted_at: null }
    const r = fromWire(old).row
    expect(r).toMatchObject({ header: false, pad: false, doneAt: null, numbered: true })
    // A header that is also numbered (two devices disagreeing) reads as numbered.
    expect(fromWire({ ...old, header: true }).row.header).toBe(false)
  })
  it('sameRow notices a difference in any one column', () => {
    for (const k of ROW_KEYS) expect(sameRow(row, { ...row, [k]: 'different' })).toBe(false)
    expect(sameRow(row, { ...row })).toBe(true)
  })
})
