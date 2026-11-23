import { createStore, type StoreApi } from 'zustand/vanilla';

import { cleanDayStart, DAY_START_DEFAULT, dayOf, shiftDay, slotDay, type DayKey } from '@hissypad/core/hours';
import { applyPatch, type Entry, type EntryPatch } from '@hissypad/core/hours';
import type { EntryStore } from '@hissypad/core/hours';

export type DayState = {
  // The day on the screen. It starts at `start` o'clock, so with a start past midnight its
  // last hours are stored under the next calendar day.
  day: DayKey;
  // The hour a day starts at, 0-23. A setting of this device.
  start: number;
  status: 'loading' | 'ready' | 'error';
  // Set when a read or a write fails; the screen shows it with a retry.
  error: string | null;
  byHour: Record<number, Entry>;
  open(day: DayKey): Promise<void>;
  // Re-reads the open day in place, with no loading state: sync calls it after rows land.
  refresh(): Promise<void>;
  save(hour: number, patch: EntryPatch): Promise<void>;
  // Takes a day start read from the device's settings, before anything is loaded.
  adoptStart(start: number): void;
  // Changes the day start, keeps it, and opens the day that now holds this moment.
  setStart(start: number): Promise<void>;
};

type Options = {
  start?: number;
  // Where the day start is kept between runs. Without it the setting lasts until the app closes.
  saveStart?: (start: number) => Promise<void>;
};

export type DayStore = StoreApi<DayState>;

// One day in memory at a time, backed by an EntryStore. Writes are optimistic: the row
// changes on screen first and is put back if the store rejects it.
export function createDayStore(
  store: EntryStore,
  clock: () => Date = () => new Date(),
  options: Options = {},
): DayStore {
  const first = cleanDayStart(options.start ?? DAY_START_DEFAULT);

  // The rows of the day on the screen: its own calendar day from the start hour on, then
  // the hours before the start hour of the next one.
  const read = async (day: DayKey, start: number) => {
    const rows = (await store.listDay(day)).filter((e) => e.hour >= start);
    if (start === 0) return rows;
    return [...rows, ...(await store.listDay(shiftDay(day, 1))).filter((e) => e.hour < start)];
  };

  return createStore<DayState>((set, get) => ({
    day: dayOf(clock(), first),
    start: first,
    status: 'loading',
    error: null,
    byHour: {},

    async open(day) {
      set({ day, status: 'loading', error: null, byHour: {} });
      try {
        const rows = await read(day, get().start);
        // The user may have moved to another day while this one was loading.
        if (get().day !== day) return;
        set({ status: 'ready', byHour: Object.fromEntries(rows.map((e) => [e.hour, e])) });
      } catch (cause) {
        if (get().day !== day) return;
        set({ status: 'error', error: message(cause) });
      }
    },

    async refresh() {
      const { day, status, start } = get();
      if (status !== 'ready') return;
      try {
        const rows = await read(day, start);
        if (get().day !== day) return;
        // A save made while this read was under way is on the screen and may not have been
        // in the rows yet. Rows are never deleted and updatedAt only grows, so the newer of
        // the two is the hour: dropping the one in memory would hide the edit, and the next
        // edit to that hour would be built on the old row and overwrite it for good.
        const byHour = Object.fromEntries(rows.map((e) => [e.hour, e]));
        for (const held of Object.values(get().byHour)) {
          const row = byHour[held.hour];
          if (!row || (row.day === held.day && held.updatedAt > row.updatedAt)) byHour[held.hour] = held;
        }
        set({ byHour });
      } catch {
        // What is on screen stays; the next open or refresh tries again.
      }
    },

    async save(hour, patch) {
      const { day, byHour, start } = get();
      const before = byHour[hour];
      const entry = applyPatch(before, slotDay(day, hour, start), hour, patch, clock().getTime());
      set({ byHour: { ...byHour, [hour]: entry }, error: null });
      try {
        await store.put(entry);
      } catch (cause) {
        if (get().day !== day) return;
        const current = { ...get().byHour };
        if (before) current[hour] = before;
        else delete current[hour];
        set({ byHour: current, error: message(cause) });
      }
    },

    adoptStart(start) {
      const clean = cleanDayStart(start);
      set({ start: clean, day: dayOf(clock(), clean) });
    },

    async setStart(start) {
      const clean = cleanDayStart(start);
      if (clean === get().start) return;
      get().adoptStart(clean);
      await get().open(get().day);
      try {
        await options.saveStart?.(clean);
      } catch (cause) {
        set({ error: message(cause) });
      }
    },
  }));
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
