import { vi } from 'vitest';
import { fireEvent as dom } from '@testing-library/react';
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
  return { day };
}

describe('the pad\'s lines in an hour', () => {
  it('counts the lines assigned to an hour, done out of all, on its row', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank'), id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
      cmdSlotDone(id('call the bank'), true);
    });
    // The hour has no plan of its own, so it is drawn with its first open line's.
    expect(screen.getByLabelText('2pm, now: planned send invoice, 1 of 2 items done')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    // An hour with nothing assigned says nothing about items.
    expect(screen.getByLabelText('1pm: blank')).toBeTruthy();
  });

  it('adds the lines crossed out during an hour that were not assigned to it, cleared ones too', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
      cmdSlotDone(id('call the bank'), true);
      // Crossed out at 2:25pm (the clock) without an hour of its own, then cleared.
      const t = clock().toISOString();
      usePad.setState((s) => {
        const r = { ...s.all[id('buy milk')]!, done: true, doneAt: t, deletedAt: t };
        return { all: { ...s.all, [r.id]: r } };
      });
    });
    expect(screen.getByLabelText('2pm, now: planned call the bank, 1 of 1 item done, 1 more done')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('ticks a line, takes one out and adds a new one from the open hour', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank'), id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
    });
    await fireEvent.press(screen.getByLabelText('2pm, now: planned call the bank, 0 of 2 items done'));
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

describe('finding a line for an hour', () => {
  it('searches every pad as the item field is typed in and puts a line found in the hour', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank')]);
      cmdSetSlot(slotKey('2026-11-19', 9));
    });
    await fireEvent.press(screen.getByLabelText('2pm, now: blank'));
    await fireEvent.changeText(screen.getByLabelText('Add an item to this hour'), 'BAN');
    // A line in another hour says where it is now.
    const found = screen.getByRole('option', { name: /^Put “call the bank” in this hour, now in .*9am$/ });
    expect(screen.queryByRole('option', { name: /buy milk/ })).toBeNull();
    await fireEvent.press(found);
    expect(all()[id('call the bank')]!.slot).toBe('2026-11-19T14');
    expect(screen.getByText('Items: 0 of 1 done')).toBeTruthy();
    // The field is cleared, and a line already in the hour is not offered again.
    await fireEvent.changeText(screen.getByLabelText('Add an item to this hour'), 'bank');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('puts the find the arrow keys are on with Return, and adds a new line without one', async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText('2pm, now: blank'));
    const field = screen.getByLabelText('Add an item to this hour');
    await fireEvent.changeText(field, 'in');
    expect(screen.getAllByRole('option')).toHaveLength(1); // send invoice
    await act(async () => {
      dom.keyDown(field, { key: 'ArrowDown' });
    });
    expect(screen.getByRole('option', { name: /send invoice/ })).toHaveAttribute('aria-selected', 'true');
    await act(async () => {
      dom.keyDown(field, { key: 'Enter' });
    });
    expect(all()[id('send invoice')]!.slot).toBe('2026-11-19T14');
    expect(Object.values(all()).filter((r) => r.text === 'in')).toHaveLength(0);
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

  it('picks a run of hours with two taps, across midnight too', async () => {
    const onPick = vi.fn();
    await render(<SlotPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />);
    await fireEvent.press(screen.getByRole('switch', { name: 'Several hours' }));
    await fireEvent.press(screen.getByRole('radio', { name: '4pm' }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText('From Today 4pm: tap the last hour.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: '2pm, now' }));
    expect(onPick).toHaveBeenLastCalledWith('2026-11-19T14+3');

    await fireEvent.press(screen.getByRole('radio', { name: '10pm' }));
    await fireEvent.press(screen.getByLabelText('The day after'));
    await fireEvent.press(screen.getByRole('radio', { name: '1am' }));
    expect(onPick).toHaveBeenLastCalledWith('2026-11-19T22+4');
  });

  it('opens a run with its hours checked and Several hours on', async () => {
    await render(<SlotPicker value="2026-11-19T14+2" onPick={() => {}} onCancel={() => {}} clock={clock} />);
    expect(screen.getByRole('switch', { name: 'Several hours' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '2pm, now' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '3pm' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '4pm' })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('a line in a run of hours', () => {
  it('counts on every hour of the run', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank')]);
      cmdSetSlot(slotKey('2026-11-19', 13, 3));
    });
    expect(screen.getByLabelText('1pm: blank, planned call the bank, 0 of 1 item done')).toBeTruthy();
    expect(screen.getByLabelText('2pm, now: planned call the bank, 0 of 1 item done')).toBeTruthy();
    expect(screen.getByLabelText('3pm: planned call the bank, 0 of 1 item done')).toBeTruthy();
    expect(screen.getByLabelText('4pm: not yet')).toBeTruthy();
  });
});

describe('an hour with no plan of its own', () => {
  it('is drawn with its first line, and keeps it once the hour is marked', async () => {
    const { day } = await setup();
    await act(async () => {
      select([id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
    });
    await fireEvent.press(screen.getByLabelText('2pm, now: planned send invoice, 0 of 1 item done'));
    expect(screen.getByText('Planned from its first line, with no category')).toBeTruthy();
    // Nothing is stored until the hour is written to.
    expect(day.getState().byHour[14]).toBeUndefined();

    await fireEvent.press(screen.getByLabelText('2pm, now: planned send invoice, 0 of 1 item done'));
    await fireEvent.press(screen.getByRole('checkbox', { name: '2pm done as planned' }));
    expect(day.getState().byHour[14]).toMatchObject({ plannedNote: 'send invoice', note: 'send invoice' });
    // Pinned: the line leaving the hour takes nothing from it.
    await act(async () => cmdSetSlot(null, [id('send invoice')]));
    expect(day.getState().byHour[14]).toMatchObject({ plannedNote: 'send invoice' });
  });
});
