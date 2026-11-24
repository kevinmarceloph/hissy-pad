import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { SAMPLE_CATEGORIES, patchCategory } from '@hissypad/core/hours';
import { applyPatch, type Entry } from '@hissypad/core/hours';
import { SAMPLE_FLAGS, patchFlag } from '@hissypad/core/hours';
import { EVERY_DAY, newRecurring, patchRecurring } from '@hissypad/core/hours';
import { MemoryStore } from '@hissypad/core/hours';

import { createSyncEngine, cursorKey, PULL_EPOCH, syncLine, type SyncStatus } from './engine';
import { createFakeRemote, type FakeRemote } from './fakeRemote';

const DAY = '2026-11-19';
const entry = (hour: number, note: string, updatedAt: number, category: string | null = null): Entry => ({
  day: DAY,
  hour,
  note,
  category,
  planned: null,
  plannedNote: '',
  flags: [],
  state: 'open',
  updatedAt,
});

// One device: its own local store, an engine on the shared server.
function device(remote: FakeRemote, seed: Entry[] = []) {
  const store = new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS);
  const statuses: SyncStatus[] = [];
  let pulled = 0;
  const engine = createSyncEngine({
    local: store.sync,
    remote,
    onPulled: () => (pulled += 1),
    onStatus: (s) => statuses.push(s),
    now: () => 1_795_000_000_000,
    // The fake server stamps a second apart; no slack keeps the paging assertions exact.
    cursorSlackMs: 0,
  });
  const notes = async () => (await store.listDay(DAY)).map((e) => `${e.hour}:${e.note}`);
  return { store, engine, statuses, notes, pulledCount: () => pulled };
}

