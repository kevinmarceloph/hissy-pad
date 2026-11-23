import { vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import { fireEvent, render, screen } from '../testing/rntl';

import { MemoryStore } from '@hissypad/core/hours';
import { createCategoryStore } from '@hissypad/state/hours';
import { createDayStore } from '@hissypad/state/hours';
import { createFlagStore } from '@hissypad/state/hours';
import { StoresProvider } from './provider';
import { createRecurringStore } from '@hissypad/state/hours';

import { RecurringScreen } from './RecurringScreen';

// Saturday 2026-11-21, 10:00 local.
const clock = () => new Date(2026, 10, 21, 10, 0);

async function setup(rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS)) {
  const day = createDayStore(rows, clock);
  const categories = createCategoryStore(rows);
  const flags = createFlagStore(rows);
  const recurring = createRecurringStore(rows, { clock, makeId: () => 'rnew000001' });
  await categories.getState().load();
  await recurring.getState().load();
  const onBack = vi.fn();
  await render(
    <StoresProvider day={day} categories={categories} flags={flags} recurring={recurring}>
      <RecurringScreen onBack={onBack} />
    </StoresProvider>,
  );
  return { rows, recurring, onBack };
}

const sleep = { id: 'rsleep0001', note: 'sleep', category: 'sleep', from: 2, to: 10, days: [0, 1, 2, 3, 4, 5, 6], since: '2026-11-01', position: 0, archived: false, updatedAt: 1 };

describe('RecurringScreen', () => {
  it('adds a plan: words, a category, the hours and the days', async () => {
    const { rows } = await setup();
    expect(screen.getByText(/^No recurring plans\./)).toBeTruthy();
    await fireEvent.press(screen.getByText('Add a recurring plan'));

    // Nothing to save yet: it needs words or a category.
    await fireEvent.press(screen.getByText('Add'));
    expect(screen.getByRole('alert')).toHaveTextContent('Say what the hours are for, or pick a category.');

    await fireEvent.changeText(screen.getByLabelText('What are the hours for?'), 'sleep');
    await fireEvent.press(screen.getByLabelText('Where they should go: None'));
    await fireEvent.press(screen.getByRole('option', { name: 'Sleep' }));

    // Each end of the run opens the hours and closes on a pick.
    await fireEvent.press(screen.getByLabelText('From: 9am'));
    await fireEvent.press(screen.getByRole('radio', { name: 'From 2am' }));
    expect(screen.queryByRole('radio', { name: 'From 2am' })).toBeNull();
    await fireEvent.press(screen.getByLabelText('To: 10am'));
    expect(screen.getByRole('radio', { name: 'To 10am', checked: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'To 10am' }));
    expect(screen.getByText(/^8 hours: 2am-10am\./)).toBeTruthy();

    // Every day to start; Sunday comes off.
    expect(screen.getByText('Days: every day')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Sun', checked: true }));
    expect(screen.getByText('Days: Mon, Tue, Wed, Thu, Fri, Sat')).toBeTruthy();

    await fireEvent.press(screen.getByText('Add'));
    expect(await screen.findByLabelText('Sleep: sleep, 2am-10am, Mon, Tue, Wed, Thu, Fri, Sat')).toBeTruthy();
    expect(await rows.listRecurring()).toEqual([
      { id: 'rnew000001', note: 'sleep', category: 'sleep', from: 2, to: 10, days: [1, 2, 3, 4, 5, 6], since: '2026-11-21', position: 0, archived: false, updatedAt: clock().getTime() },
    ]);
  });

  it('edits a plan as a draft: Cancel drops it, Save writes it', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    await rows.putRecurring(sleep);
    await setup(rows);

    await fireEvent.press(screen.getByLabelText('Sleep: sleep, 2am-10am, every day'));
    await fireEvent.press(screen.getByLabelText('From: 2am'));
    await fireEvent.press(screen.getByRole('radio', { name: 'From 11pm' }));
    // Across midnight: said in words, with which day the run belongs to.
    expect(screen.getByText(/^11 hours: 11pm-10am, into the next day\./)).toBeTruthy();
    expect(screen.getByText(/^A day here is the day the plan starts on/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Cancel'));
    expect((await rows.listRecurring())[0].from).toBe(2);

    await fireEvent.press(screen.getByLabelText('Sleep: sleep, 2am-10am, every day'));
    await fireEvent.press(screen.getByLabelText('To: 10am'));
    await fireEvent.press(screen.getByRole('radio', { name: 'To 9am' }));
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByLabelText('Sleep: sleep, 2am-9am, every day')).toBeTruthy();
    expect((await rows.listRecurring())[0]).toMatchObject({ from: 2, to: 9, since: '2026-11-01' });
  });

  it('reorders from the rows, and has no arrows for a single plan', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    await rows.putRecurring(sleep);
    const { recurring } = await setup(rows);
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();

    await recurring.getState().add({ note: 'nap', category: 'rest', from: 9, to: 10, days: [0, 1, 2, 3, 4, 5, 6] });
    expect(await screen.findByRole('button', { name: 'Move Rest: nap down' })).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.press(screen.getByRole('button', { name: 'Move Rest: nap up' }));
    const order = (await rows.listRecurring()).sort((a, b) => a.position - b.position).map((p) => p.note);
    expect(order).toEqual(['nap', 'sleep']);
    expect(screen.getByRole('button', { name: 'Move Rest: nap up' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('archives a plan and brings it back', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    await rows.putRecurring(sleep);
    const { onBack } = await setup(rows);

    await fireEvent.press(screen.getByLabelText('Sleep: sleep, 2am-10am, every day'));
    await fireEvent.press(screen.getByText('Archive'));
    expect(screen.queryByLabelText('Sleep: sleep, 2am-10am, every day')).toBeNull();
    expect(screen.getByText('Archived')).toBeTruthy();
    expect((await rows.listRecurring())[0].archived).toBe(true);

    await fireEvent.press(screen.getByLabelText('Restore Sleep: sleep'));
    expect(await screen.findByLabelText('Sleep: sleep, 2am-10am, every day')).toBeTruthy();

    await fireEvent.press(screen.getByText('Back to the day'));
    expect(onBack).toHaveBeenCalled();
  });
});
