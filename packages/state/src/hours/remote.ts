// The Remote interface over PostgREST and Realtime. The snake_case row shapes of the hours
// tables (supabase/migrations) live here and nowhere else.
import type { SupabaseClient } from '@supabase/supabase-js';

import { cleanIcon, isColorKey, type Category, type Setting } from '@hissypad/core/hours';
import { withState, type Entry } from '@hissypad/core/hours';
import { cleanFlagIds, cleanOptions, type Flag, type FlagOption } from '@hissypad/core/hours';
import { cleanDays, cleanHour, type RecurringPlan } from '@hissypad/core/hours';

import type { Pulled, Remote } from './engine';

type WireEntry = {
  day: string;
  hour: number;
  note: string;
  category: string | null;
  // Absent on a row read from a server that has not run the plan-and-flags migration.
  flags?: string[] | null;
  // Absent on a row read from a server that has not run the hour-state migration.
  state?: string | null;
  updated_at: number;
  synced_at?: string;
};

type WireFlag = {
  id: string;
  label: string;
  // Absent on a row read from a server that has not run the flag-icons migration.
  icon?: string | null;
  // Absent on a row read from a server that has not run the flag-options migration.
  options?: FlagOption[] | null;
  position: number;
  archived: boolean;
  updated_at: number;
  synced_at?: string;
};

type WireRecurring = {
  id: string;
  note: string;
  category: string | null;
  from_hour: number;
  to_hour: number;
  days: number[];
  since: string;
  position: number;
  archived: boolean;
  updated_at: number;
  synced_at?: string;
};

type WireSetting = {
  key: string;
  value: string;
  updated_at: number;
  synced_at?: string;
};

export const settingToWire = (r: Setting): WireSetting => ({ key: r.key, value: r.value, updated_at: r.updatedAt });

export const settingFromWire = (w: WireSetting): Pulled<Setting> => ({
  row: { key: w.key, value: w.value, updatedAt: Number(w.updated_at) },
  syncedAt: new Date(w.synced_at ?? 0).toISOString(),
});

type WireCategory = {
  id: string;
  label: string;
  // Absent on a row read from a server that has not run the category-icons migration.
  icon?: string | null;
  color: string;
  position: number;
  archived: boolean;
  updated_at: number;
  synced_at?: string;
};

export const entryToWire = (e: Entry): WireEntry => ({
  day: e.day,
  hour: e.hour,
  note: e.note,
  category: e.category,
  flags: e.flags,
  state: e.state,
  updated_at: e.updatedAt,
});

export const entryFromWire = (w: WireEntry): Pulled<Entry> => ({
  row: withState({
    day: w.day,
    hour: w.hour,
    note: w.note,
    category: w.category,
    flags: cleanFlagIds(Array.isArray(w.flags) ? w.flags : []),
    state: w.state,
    updatedAt: Number(w.updated_at),
  }),
  syncedAt: new Date(w.synced_at ?? 0).toISOString(),
});

export const categoryToWire = (c: Category): WireCategory => ({
  id: c.id,
  label: c.label,
  icon: c.icon,
  color: c.color,
  position: c.position,
  archived: c.archived,
  updated_at: c.updatedAt,
});

export const categoryFromWire = (w: WireCategory): Pulled<Category> => ({
  row: {
    id: w.id,
    label: w.label,
    icon: cleanIcon(w.icon ?? ''),
    // A color key this build does not know (written by a newer one) reads as stone.
    color: isColorKey(w.color) ? w.color : 'stone',
    position: w.position,
    archived: w.archived,
    updatedAt: Number(w.updated_at),
  },
  syncedAt: new Date(w.synced_at ?? 0).toISOString(),
});

export const flagToWire = (f: Flag): WireFlag => ({
  id: f.id,
  label: f.label,
  icon: f.icon,
  options: f.options,
  position: f.position,
  archived: f.archived,
  updated_at: f.updatedAt,
});

