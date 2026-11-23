import { vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import { fireEvent, render, screen } from '../testing/rntl';

import { MemoryStore } from '@hissypad/core/hours';
import { createCategoryStore } from '@hissypad/state/hours';
import { createDayStore } from '@hissypad/state/hours';
import { createFlagStore } from '@hissypad/state/hours';
import { StoresProvider } from './provider';

import { FlagsScreen } from './FlagsScreen';

async function setup(store = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS)) {
  const flags = createFlagStore(store, { makeId: () => 'fnew000001' });
  await flags.getState().load();
  const onBack = vi.fn();
  await render(
    <StoresProvider day={createDayStore(store)} categories={createCategoryStore(store)} flags={flags}>
      <FlagsScreen onBack={onBack} />
    </StoresProvider>,
  );
  const saved = async (id: string) => (await store.listFlags()).find((f) => f.id === id)!;
  return { store, onBack, saved };
}

describe('FlagsScreen', () => {
  it('lists the flags and goes back', async () => {
    const { onBack } = await setup();
    expect(screen.getByLabelText('Distracted')).toBeTruthy();
    expect(screen.getByLabelText('Mindful')).toBeTruthy();
    expect(screen.getByLabelText('HALTS')).toBeTruthy();
    await fireEvent.press(screen.getByText('Back to the day'));
    expect(onBack).toHaveBeenCalled();
  });

  it('adds a flag, and refuses a name that is empty or taken', async () => {
    const { saved } = await setup();
    await fireEvent.press(screen.getByText('Add a flag'));
    await fireEvent.press(screen.getByText('Add'));
    expect(screen.getByText('A flag needs a name.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Name'), 'mindful');
    await fireEvent.press(screen.getByText('Add'));
    expect(screen.getByText('You already have a flag called Mindful.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Name'), 'In flow');
    await fireEvent.changeText(screen.getByLabelText('Icon'), '🌊');
    await fireEvent.press(screen.getByText('Add'));
    expect(await screen.findByLabelText('In flow')).toBeTruthy();
    expect(await saved('fnew000001')).toMatchObject({ label: 'In flow', icon: '🌊', position: 3 });
  });

  it('renames, archives and restores', async () => {
    const { saved } = await setup();
    await fireEvent.press(screen.getByLabelText('HALTS'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Hungry or tired');
    await fireEvent.press(screen.getByText('Done'));
    expect(await screen.findByLabelText('Hungry or tired')).toBeTruthy();
    expect((await saved('halts')).label).toBe('Hungry or tired');

    // The icon is one emoji; anything typed after it is dropped.
    await fireEvent.press(screen.getByLabelText('Hungry or tired'));
    await fireEvent.changeText(screen.getByLabelText('Icon'), '🍽️ food');
    await fireEvent.press(screen.getByText('Done'));
    expect((await saved('halts')).icon).toBe('🍽️');

    await fireEvent.press(screen.getByLabelText('Mindful'));
    await fireEvent.press(screen.getByText('Archive'));
    expect(await screen.findByText('Archived')).toBeTruthy();
    expect((await saved('mindful')).archived).toBe(true);

    await fireEvent.press(screen.getByLabelText('Restore Mindful'));
    expect((await saved('mindful')).archived).toBe(false);
  });

  it('reorders from the rows, with the arrows at their right', async () => {
    const { store } = await setup();
    expect(screen.getByRole('button', { name: 'Move Distracted up' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Move HALTS down' })).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.press(screen.getByRole('button', { name: 'Move HALTS up' }));
    const order = (await store.listFlags()).sort((a, b) => a.position - b.position).map((f) => f.id);
    expect(order).toEqual(['distracted', 'halts', 'mindful']);
  });

  it('recolors, renames, adds and removes a flag`s options', async () => {
    const { saved } = await setup();
    await fireEvent.press(screen.getByLabelText('HALTS'));
    // Every flag starts with Yes and No.
    expect(screen.getByLabelText('Option Yes, Blue')).toBeTruthy();
    expect(screen.getByLabelText('Option No, Rose')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Option Yes, Blue'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Ochre' }));
    expect((await saved('halts')).options[0]).toEqual({ id: 'yes', label: 'Yes', color: 'ochre' });

    // A name another option has is refused; a free one is saved when the field is left.
    await fireEvent.changeText(screen.getByLabelText('Option name'), 'no');
    await fireEvent.blur(screen.getByLabelText('Option name'));
    expect(screen.getByText('This flag already has an option called No.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Option name'), 'Hungry');
    await fireEvent.blur(screen.getByLabelText('Option name'));
    expect(await screen.findByLabelText('Option Hungry, Ochre')).toBeTruthy();
    expect((await saved('halts')).options[0].label).toBe('Hungry');

    // A new option gets a name of its own and a color nothing else uses, and opens.
    await fireEvent.press(screen.getByText('Add an option'));
    expect(await screen.findByLabelText('Option Option 3, Blue')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Option name'), 'Tired');
    await fireEvent.blur(screen.getByLabelText('Option name'));
    const options = (await saved('halts')).options;
    expect(options.map((o) => o.label)).toEqual(['Hungry', 'No', 'Tired']);
    expect(options[2].id).toMatch(/^o[a-z0-9]{5}$/);

    // Removing archives: the option leaves the list and can be put back.
    await fireEvent.press(screen.getByLabelText('Option No, Rose'));
    await fireEvent.press(screen.getByText('Remove option'));
    expect(screen.queryByLabelText('Option No, Rose')).toBeNull();
    expect((await saved('halts')).options[1]).toMatchObject({ id: 'no', archived: true });
    await fireEvent.press(screen.getByLabelText('Restore option No'));
    expect((await saved('halts')).options[1]).toEqual({ id: 'no', label: 'No', color: 'rose' });
  });

  it('keeps at least one option', async () => {
    const { saved } = await setup();
    await fireEvent.press(screen.getByLabelText('Mindful'));
    await fireEvent.press(screen.getByLabelText('Option No, Rose'));
    await fireEvent.press(screen.getByText('Remove option'));
    await fireEvent.press(screen.getByLabelText('Option Yes, Blue'));
    expect(screen.getByRole('button', { name: 'Remove option' })).toHaveAttribute('aria-disabled', 'true');
    expect((await saved('mindful')).options.filter((o) => !o.archived)).toHaveLength(1);
  });
});
