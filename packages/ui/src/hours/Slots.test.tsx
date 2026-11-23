import { vi } from 'vitest';
import { idOf, slotCounts, slotKey } from '@hissypad/core';
import { MemoryStore } from '@hissypad/core/hours';
import { loadPad, resetStore, select, usePad } from '@hissypad/state';
import { cmdSetSlot, cmdSlotDone, createCategoryStore, createDayStore, createFlagStore } from '@hissypad/state/hours';

import { act, fireEvent, render, screen } from '../testing/rntl';
import { DayScreen } from './DayScreen';
import { StoresProvider } from './provider';
import { SlotPicker } from './SlotPicker';

// Thursday 2026-11-19, 14:25 local: 2pm is in progress.
const clock = () => new Date(2026, 10, 19, 14, 25);
const all = () => usePad.getState().all;
const id = (text: string) => idOf(all(), text);

async function setup() {
  resetStore('call the bank\nsend invoice\nbuy milk');
  await loadPad();
  const store = new MemoryStore();
  const day = createDayStore(store, clock);
  const categories = createCategoryStore(store);
  const flags = createFlagStore(store);
  await categories.getState().load();
  await flags.getState().load();
  await render(
    <StoresProvider day={day} categories={categories} flags={flags}>
      <DayScreen clock={clock} />
    </StoresProvider>,
  );
  await screen.findByLabelText('2pm, now: blank');
}

describe('the pad\'s lines in an hour', () => {
  it('counts the lines assigned to an hour, done out of all, on its row', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank'), id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
      cmdSlotDone(id('call the bank'), true);
    });
    expect(screen.getByLabelText('2pm, now: blank, 1 of 2 items done')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    // An hour with nothing assigned says nothing about items.
    expect(screen.getByLabelText('1pm: blank')).toBeTruthy();
  });

  it('ticks a line, takes one out and adds a new one from the open hour', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank'), id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
    });
    await fireEvent.press(screen.getByLabelText('2pm, now: blank, 0 of 2 items done'));
    expect(screen.getByText('Items: 0 of 2 done')).toBeTruthy();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'send invoice' }));
    expect(all()[id('send invoice')]!.done).toBe(true);
    expect(screen.getByText('Items: 1 of 2 done')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Take “call the bank” out of this hour'));
    expect(all()[id('call the bank')]!.slot).toBeNull();
    // Every line left in the hour is done: the row leads with a tick.
    expect(screen.getByText('Items: 1 of 1 done')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Add an item to this hour'), 'renew passport');
    await fireEvent.press(screen.getByLabelText('Add the item'));
    expect(all()[id('renew passport')]!.slot).toBe('2026-11-19T14');
    expect(slotCounts(all())).toEqual({ '2026-11-19T14': { done: 1, open: 1 } });
  });

  it('plans items into an hour that has not come', async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText('5pm: not yet'));
    await fireEvent.changeText(screen.getByLabelText('Add an item to this hour'), 'pack for the trip');
    await fireEvent.press(screen.getByLabelText('Add the item'));
    expect(all()[id('pack for the trip')]!.slot).toBe('2026-11-19T17');
  });
});

describe('SlotPicker', () => {
  it('opens on today, marks the hour in progress and picks an hour of another day', async () => {
    const onPick = vi.fn();
    await render(<SlotPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />);
    expect(screen.getByText('Which hour is this line for?')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '2pm, now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No hour' })).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.press(screen.getByLabelText('The day after'));
    await fireEvent.press(screen.getByRole('radio', { name: '9am' }));
    expect(onPick).toHaveBeenCalledWith('2026-11-20T09');
  });

  it('opens on the hour the lines are in and can take them out of it', async () => {
    const onPick = vi.fn();
    await render(<SlotPicker value="2026-11-21T08" count={3} onPick={onPick} onCancel={() => {}} clock={clock} />);
    expect(screen.getByText('Which hour are these 3 lines for?')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '8am' })).toHaveAttribute('aria-checked', 'true');
    await fireEvent.press(screen.getByRole('button', { name: 'No hour' }));
    expect(onPick).toHaveBeenCalledWith(null);
  });
});
