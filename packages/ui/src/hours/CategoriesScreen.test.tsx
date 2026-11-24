import { vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import { fireEvent, render, screen } from '../testing/rntl';

import { MemoryStore } from '@hissypad/core/hours';
import { createCategoryStore } from '@hissypad/state/hours';
import { createDayStore } from '@hissypad/state/hours';
import { createFlagStore } from '@hissypad/state/hours';
import { StoresProvider } from './provider';

import { CategoriesScreen } from './CategoriesScreen';

async function setup(store = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS)) {
  const categories = createCategoryStore(store, { makeId: () => 'cnew000001' });
  await categories.getState().load();
  const onBack = vi.fn();
  await render(
    <StoresProvider day={createDayStore(store)} categories={categories} flags={createFlagStore(store)}>
      <CategoriesScreen onBack={onBack} />
    </StoresProvider>,
  );
  const saved = async (id: string) => (await store.listCategories()).find((c) => c.id === id)!;
  return { store, onBack, saved };
}

describe('CategoriesScreen', () => {
  it('lists the categories with their colors and goes back', async () => {
    const { onBack } = await setup();
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeTruthy();
    expect(screen.getByLabelText('Deep work, Blue')).toBeTruthy();
    expect(screen.getByLabelText('Drift, Rose')).toBeTruthy();
    expect(screen.queryByText('Archived')).toBeNull();

    await fireEvent.press(screen.getByText('Back to the day'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renames and recolors a category', async () => {
    const { saved } = await setup();
    await fireEvent.press(screen.getByLabelText('Deep work, Blue'));
    await fireEvent.changeText(screen.getByLabelText('Name'), '  Focus ');
    await fireEvent.press(screen.getByRole('radio', { name: 'Indigo' }));
    await fireEvent.press(screen.getByText('Done'));

    expect(await screen.findByLabelText('Focus, Indigo')).toBeTruthy();
    expect(await saved('deep')).toMatchObject({ label: 'Focus', color: 'indigo' });
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('refuses an empty or a taken name and keeps the editor open', async () => {
    const { saved } = await setup();
    await fireEvent.press(screen.getByLabelText('Deep work, Blue'));
    await fireEvent.changeText(screen.getByLabelText('Name'), ' ');
    await fireEvent.press(screen.getByText('Done'));
    expect(screen.getByText('A category needs a name.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Name'), 'admin');
    await fireEvent.press(screen.getByText('Done'));
    expect(screen.getByText('You already have a category called Admin.')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect((await saved('deep')).label).toBe('Deep work');
  });

  it('reorders from the rows, with the arrows at their right', async () => {
    const { store } = await setup();
    const order = async () => (await store.listCategories()).sort((a, b) => a.position - b.position).map((c) => c.id);

    // Nothing has to be opened. The first cannot go up, the last cannot go down.
    expect(screen.getByRole('button', { name: 'Move Deep work up' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Move Drift down' })).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.press(screen.getByRole('button', { name: 'Move Deep work down' }));
    expect((await order()).slice(0, 2)).toEqual(['admin', 'deep']);
    expect(screen.getByRole('button', { name: 'Move Deep work up' })).not.toHaveAttribute('aria-disabled', 'true');

    // An open editor stays on the category that moved.
    await fireEvent.press(screen.getByLabelText('Learning, Plum'));
    await fireEvent.press(screen.getByRole('button', { name: 'Move Learning up' }));
    expect((await order()).slice(0, 3)).toEqual(['admin', 'learn', 'deep']);
    expect(screen.getByLabelText('Name').value).toBe('Learning');
  });

  it('archives a category and restores it', async () => {
    const { saved } = await setup();
    await fireEvent.press(screen.getByLabelText('Drift, Rose'));
    await fireEvent.press(screen.getByText('Archive'));

    expect(await screen.findByText('Archived')).toBeTruthy();
    expect(screen.queryByLabelText('Drift, Rose')).toBeNull();
    expect((await saved('drift')).archived).toBe(true);

    await fireEvent.press(screen.getByLabelText('Restore Drift'));
    expect(await screen.findByLabelText('Drift, Rose')).toBeTruthy();
    expect(screen.queryByText('Archived')).toBeNull();
  });

  it('adds a category with the first unused color picked for it', async () => {
    const { saved } = await setup();
    await fireEvent.press(screen.getByText('Add a category'));
    expect(screen.getByText('Color: Sky')).toBeTruthy();

    await fireEvent.press(screen.getByText('Add'));
    expect(screen.getByText('A category needs a name.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Name'), 'Errands');
    await fireEvent.changeText(screen.getByLabelText('Icon'), '\u{1F6D2} cart');
    await fireEvent.press(screen.getByRole('radio', { name: 'Olive' }));
    await fireEvent.press(screen.getByText('Add'));

    expect(await screen.findByLabelText('Errands, Olive')).toBeTruthy();
    // The icon is cut to its one emoji and shown in front of the name.
    expect(screen.getByText('\u{1F6D2} Errands')).toBeTruthy();
    expect(await saved('cnew000001')).toMatchObject({ label: 'Errands', icon: '\u{1F6D2}', color: 'olive', position: 8 });
    expect(screen.getByText('Add a category')).toBeTruthy();
  });

  it('gives a category an icon and takes it off again', async () => {
    const { saved } = await setup();
    await fireEvent.press(await screen.findByLabelText('Body, Moss'));
    await fireEvent.changeText(screen.getByLabelText('Icon'), '\u{1F3C3}');
    await fireEvent.press(screen.getByText('Done'));
    expect((await saved('body')).icon).toBe('\u{1F3C3}');
    expect(screen.getByText('\u{1F3C3} Body')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Body, Moss'));
    await fireEvent.changeText(screen.getByLabelText('Icon'), '');
    await fireEvent.press(screen.getByText('Done'));
    expect((await saved('body')).icon).toBe('');
  });

  it('says so when every category is archived', async () => {
    const none = new MemoryStore([], []);
    await setup(none);
    expect(screen.getByText('No categories yet. Add one to tag hours and lines of the pad with it.')).toBeTruthy();
  });

  it('undoes a change the store rejects and says why', async () => {
    const { store } = await setup();
    store.putCategory = () => Promise.reject(new Error('disk full'));
    await fireEvent.press(screen.getByLabelText('Deep work, Blue'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Moss' }));

    expect(await screen.findByText('That change was not saved and has been undone: disk full')).toBeTruthy();
    expect(screen.getByLabelText('Deep work, Blue')).toBeTruthy();
  });
});
