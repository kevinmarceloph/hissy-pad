import { createStore, type StoreApi } from 'zustand/vanilla';

import { activeFlags, newFlag, newFlagId, patchFlag, sortFlags, type Flag, type FlagPatch } from '@hissypad/core/hours';
import type { FlagStore } from '@hissypad/core/hours';

export type FlagState = {
  status: 'loading' | 'ready' | 'error';
  // Set when a read or a write fails; the screen shows it.
  error: string | null;
  // Every flag in order, archived ones included.
  list: Flag[];
  load(): Promise<void>;
  // Re-reads the list in place, with no loading state: sync calls it after rows land.
  refresh(): Promise<void>;
  add(label: string, icon: string): Promise<void>;
  update(id: string, patch: FlagPatch): Promise<void>;
  // Swaps places with the active neighbor above (-1) or below (1).
  move(id: string, by: -1 | 1): Promise<void>;
};

export type FlagsStore = StoreApi<FlagState>;

type Options = { clock?: () => Date; makeId?: () => string };

// The flag list in memory, backed by a FlagStore. The category store's twin: writes are
// optimistic and are put back if the store rejects them.
export function createFlagStore(store: FlagStore, options: Options = {}): FlagsStore {
  const clock = options.clock ?? (() => new Date());
  const makeId = options.makeId ?? newFlagId;

  return createStore<FlagState>((set, get) => {
    const write = async (changed: Flag[]) => {
      const before = get().list;
      const ids = new Set(changed.map((f) => f.id));
      set({ list: sortFlags([...before.filter((f) => !ids.has(f.id)), ...changed]), error: null });
      try {
        for (const flag of changed) await store.putFlag(flag);
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
          set({ status: 'ready', list: sortFlags(await store.listFlags()) });
        } catch (cause) {
          set({ status: 'error', error: message(cause) });
        }
      },

      async refresh() {
        if (get().status !== 'ready') return;
        try {
          set({ list: sortFlags(await store.listFlags()) });
        } catch {
          // What is on screen stays; the next refresh tries again.
        }
      },

      async add(label, icon) {
        await write([newFlag(get().list, makeId(), label, icon, clock().getTime())]);
      },

      async update(id, patch) {
        const base = get().list.find((f) => f.id === id);
        if (base) await write([patchFlag(base, patch, clock().getTime())]);
      },

      async move(id, by) {
        const active = activeFlags(get().list);
        const from = active.findIndex((f) => f.id === id);
        const other = active[from + by];
        if (from < 0 || !other) return;
        const now = clock().getTime();
        const self = active[from]!;
        // A tie can arrive from another device; nudging by one keeps the swap visible.
        const tie = self.position === other.position;
        await write([
          patchFlag(self, { position: tie ? other.position + by : other.position }, now),
          patchFlag(other, { position: self.position }, now),
        ]);
      },
    };
  });
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
