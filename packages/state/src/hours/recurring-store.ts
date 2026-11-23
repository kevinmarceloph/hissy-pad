import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  newRecurring,
  newRecurringId,
  patchRecurring,
  sortRecurring,
  type RecurringFields,
  type RecurringPatch,
  type RecurringPlan,
} from '@hissypad/core/hours';
import type { RecurringStore } from '@hissypad/core/hours';

export type RecurringState = {
  status: 'loading' | 'ready' | 'error';
  // Set when a read or a write fails; the screen shows it.
  error: string | null;
  // Every recurring plan in order, archived ones included.
  list: RecurringPlan[];
  load(): Promise<void>;
  // Re-reads the list in place, with no loading state: sync calls it after rows land.
  refresh(): Promise<void>;
  add(fields: RecurringFields): Promise<void>;
  update(id: string, patch: RecurringPatch): Promise<void>;
  // Swaps places with the active neighbor above (-1) or below (1).
  move(id: string, by: -1 | 1): Promise<void>;
};

export type RecurringPlansStore = StoreApi<RecurringState>;

type Options = { clock?: () => Date; makeId?: () => string };

// The recurring plans in memory, backed by a RecurringStore. The flag store's twin: writes
// are optimistic and are put back if the store rejects them.
export function createRecurringStore(store: RecurringStore, options: Options = {}): RecurringPlansStore {
  const clock = options.clock ?? (() => new Date());
  const makeId = options.makeId ?? newRecurringId;

  return createStore<RecurringState>((set, get) => {
    const write = async (...changed: RecurringPlan[]) => {
      const before = get().list;
      const ids = new Set(changed.map((p) => p.id));
      set({ list: sortRecurring([...before.filter((p) => !ids.has(p.id)), ...changed]), error: null });
      try {
        for (const plan of changed) await store.putRecurring(plan);
      } catch (cause) {
        set({ list: before, error: message(cause) });
      }
    };

    return {
      status: 'loading',
      error: null,
      list: [],

      async load() {
        set({ status: 'loading', error: null });
        try {
          set({ status: 'ready', list: sortRecurring(await store.listRecurring()) });
        } catch (cause) {
          set({ status: 'error', error: message(cause) });
        }
      },

      async refresh() {
        if (get().status !== 'ready') return;
        try {
          set({ list: sortRecurring(await store.listRecurring()) });
        } catch {
          // What is on screen stays; the next refresh tries again.
        }
      },

      async add(fields) {
        await write(newRecurring(get().list, makeId(), fields, clock()));
      },

      async update(id, patch) {
        const base = get().list.find((p) => p.id === id);
        if (base) await write(patchRecurring(base, patch, clock().getTime()));
      },

      async move(id, by) {
        const active = get().list.filter((p) => !p.archived);
        const from = active.findIndex((p) => p.id === id);
        const other = active[from + by];
        if (from < 0 || !other) return;
        const now = clock().getTime();
        const self = active[from]!;
        // A tie can arrive from another device; nudging by one keeps the swap visible.
        const tie = self.position === other.position;
        await write(
          patchRecurring(self, { position: tie ? other.position + by : other.position }, now),
          patchRecurring(other, { position: self.position }, now),
        );
      },
    };
  });
}

// A list that is always empty and keeps nothing: for a screen shown without recurring plans
// (tests of the other screens).
export function createStaticRecurringStore(): RecurringPlansStore {
  const store = createRecurringStore({ listRecurring: async () => [], putRecurring: async () => {} });
  store.setState({ status: 'ready' });
  return store;
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
