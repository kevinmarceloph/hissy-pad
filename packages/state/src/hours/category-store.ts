import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  activeCategories,
  newCategory,
  newCategoryId,
  patchCategory,
  sortCategories,
  type Category,
  type CategoryPatch,
  type ColorKey,
} from '@hissypad/core/hours';
import type { CategoryStore } from '@hissypad/core/hours';

export type CategoryState = {
  status: 'loading' | 'ready' | 'error';
  // Set when a read or a write fails; the screen shows it.
  error: string | null;
  // Every category in order, archived ones included.
  list: Category[];
  load(): Promise<void>;
  // Re-reads the list in place, with no loading state: sync calls it after rows land.
  refresh(): Promise<void>;
  // The new category, or null when the store would not take it (the list is put back).
  add(label: string, icon: string, color: ColorKey): Promise<Category | null>;
  update(id: string, patch: CategoryPatch): Promise<void>;
  // Swaps places with the active neighbor above (-1) or below (1).
  move(id: string, by: -1 | 1): Promise<void>;
};

export type CategoriesStore = StoreApi<CategoryState>;

type Options = { clock?: () => Date; makeId?: () => string };

// The category list in memory, backed by a CategoryStore. Writes are optimistic, like the
// day store: the list changes on screen first and is put back if the store rejects it.
export function createCategoryStore(store: CategoryStore, options: Options = {}): CategoriesStore {
  const clock = options.clock ?? (() => new Date());
  const makeId = options.makeId ?? newCategoryId;

  return createStore<CategoryState>((set, get) => {
    const write = async (changed: Category[]) => {
      const before = get().list;
      const ids = new Set(changed.map((c) => c.id));
      set({ list: sortCategories([...before.filter((c) => !ids.has(c.id)), ...changed]), error: null });
      try {
        for (const category of changed) await store.putCategory(category);
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
          set({ status: 'ready', list: sortCategories(await store.listCategories()) });
        } catch (cause) {
          set({ status: 'error', error: message(cause) });
        }
      },

      async refresh() {
        if (get().status !== 'ready') return;
        try {
          set({ list: sortCategories(await store.listCategories()) });
        } catch {
          // What is on screen stays; the next refresh tries again.
        }
      },

      async add(label, icon, color) {
        const made = newCategory(get().list, makeId(), label, icon, color, clock().getTime());
        await write([made]);
        return get().list.some((c) => c.id === made.id) ? made : null;
      },

      async update(id, patch) {
        const base = get().list.find((c) => c.id === id);
        if (base) await write([patchCategory(base, patch, clock().getTime())]);
      },

      async move(id, by) {
        const active = activeCategories(get().list);
        const from = active.findIndex((c) => c.id === id);
        const other = active[from + by];
        if (from < 0 || !other) return;
        const now = clock().getTime();
        const self = active[from]!;
        // Seeded and added positions are distinct, but a tie can arrive from another
        // device; nudging by one keeps the swap visible either way.
        const tie = self.position === other.position;
        await write([
          patchCategory(self, { position: tie ? other.position + by : other.position }, now),
          patchCategory(other, { position: self.position }, now),
        ]);
      },
    };
  });
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
