import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import type { Entry } from '@hissypad/core/hours';
import { MemoryStore, type EntryStore } from '@hissypad/core/hours';

import { createDayStore } from './day-store';

const NOW = new Date(2026, 10, 19, 14, 25);
const clock = () => NOW;

const seed: Entry[] = [
  { day: '2026-11-19', hour: 9, note: 'proposals', category: 'deep', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
  { day: '2026-11-18', hour: 22, note: '', category: 'sleep', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
];

describe('day store', () => {
  it('starts on today and loads that day only', async () => {
    const day = createDayStore(new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS), clock);
    expect(day.getState()).toMatchObject({ day: '2026-11-19', status: 'loading' });
    await day.getState().open('2026-11-19');
    expect(day.getState().status).toBe('ready');
    expect(Object.keys(day.getState().byHour)).toEqual(['9']);
  });

  it('saves through to the store and survives a reopen', async () => {
    const store = new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const day = createDayStore(store, clock);
    await day.getState().open('2026-11-19');
    await day.getState().save(10, { note: 'lunch', category: 'body' });
    await day.getState().save(9, { category: 'admin' });

    expect(day.getState().byHour[9]).toMatchObject({ note: 'proposals', category: 'admin' });
    await day.getState().open('2026-11-18');
    await day.getState().open('2026-11-19');
    expect(day.getState().byHour[10]).toMatchObject({ note: 'lunch', category: 'body', planned: null, plannedNote: '', flags: [], updatedAt: NOW.getTime() });
  });

  it('drops a slow load when the day changed underneath it', async () => {
    let release!: (rows: Entry[]) => void;
    const slow: EntryStore = {
      listDay: (d) => (d === '2026-11-18' ? new Promise((r) => (release = r)) : Promise.resolve([])),
      put: async () => {},
    };
    const day = createDayStore(slow, clock);
    const stale = day.getState().open('2026-11-18');
    await day.getState().open('2026-11-19');
    release([seed[1]]);
    await stale;
    expect(day.getState()).toMatchObject({ day: '2026-11-19', status: 'ready', byHour: {} });
  });

  it('reports a failed load', async () => {
    const broken: EntryStore = { listDay: () => Promise.reject(new Error('disk full')), put: async () => {} };
    const day = createDayStore(broken, clock);
    await day.getState().open('2026-11-19');
    expect(day.getState()).toMatchObject({ status: 'error', error: 'disk full' });
  });

  it('puts the row back when a write fails', async () => {
    const store = new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const day = createDayStore(store, clock);
    await day.getState().open('2026-11-19');
    store.put = () => Promise.reject(new Error('disk full'));

    await day.getState().save(9, { note: 'changed' });
    expect(day.getState().byHour[9].note).toBe('proposals');
    await day.getState().save(11, { note: 'new' });
    expect(day.getState().byHour[11]).toBeUndefined();
    expect(day.getState().error).toBe('disk full');
  });

  it('keeps an edit made while a refresh was reading', async () => {
    const store = new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const day = createDayStore(store, clock);
    await day.getState().open('2026-11-19');

    // Sync asks for a refresh; its read answers with the rows as they were before the save.
    const list = store.listDay.bind(store);
    let release!: () => void;
    store.listDay = async (d) => {
      const rows = await list(d);
      await new Promise<void>((r) => (release = r));
      return rows;
    };
    const refreshing = day.getState().refresh();
    await Promise.resolve();
    await day.getState().save(10, { note: 'lunch' });
    await day.getState().save(9, { category: 'admin' });
    release();
    await refreshing;

    expect(day.getState().byHour[10]).toMatchObject({ note: 'lunch' });
    expect(day.getState().byHour[9]).toMatchObject({ note: 'proposals', category: 'admin' });
  });

  it('takes a newer row from a refresh over the one in memory', async () => {
    const store = new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const day = createDayStore(store, clock);
    await day.getState().open('2026-11-19');
    await store.sync.entries.applyRemote([{ ...seed[0], note: 'from the phone', updatedAt: 2 }]);
    await day.getState().refresh();
    expect(day.getState().byHour[9].note).toBe('from the phone');
  });

  describe('with a day that starts at 6am', () => {
    const rows: Entry[] = [
      { day: '2026-11-19', hour: 3, note: 'up late', category: 'drift', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
      { day: '2026-11-19', hour: 9, note: 'proposals', category: 'deep', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
      { day: '2026-11-20', hour: 1, note: '', category: 'sleep', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
      { day: '2026-11-20', hour: 8, note: 'standup', category: 'people', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
    ];

    it('loads 6am to 6am and writes the small hours under the next calendar day', async () => {
      const store = new MemoryStore(rows, SAMPLE_CATEGORIES, SAMPLE_FLAGS);
      const day = createDayStore(store, clock, { start: 6 });
      await day.getState().open('2026-11-19');
      // 3am Thursday belongs to Wednesday's day; 1am Friday belongs to Thursday's.
      expect(Object.keys(day.getState().byHour).sort()).toEqual(['1', '9']);

      await day.getState().save(2, { note: 'could not sleep' });
      await day.getState().save(10, { note: 'lunch' });
      expect((await store.listDay('2026-11-20')).find((e) => e.hour === 2)!.note).toBe('could not sleep');
      expect((await store.listDay('2026-11-19')).find((e) => e.hour === 10)!.note).toBe('lunch');
    });

    it('is still yesterday before 6am', () => {
      const early = () => new Date(2026, 10, 20, 2, 30);
      expect(createDayStore(new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS), early, { start: 6 }).getState().day).toBe('2026-11-19');
      expect(createDayStore(new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS), early).getState().day).toBe('2026-11-20');
    });

    it('changes the start, keeps it, and reloads the day that holds now', async () => {
      const store = new MemoryStore(rows, SAMPLE_CATEGORIES, SAMPLE_FLAGS);
      const kept: number[] = [];
      const day = createDayStore(store, clock, { saveStart: async (start) => void kept.push(start) });
      await day.getState().open('2026-11-19');
      expect(Object.keys(day.getState().byHour).sort()).toEqual(['3', '9']);

      await day.getState().setStart(6);
      expect(kept).toEqual([6]);
      expect(day.getState()).toMatchObject({ start: 6, day: '2026-11-19', status: 'ready' });
      expect(Object.keys(day.getState().byHour).sort()).toEqual(['1', '9']);
      // The rows themselves did not move.
      expect((await store.listDay('2026-11-19')).map((e) => e.hour)).toEqual([3, 9]);
    });
  });
});
