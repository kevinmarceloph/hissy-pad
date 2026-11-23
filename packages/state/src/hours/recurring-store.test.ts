import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import { EVERY_DAY } from '@hissypad/core/hours';
import { MemoryStore } from '@hissypad/core/hours';

import { createRecurringStore, createStaticRecurringStore } from './recurring-store';

// Saturday 2026-11-21, 10:00 local.
const NOW = new Date(2026, 10, 21, 10, 0);
let made = 0;
const options = { clock: () => NOW, makeId: () => `rnew00000${++made}` };
const sleep = { note: 'sleep', category: 'sleep', from: 2, to: 10, days: [...EVERY_DAY] };

async function setup(store: MemoryStore = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS)) {
  made = 0;
  const plans = createRecurringStore(store, options);
  await plans.getState().load();
  return { store, plans, notes: () => plans.getState().list.filter((p) => !p.archived).map((p) => p.note) };
}

describe('recurring plan store', () => {
  it('starts empty: nothing is seeded', async () => {
    const { plans } = await setup();
    expect(plans.getState().status).toBe('ready');
    expect(plans.getState().list).toEqual([]);
  });

  it('adds, edits and archives, writing each change through', async () => {
    const { store, plans, notes } = await setup();
    await plans.getState().add(sleep);
    await plans.getState().add({ note: 'gym', category: 'body', from: 18, to: 19, days: [1, 3, 5] });
    await plans.getState().update('rnew000001', { to: 9 });
    expect(notes()).toEqual(['sleep', 'gym']);

    const saved = await store.listRecurring();
    expect(saved.find((p) => p.id === 'rnew000001')).toMatchObject({ from: 2, to: 9, since: '2026-11-21', position: 0 });
    expect(saved.find((p) => p.id === 'rnew000002')).toMatchObject({ days: [1, 3, 5], position: 1 });
    // A local edit is waiting for sync.
    expect((await store.sync.recurring.dirty()).length).toBe(2);

    await plans.getState().update('rnew000002', { archived: true });
    expect(notes()).toEqual(['sleep']);
    expect((await store.listRecurring()).find((p) => p.id === 'rnew000002')!.archived).toBe(true);
  });

  it('moves a plan past its neighbor, past an archived one in one step, and stops at the ends', async () => {
    const { store, plans, notes } = await setup();
    await plans.getState().add(sleep);
    await plans.getState().add({ note: 'gym', category: 'body', from: 18, to: 19, days: [1, 3, 5] });
    await plans.getState().add({ note: 'church', category: 'people', from: 9, to: 11, days: [0] });
    await plans.getState().update('rnew000002', { archived: true });

    await plans.getState().move('rnew000003', -1);
    expect(notes()).toEqual(['church', 'sleep']);
    await plans.getState().move('rnew000003', -1);
    await plans.getState().move('rnew000001', 1);
    expect(notes()).toEqual(['church', 'sleep']);
    // Both rows of a swap are written.
    const saved = await store.listRecurring();
    expect(saved.find((p) => p.id === 'rnew000003')!.position).toBeLessThan(saved.find((p) => p.id === 'rnew000001')!.position);
  });

  it('puts the list back when the store rejects a write', async () => {
    const { store, plans, notes } = await setup();
    await plans.getState().add(sleep);
    store.putRecurring = () => Promise.reject(new Error('disk full'));
    await plans.getState().update('rnew000001', { note: 'nap' });
    expect(notes()).toEqual(['sleep']);
    expect(plans.getState().error).toBe('disk full');
  });

  it('has a stand-in that is always empty', async () => {
    const plans = createStaticRecurringStore();
    expect(plans.getState()).toMatchObject({ status: 'ready', list: [] });
  });
});