export const flagFromWire = (w: WireFlag): Pulled<Flag> => ({
  row: {
    id: w.id,
    label: w.label,
    icon: w.icon ?? '',
    options: cleanOptions(w.options),
    position: w.position,
    archived: w.archived,
    updatedAt: Number(w.updated_at),
  },
  syncedAt: new Date(w.synced_at ?? 0).toISOString(),
});

export const recurringToWire = (p: RecurringPlan): WireRecurring => ({
  id: p.id,
  note: p.note,
  category: p.category,
  from_hour: p.from,
  to_hour: p.to,
  days: p.days,
  since: p.since,
  position: p.position,
  archived: p.archived,
  updated_at: p.updatedAt,
});

export const recurringFromWire = (w: WireRecurring): Pulled<RecurringPlan> => ({
  row: {
    id: w.id,
    note: w.note,
    category: w.category,
    from: cleanHour(w.from_hour, 0),
    to: cleanHour(w.to_hour, 0),
    days: cleanDays(w.days),
    since: w.since,
    position: w.position,
    archived: w.archived,
    updatedAt: Number(w.updated_at),
  },
  syncedAt: new Date(w.synced_at ?? 0).toISOString(),
});

export function createSupabaseRemote(client: SupabaseClient, userId: string): Remote {
  async function pull<Wire>(table: string, since: string | null, limit: number): Promise<Wire[]> {
    let query = client.from(table).select('*').order('synced_at', { ascending: true }).limit(limit);
    if (since !== null) query = query.gt('synced_at', since);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data as Wire[];
  }

  return {
    settings: {
      async push(rows) {
        const { error } = await client.from('hour_settings').upsert(rows.map(settingToWire), { onConflict: 'user_id,key' });
        if (error) throw new Error(error.message);
      },
      pull: async (since, limit) => (await pull<WireSetting>('hour_settings', since, limit)).map(settingFromWire),
    },
    entries: {
      async push(rows) {
        // user_id is filled in by the table's default (auth.uid()).
        const { error } = await client.from('hour_entries').upsert(rows.map(entryToWire), { onConflict: 'user_id,day,hour' });
        if (error) throw new Error(error.message);
      },
      pull: async (since, limit) => (await pull<WireEntry>('hour_entries', since, limit)).map(entryFromWire),
    },
    categories: {
      async push(rows) {
        const { error } = await client.from('hour_categories').upsert(rows.map(categoryToWire), { onConflict: 'user_id,id' });
        if (error) throw new Error(error.message);
      },
      pull: async (since, limit) => (await pull<WireCategory>('hour_categories', since, limit)).map(categoryFromWire),
    },
    flags: {
      async push(rows) {
        const { error } = await client.from('hour_flags').upsert(rows.map(flagToWire), { onConflict: 'user_id,id' });
        if (error) throw new Error(error.message);
      },
      pull: async (since, limit) => (await pull<WireFlag>('hour_flags', since, limit)).map(flagFromWire),
    },
    recurring: {
      async push(rows) {
        const { error } = await client.from('recurring_plans').upsert(rows.map(recurringToWire), { onConflict: 'user_id,id' });
        if (error) throw new Error(error.message);
      },
      pull: async (since, limit) => (await pull<WireRecurring>('recurring_plans', since, limit)).map(recurringFromWire),
    },
    subscribe(nudge) {
      const mine = { event: '*', schema: 'public', filter: `user_id=eq.${userId}` } as const;
      const channel = client
        .channel(`hours:${userId}`)
        .on('postgres_changes', { ...mine, table: 'hour_entries' }, () => nudge())
        .on('postgres_changes', { ...mine, table: 'hour_categories' }, () => nudge())
        .on('postgres_changes', { ...mine, table: 'hour_flags' }, () => nudge())
        .on('postgres_changes', { ...mine, table: 'recurring_plans' }, () => nudge())
        .on('postgres_changes', { ...mine, table: 'hour_settings' }, () => nudge())
        .subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
