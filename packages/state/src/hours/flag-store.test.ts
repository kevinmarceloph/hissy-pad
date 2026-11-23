import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import { MemoryStore } from '@hissypad/core/hours';

import { createFlagStore } from './flag-store';

const NOW = new Date(2026, 10, 20, 9, 0);
const options = { clock: () => NOW, makeId: () => 'fnew000001' };

async function setup(store: MemoryStore = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS)) {
  const flags = createFlagStore(store, options);
  await flags.getState().load();
  return { store, flags, labels: () => flags.getState().list.filter((f) => !f.archived).map((f) => f.label) };
}

describe('flag store', () => {
  it('loads the three defaults in order', async () => {
    const { flags, labels } = await setup();
    expect(flags.getState().status).toBe('ready');
    expect(labels()).toEqual(['Distracted', 'Mindful', 'HALTS']);
  });

  it('adds, renames, reorders and archives, writing each change through', async () => {
    const { store, flags, labels } = await setup();
    await flags.getState().add('In flow', '🌊');
    await flags.getState().update('halts', { label: 'Hungry or tired' });
    await flags.getState().move('fnew000001', -1);
    await flags.getState().update('mindful', { archived: true });

    expect(labels()).toEqual(['Distracted', 'In flow', 'Hungry or tired']);
    const saved = await store.listFlags();
    expect(saved.find((f) => f.id === 'fnew000001')).toMatchObject({ label: 'In flow', icon: '🌊', position: 2 });
    expect(saved.find((f) => f.id === 'mindful')!.archived).toBe(true);
  });

  it('puts the list back when the store rejects a write', async () => {
    const { store, flags, labels } = await setup();
    store.putFlag = () => Promise.reject(new Error('disk full'));
    await flags.getState().update('halts', { label: 'Tired' });
    expect(labels()).toEqual(['Distracted', 'Mindful', 'HALTS']);
    expect(flags.getState().error).toBe('disk full');
  });
});
