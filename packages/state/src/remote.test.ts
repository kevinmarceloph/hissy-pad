import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeRow, toWire } from '@hissypad/core'
import { createSupabaseRemote } from './remote'

// A stand-in for the Supabase client that records the query it was asked to build.
function fakeClient(result: { data?: unknown; error?: { message: string } | null }) {
  const calls: unknown[][] = []
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'limit', 'gt']) q[m] = (...a: unknown[]) => { calls.push([m, ...a]); return q }
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(ok)
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) }
  const client = {
    from: (table: string) => {
      calls.push(['from', table])
      return { ...q, upsert: (rows: unknown, opts: unknown) => { calls.push(['upsert', rows, opts]); return Promise.resolve({ error: result.error ?? null }) } }
    },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => {}),
  }
  return { client: client as unknown as SupabaseClient, calls, channel, raw: client }
}

const row = normalizeRow({ id: 'r1', text: 'hello', updatedAt: '2026-11-01T00:00:00.000Z' })

describe('the Supabase remote', () => {
  it('pushes rows in wire form, upserting on id, and throws what the server says', async () => {
    const ok = fakeClient({})
    await createSupabaseRemote(ok.client, 'u1').push([row])
    expect(ok.calls).toEqual([['from', 'nodes'], ['upsert', [toWire(row)], { onConflict: 'id' }]])
    const bad = fakeClient({ error: { message: 'denied' } })
    await expect(createSupabaseRemote(bad.client, 'u1').push([row])).rejects.toThrow('denied')
  })

  it('pulls in synced_at order, after the cursor when there is one, and maps rows back', async () => {
    const wire = { ...toWire(row), synced_at: '2026-11-01T00:00:05+00:00' }
    const first = fakeClient({ data: [wire] })
    const got = await createSupabaseRemote(first.client, 'u1').pull(null, 50)
    expect(got).toEqual([{ row, syncedAt: '2026-11-01T00:00:05.000Z' }])
    expect(first.calls.map((c) => c[0])).toEqual(['from', 'select', 'order', 'limit'])
    const next = fakeClient({ data: [] })
    await createSupabaseRemote(next.client, 'u1').pull('2026-11-01T00:00:05.000Z', 50)
    expect(next.calls.at(-1)).toEqual(['gt', 'synced_at', '2026-11-01T00:00:05.000Z'])
    const bad = fakeClient({ error: { message: 'offline' } })
    await expect(createSupabaseRemote(bad.client, 'u1').pull(null, 50)).rejects.toThrow('offline')
  })

  it('subscribes to this user\'s rows and nudges on any change; unsubscribing removes the channel', () => {
    const f = fakeClient({})
    const nudge = vi.fn()
    const stop = createSupabaseRemote(f.client, 'u1').subscribe!(nudge)
    expect(f.raw.channel).toHaveBeenCalledWith('nodes:u1')
    const [event, filter, handler] = f.channel.on.mock.calls[0] as unknown as [string, { filter: string; table: string }, () => void]
    expect(event).toBe('postgres_changes')
    expect(filter).toMatchObject({ table: 'nodes', filter: 'user_id=eq.u1' })
    handler()
    expect(nudge).toHaveBeenCalledTimes(1)
    stop()
    expect(f.raw.removeChannel).toHaveBeenCalledWith(f.channel)
  })
})
