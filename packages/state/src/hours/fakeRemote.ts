// An in-memory stand-in for the four Supabase tables with the same rules as the
// migrations: last write wins on updatedAt, synced_at stamped by the server, realtime
// nudges. Used by the engine tests and the screen tests.
import type { Category } from '@hissypad/core/hours';
import type { Entry } from '@hissypad/core/hours';
import type { Flag } from '@hissypad/core/hours';
import type { RecurringPlan } from '@hissypad/core/hours';

import type { Pulled, Remote, RemoteTable } from './engine';

type Stored<Row> = Map<string, Pulled<Row>>;

export interface FakeRemote extends Remote {
  entryRows: Stored<Entry>;
  categoryRows: Stored<Category>;
  flagRows: Stored<Flag>;
  recurringRows: Stored<RecurringPlan>;
  pushes: number;
  failNextPush(error: Error): void;
  // The next push waits until the returned function is called.
  holdNextPush(): () => void;
}

export function createFakeRemote(): FakeRemote {
  const listeners = new Set<() => void>();
  let seq = 0;
  let fail: Error | null = null;
  let hold: Promise<void> | null = null;
  const stamp = () => new Date(1_800_000_000_000 + ++seq * 1000).toISOString();

  function table<Row extends { updatedAt: number }>(rows: Stored<Row>, keyOf: (row: Row) => string): RemoteTable<Row> {
    return {
      async push(list) {
        remote.pushes += 1;
        if (fail) {
          const error = fail;
          fail = null;
          throw error;
        }
        if (hold) {
          const waiting = hold;
          hold = null;
          await waiting;
        }
        let changed = false;
        for (const row of list) {
          const current = rows.get(keyOf(row));
          if (current && row.updatedAt <= current.row.updatedAt) continue;
          rows.set(keyOf(row), { row: { ...row }, syncedAt: stamp() });
          changed = true;
        }
        if (changed) for (const nudge of listeners) nudge();
      },
      async pull(since, limit) {
        return [...rows.values()]
          .filter((p) => since === null || p.syncedAt > since)
          .sort((a, b) => (a.syncedAt < b.syncedAt ? -1 : 1))
          .slice(0, limit)
          .map((p) => ({ row: { ...p.row }, syncedAt: p.syncedAt }));
      },
    };
  }

  const entryRows: Stored<Entry> = new Map();
  const categoryRows: Stored<Category> = new Map();
  const flagRows: Stored<Flag> = new Map();
  const recurringRows: Stored<RecurringPlan> = new Map();

  const remote: FakeRemote = {
    entryRows,
    categoryRows,
    flagRows,
    recurringRows,
    pushes: 0,
    entries: table(entryRows, (e) => `${e.day}T${e.hour}`),
    categories: table(categoryRows, (c) => c.id),
    flags: table(flagRows, (f) => f.id),
    recurring: table(recurringRows, (p) => p.id),
    failNextPush(error) {
      fail = error;
    },
    holdNextPush() {
      let release!: () => void;
      hold = new Promise<void>((resolve) => (release = resolve));
      return release;
    },
    subscribe(nudge) {
      listeners.add(nudge);
      return () => listeners.delete(nudge);
    },
  };
  return remote;
}