describe('sync engine', () => {
  it('pushes everything on a first sync: the hours and the seeded categories', async () => {
    const remote = createFakeRemote();
    const a = device(remote, [entry(9, 'proposals', 100, 'deep')]);
    await a.engine.sync();

    expect(remote.entryRows.size).toBe(1);
    expect(remote.categoryRows.size).toBe(8);
    expect(await a.store.sync.entries.dirty()).toEqual([]);
    expect(await a.store.sync.categories.dirty()).toEqual([]);
    expect(a.engine.status()).toEqual({ state: 'idle', pending: 0, lastSyncAt: 1_795_000_000_000, error: null });
  });

  it('brings a second device up to date, and says so once', async () => {
    const remote = createFakeRemote();
    const a = device(remote, [entry(9, 'proposals', 100, 'deep'), entry(10, 'lunch', 100, 'body')]);
    await a.engine.sync();

    const b = device(remote);
    await b.engine.sync();
    expect(await b.notes()).toEqual(['9:proposals', '10:lunch']);
    expect(b.pulledCount()).toBe(1);

    // Nothing new: the cursor is past everything, so nothing lands and nothing is said.
    await b.engine.sync();
    expect(b.pulledCount()).toBe(1);
    expect(await b.store.sync.getMeta(cursorKey('entries'))).not.toBeNull();
  });

  it('does not duplicate the default categories two devices both seeded', async () => {
    const remote = createFakeRemote();
    const a = device(remote);
    const b = device(remote);
    await a.engine.sync();
    await b.engine.sync();
    expect(remote.categoryRows.size).toBe(8);
    expect(await b.store.listCategories()).toHaveLength(8);
    expect(await b.store.sync.categories.dirty()).toEqual([]);
  });

  it('syncs the flag list and an hour`s plan and flags', async () => {
    const remote = createFakeRemote();
    const a = device(remote);
    const b = device(remote);
    await a.engine.sync();
    await b.engine.sync();
    expect(remote.flagRows.size).toBe(3);

    await a.store.putFlag(patchFlag(SAMPLE_FLAGS[2], { label: 'Hungry or tired' }, 500));
    await a.store.put(
      applyPatch(undefined, DAY, 9, { note: 'scrolled', category: 'drift', planned: 'deep', plannedNote: 'proposals', flags: ['halts'] }, 500),
    );
    await a.engine.sync();
    await b.engine.sync();

    expect((await b.store.listFlags()).find((f) => f.id === 'halts')!.label).toBe('Hungry or tired');
    expect((await b.store.listDay(DAY))[0]).toMatchObject({ planned: 'deep', plannedNote: 'proposals', flags: ['halts'] });
    expect(await b.store.sync.flags.dirty()).toEqual([]);
  });

  it('syncs a recurring plan, its edits and its archiving', async () => {
    const remote = createFakeRemote();
    const a = device(remote);
    const b = device(remote);
    const sleep = newRecurring([], 'rsleep0001', { note: 'sleep', category: 'sleep', from: 2, to: 10, days: [...EVERY_DAY] }, new Date(2026, 10, 21, 10));
    await a.store.putRecurring(sleep);
    await a.engine.sync();
    expect(remote.recurringRows.size).toBe(1);
    expect(await a.store.sync.recurring.dirty()).toEqual([]);

    await b.engine.sync();
    expect(await b.store.listRecurring()).toEqual([sleep]);
    expect(await b.store.sync.recurring.dirty()).toEqual([]);

    // B shortens it and archives it; A hears.
    await b.store.putRecurring(patchRecurring(sleep, { to: 9, archived: true }, sleep.updatedAt + 1000));
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.store.listRecurring())[0]).toMatchObject({ to: 9, archived: true });
  });

  it('settles the same hour on the newer write, whichever device syncs first', async () => {
    const remote = createFakeRemote();
    const a = device(remote, [entry(9, 'from A, older', 100)]);
    const b = device(remote, [entry(9, 'from B, newer', 200)]);
    await a.engine.sync();
    await b.engine.sync(); // B's newer write beats A's on the server
    await a.engine.sync(); // and A takes it
    expect(await a.notes()).toEqual(['9:from B, newer']);
    expect(await b.notes()).toEqual(['9:from B, newer']);

    // The other order: the newer write is already there when the older one arrives.
    const c = device(remote, [entry(11, 'newer', 900)]);
    const d = device(remote, [entry(11, 'older', 800)]);
    await c.engine.sync();
    await d.engine.sync();
    expect(await d.notes()).toContain('11:newer');
    expect(remote.entryRows.get(`${DAY}T11`)!.row.note).toBe('newer');
  });

  it('carries a cleared hour to the other device as an empty row', async () => {
    const remote = createFakeRemote();
    const a = device(remote, [entry(9, 'proposals', 100, 'deep')]);
    const b = device(remote);
    await a.engine.sync();
    await b.engine.sync();

    const before = (await a.store.listDay(DAY))[0];
    await a.store.put(applyPatch(before, DAY, 9, { note: '', category: null }, 300));
    await a.engine.sync();
    await b.engine.sync();
    expect(await b.store.listDay(DAY)).toEqual([{ day: DAY, hour: 9, note: '', category: null, planned: null, plannedNote: '', flags: [], state: 'open', updatedAt: 300 }]);
  });

  it('syncs a renamed, recolored and archived category', async () => {
    const remote = createFakeRemote();
    const a = device(remote);
    const b = device(remote);
    await a.engine.sync();
    await b.engine.sync();

    await a.store.putCategory(patchCategory(SAMPLE_CATEGORIES[0], { label: 'Focus', color: 'indigo' }, 500));
    await a.store.putCategory(patchCategory(SAMPLE_CATEGORIES[7], { archived: true }, 500));
    await a.engine.sync();
    await b.engine.sync();

    const list = await b.store.listCategories();
    expect(list.find((c) => c.id === 'deep')).toMatchObject({ label: 'Focus', color: 'indigo' });
    expect(list.find((c) => c.id === 'drift')!.archived).toBe(true);
  });

  it('keeps a row dirty when it was edited while its push was in flight', async () => {
    const remote = createFakeRemote();
    const a = device(remote, [entry(9, 'first', 100)]);
    await a.store.sync.categories.markClean(SAMPLE_CATEGORIES);
    await a.store.sync.flags.markClean(SAMPLE_FLAGS); // only the entry is waiting

    const release = remote.holdNextPush();
    const running = a.engine.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await a.store.put(entry(9, 'second', 200));
    release();
    await running;

    expect((await a.store.sync.entries.dirty()).map((e) => e.note)).toEqual(['second']);
    await a.engine.sync();
    expect(remote.entryRows.get(`${DAY}T9`)!.row.note).toBe('second');
    expect(await a.store.sync.entries.dirty()).toEqual([]);
  });

  it('reports a failed push, keeps the rows waiting and recovers on the next sync', async () => {
    const remote = createFakeRemote();
    const a = device(remote, [entry(9, 'proposals', 100)]);
    remote.failNextPush(new Error('network down'));
    await a.engine.sync();
    // The categories' push failed; the flags and the hour still went, so 8 rows wait, not 12.
    expect(a.engine.status()).toMatchObject({ state: 'error', error: 'network down', pending: 8 });

    await a.engine.sync();
    expect(a.engine.status()).toMatchObject({ state: 'idle', error: null, pending: 0 });
    expect(remote.entryRows.size).toBe(1);
  });

  it('still hears from the other device when its own push fails', async () => {
    const remote = createFakeRemote();
    const a = device(remote, [entry(10, 'plan for the morning', 5)]);
    await a.engine.sync();

    const b = device(remote, [entry(7, 'sleep', 6)]);
    remote.failNextPush(new Error('new row violates check constraint'));
    await b.engine.sync();

    expect(await b.notes()).toEqual(['7:sleep', '10:plan for the morning']);
    expect(b.pulledCount()).toBe(1);
    expect(b.engine.status()).toMatchObject({ state: 'error', error: 'new row violates check constraint' });
    expect(b.engine.status().pending).toBeGreaterThan(0);
  });

  it('reads everything again once, and takes the server`s row over a clean local one that differs', async () => {
    const remote = createFakeRemote();
    const a = device(remote, [{ ...entry(10, '', 5), planned: 'deep', plannedNote: 'market trip' }]);
    await a.engine.sync();

    // The other device holds an empty copy of that hour, clean, with its cursor past it,
    // and last pulled under an older epoch.
    const b = device(remote);
    await b.engine.sync();
    await b.store.put(entry(10, '', 5));
    await b.store.sync.entries.markClean([entry(10, '', 5)]);
    await b.store.sync.setMeta('sync.epoch', '1');
    expect((await b.store.listDay(DAY))[0].plannedNote).toBe('');

    await b.engine.sync();
    expect((await b.store.listDay(DAY))[0]).toMatchObject({ planned: 'deep', plannedNote: 'market trip' });
    expect(await b.store.sync.getMeta('sync.epoch')).toBe(PULL_EPOCH);

    // The next sync starts from the cursor again and lands nothing.
    const before = b.pulledCount();
    await b.engine.sync();
    expect(b.pulledCount()).toBe(before);
  });

  it('says the server cannot be reached in the same words on every platform', async () => {
    for (const message of ['TypeError: Failed to fetch', 'Network request failed', 'fetch failed']) {
      const remote = createFakeRemote();
      const a = device(remote, [entry(9, 'proposals', 100)]);
      remote.failNextPush(new Error(message));
      await a.engine.sync();
      expect(syncLine(a.engine.status())).toBe('Sync failed: cannot reach the server.');
    }
  });

  it('pages through a pull larger than one page', async () => {
    const remote = createFakeRemote();
    const many = Array.from({ length: 24 }, (_, hour) => entry(hour, `h${hour}`, 100));
    const a = device(remote, many);
    await a.engine.sync();

    const store = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const small = createSyncEngine({ local: store.sync, remote, pageSize: 5, cursorSlackMs: 0 });
    await small.sync();
    expect(await store.listDay(DAY)).toHaveLength(24);
  });

  it('sends a whole device again after its rows are marked dirty for a new account', async () => {
    const first = createFakeRemote();
    const a = device(first, [entry(9, 'proposals', 100)]);
    await a.engine.sync();

    // A different account: a different, empty server. Old cursors would skip its rows.
    const second = createFakeRemote();
    await a.store.sync.entries.markAllDirty();
    await a.store.sync.categories.markAllDirty();
    await a.store.sync.setMeta(cursorKey('entries'), null);
    await a.store.sync.setMeta(cursorKey('categories'), null);
    const again = createSyncEngine({ local: a.store.sync, remote: second });
    await again.sync();
    expect(second.entryRows.size).toBe(1);
    expect(second.categoryRows.size).toBe(8);
  });

  it('syncs again on a realtime nudge once started, and not after stop', async () => {
    vi.useFakeTimers();
    try {
      const remote = createFakeRemote();
      const a = device(remote);
      const b = device(remote);
      b.engine.start();
      await vi.advanceTimersByTimeAsync(0);

      await a.store.put(entry(9, 'proposals', 100));
      await a.engine.sync(); // the server changes and nudges B
      await vi.advanceTimersByTimeAsync(1000);
      expect(await b.notes()).toEqual(['9:proposals']);

      b.engine.stop();
      await a.store.put(entry(10, 'lunch', 100));
      await a.engine.sync();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await b.notes()).toEqual(['9:proposals']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('syncLine', () => {
  const idle: SyncStatus = { state: 'idle', pending: 0, lastSyncAt: null, error: null };

  it('says where things stand in one line', () => {
    expect(syncLine(null)).toBe('Syncing.');
    expect(syncLine(idle)).toBe('Synced.');
    expect(syncLine({ ...idle, pending: 1 })).toBe('1 change waiting.');
    expect(syncLine({ ...idle, pending: 3 })).toBe('3 changes waiting.');
    expect(syncLine({ ...idle, state: 'error', error: 'network down' })).toBe('Sync failed: network down.');
    expect(syncLine({ ...idle, pending: 2 }, false)).toBe('Offline. 2 changes waiting.');
    expect(syncLine(idle, false)).toBe('Offline. Changes will sync when you are back.');
    expect(syncLine({ ...idle, lastSyncAt: new Date(2026, 10, 19, 21, 41).getTime() })).toMatch(/^Synced at 9:41/);
  });
});
