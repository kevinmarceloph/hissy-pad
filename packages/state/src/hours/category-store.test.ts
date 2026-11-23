import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import { MemoryStore, type CategoryStore } from '@hissypad/core/hours';

import { createCategoryStore } from './category-store';

const NOW = new Date(2026, 10, 19, 14, 25);
const options = { clock: () => NOW, makeId: () => 'cnew000001' };

async function setup(store: MemoryStore = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS)) {
  const categories = createCategoryStore(store, options);
  await categories.getState().load();
  return { store, categories, labels: () => categories.getState().list.map((c) => c.label) };
}

describe('category store', () => {
  it('loads the list in order', async () => {
    const { categories, labels } = await setup();
    expect(categories.getState().status).toBe('ready');
    expect(labels()).toEqual(['Deep work', 'Admin', 'Learning', 'People', 'Body', 'Rest', 'Sleep', 'Drift']);
  });

  it('adds at the end and writes through', async () => {
    const { store, categories, labels } = await setup();
    await categories.getState().add('Errands', 'sky');
    expect(labels().at(-1)).toBe('Errands');
    expect((await store.listCategories()).find((c) => c.id === 'cnew000001')).toMatchObject({
      label: 'Errands',
      color: 'sky',
      position: 8,
      updatedAt: NOW.getTime(),
    });
  });

  it('renames, recolors and archives with a newer stamp', async () => {
    const { store, categories } = await setup();
    await categories.getState().update('deep', { label: 'Focus', color: 'indigo' });
    await categories.getState().update('drift', { archived: true });
    const saved = await store.listCategories();
    expect(saved.find((c) => c.id === 'deep')).toMatchObject({ label: 'Focus', color: 'indigo', updatedAt: NOW.getTime() });
    expect(saved.find((c) => c.id === 'drift')!.archived).toBe(true);
  });

  it('moves a category past its neighbor and stops at the ends', async () => {
    const { store, categories, labels } = await setup();
    await categories.getState().move('admin', -1);
    expect(labels().slice(0, 3)).toEqual(['Admin', 'Deep work', 'Learning']);
    await categories.getState().move('admin', -1);
    expect(labels()[0]).toBe('Admin');
    await categories.getState().move('drift', 1);
    expect(labels().at(-1)).toBe('Drift');

    const reloaded = createCategoryStore(store, options);
    await reloaded.getState().load();
    expect(reloaded.getState().list.slice(0, 2).map((c) => c.label)).toEqual(['Admin', 'Deep work']);
  });

  it('moves past an archived category in one step', async () => {
    const { categories, labels } = await setup();
    await categories.getState().update('admin', { archived: true });
    await categories.getState().move('learn', -1);
    expect(labels().filter((l) => l !== 'Admin').slice(0, 2)).toEqual(['Learning', 'Deep work']);
  });

  it('still swaps two categories that share a position', async () => {
    const tied = SAMPLE_CATEGORIES.map((c) => (c.id === 'admin' ? { ...c, position: 0 } : c));
    const { categories, labels } = await setup(new MemoryStore([], tied));
    expect(labels().slice(0, 2)).toEqual(['Admin', 'Deep work']);
    await categories.getState().move('deep', -1);
    expect(labels().slice(0, 2)).toEqual(['Deep work', 'Admin']);
  });

  it('puts the list back when a write fails', async () => {
    const { store, categories, labels } = await setup();
    store.putCategory = () => Promise.reject(new Error('disk full'));
    await categories.getState().update('deep', { label: 'Focus' });
    expect(labels()[0]).toBe('Deep work');
    expect(categories.getState().error).toBe('disk full');
  });

  it('reports a failed load', async () => {
    const broken: CategoryStore = {
      listCategories: () => Promise.reject(new Error('disk full')),
      putCategory: async () => {},
    };
    const categories = createCategoryStore(broken, options);
    await categories.getState().load();
    expect(categories.getState()).toMatchObject({ status: 'error', error: 'disk full' });
  });
});
