// The Remote interface over PostgREST + Realtime. Row mapping lives in core (wire.ts).
import type { SupabaseClient } from '@supabase/supabase-js'
import { fromWire, toWire, type NodeRow, type PulledRow, type Remote, type WireNode } from '@hissypad/core'

export function createSupabaseRemote(client: SupabaseClient, userId: string): Remote {
  return {
    async push(rows: readonly NodeRow[]) {
      const { error } = await client.from('nodes').upsert(rows.map(toWire), { onConflict: 'id' })
      if (error) throw new Error(error.message)
    },
    async pull(since, limit): Promise<PulledRow[]> {
      let q = client.from('nodes').select('*').order('synced_at', { ascending: true }).limit(limit)
      if (since !== null) q = q.gt('synced_at', since)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data as WireNode[]).map((w) => {
        const { row, syncedAt } = fromWire(w)
        return { row, syncedAt: new Date(syncedAt).toISOString() }
      })
    },
    subscribe(nudge) {
      const channel = client
        .channel(`nodes:${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'nodes', filter: `user_id=eq.${userId}` }, () => nudge())
        .subscribe()
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}
