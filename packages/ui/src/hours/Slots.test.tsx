import { vi } from 'vitest';
import { fireEvent as dom } from '@testing-library/react';
import { idOf, slotCounts, slotKey } from '@hissypad/core';
import { MemoryStore } from '@hissypad/core/hours';
import { cmdDeleteSelection, loadPad, resetStore, select, usePad } from '@hissypad/state';
import { cmdSetSlot, cmdSlotBreak, cmdSlotDone, cmdSlotText, createCategoryStore, createDayStore, createFlagStore, openHours } from '@hissypad/state/hours';

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
  it('shows the line on top of an hour on its row, and counts the hour\'s lines done out of all', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank'), id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
      cmdSlotDone(id('call the bank'), true);
    });
    // No summary was typed, so the row says its first open line.
    expect(screen.getByLabelText('2pm, now: send invoice, 1 of 2 items done')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    // An hour with nothing assigned says nothing about items.
    expect(screen.getByLabelText('1pm: blank')).toBeTruthy();
  });

  it('counts the lines under an hour\'s one line: the big item worked through', async () => {
    const { day } = await setup();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice')]);
    });
    expect(screen.getByLabelText('2pm, now: send invoice, 0 of 1 item done')).toBeTruthy();
    // Nothing is stored on the hour until it is written to.
    expect(day.getState().byHour[14]).toBeUndefined();

    await act(async () => {
      cmdSlotText(cmdSlotBreak(id('send invoice'), true), 'find the PO number');
      cmdSlotText(cmdSlotBreak(id('send invoice'), true), 'export the PDF');
      cmdSlotDone(id('export the PDF'), true);
    });
    expect(screen.getByLabelText('2pm, now: send invoice, 1 of 2 items done')).toBeTruthy();
    // The lines under it are in the hour\'s list, and are not counted again as extra.
    expect(screen.getByRole('checkbox', { name: 'export the PDF', checked: true })).toBeTruthy();
    expect(screen.queryByText(/^\+/)).toBeNull();

    // Done is the hour\'s own, said by hand; the line stays what the row shows.
    await fireEvent.press(screen.getByRole('radio', { name: '2pm: Done' }));
    expect(screen.getByLabelText('2pm, now: send invoice, done, 1 of 2 items done')).toBeTruthy();
    expect(day.getState().byHour[14]).toMatchObject({ state: 'done', note: '', plannedNote: '' });
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
    expect(screen.getByLabelText('2pm, now: call the bank, 1 of 1 item done, 1 more done')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('is a small pad: crosses a line out, takes one out of the hour and adds a new one', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank'), id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
    });
    // The hour in progress is open: its lines are listed, and nothing else of the pad.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByLabelText('Line: buy milk')).toBeNull();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'send invoice' }));
    expect(all()[id('send invoice')]!.done).toBe(true);
    expect(screen.getByLabelText('2pm, now: call the bank, 1 of 2 items done')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Take “call the bank” out of this hour'));
    expect(all()[id('call the bank')]!.slot).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await fireEvent.changeText(screen.getByLabelText('Add an item to this hour'), 'renew passport');
    await fireEvent.press(screen.getByLabelText('Add the item'));
    expect(all()[id('renew passport')]!.slot).toBe('2026-11-19T14');
    expect(slotCounts(all())).toEqual({ '2026-11-19T14': { done: 1, open: 1 } });
  });

  it('types into a line, starts new ones under it with Return, and moves them with Tab', async () => {
    await setup();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice')]);
    });
    const invoice = id('send invoice');
    await fireEvent.changeText(screen.getByLabelText('Line: send invoice'), 'send the invoice');
    expect(all()[invoice]!.text).toBe('send the invoice');

    // Return on the hour's own line starts a line under it; Return there, one after it.
    const key = async (label: string, init: object) => {
      await act(async () => {
        dom.keyDown(screen.getByLabelText(label), init);
      });
    };
    await key('Line: send the invoice', { key: 'Enter' });
    await fireEvent.changeText(screen.getByLabelText('Line: An empty line'), 'find the PO number');
    await key('Line: find the PO number', { key: 'Enter' });
    await fireEvent.changeText(screen.getByLabelText('Line: An empty line'), 'export the PDF');
    const po = id('find the PO number');
    const pdf = id('export the PDF');
    expect(all()[po]!.parentId).toBe(invoice);
    expect(all()[pdf]!.parentId).toBe(invoice);
    expect(screen.getAllByRole('listitem').map((el) => el.querySelector('textarea')!.value)).toEqual(['send the invoice', 'find the PO number', 'export the PDF']);

    // Tab puts a line under the one above it, Shift+Tab brings it back, and never past
    // the hour's own line.
    await key('Line: export the PDF', { key: 'Tab' });
    expect(all()[pdf]!.parentId).toBe(po);
    await key('Line: export the PDF', { key: 'Tab', shiftKey: true });
    expect(all()[pdf]!.parentId).toBe(invoice);
    await key('Line: export the PDF', { key: 'Tab', shiftKey: true });
    expect(all()[pdf]!.parentId).toBe(invoice);

    // Backspace on an empty line takes it away.
    await key('Line: export the PDF', { key: 'Enter' });
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    await key('Line: An empty line', { key: 'Backspace' });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('puts the line being typed in one of three states from the switch under the list', async () => {
    await setup();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice')]);
    });
    // The switch is for a line: there is none until one is being typed in.
    expect(screen.queryByRole('radio', { name: 'This line: Doing' })).toBeNull();
    await act(async () => {
      dom.focus(screen.getByLabelText('Line: send invoice'));
    });
    await fireEvent.press(screen.getByRole('radio', { name: 'This line: Doing' }));
    expect(all()[id('send invoice')]).toMatchObject({ doing: true, done: false });
    expect(screen.getByRole('checkbox', { name: 'send invoice, doing' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'This line: Done' }));
    expect(all()[id('send invoice')]).toMatchObject({ doing: false, done: true });
    await fireEvent.press(screen.getByRole('radio', { name: 'This line: Open' }));
    expect(all()[id('send invoice')]).toMatchObject({ doing: false, done: false });
  });

  it('keeps an archived line in its hour, marked archived, and crosses it out there', async () => {
    await setup();
    const invoice = id('send invoice');
    await act(async () => {
      select([id('call the bank'), invoice]);
      cmdSetSlot(slotKey('2026-11-19', 14));
      select([invoice]);
      cmdDeleteSelection();
    });
    expect(all()[invoice]!.deletedAt).not.toBeNull();
    expect(screen.getByLabelText('2pm, now: call the bank, 0 of 2 items done')).toBeTruthy();
    expect(screen.getAllByText('archived')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'send invoice, archived' }));
    expect(all()[invoice]!.done).toBe(true);
    expect(screen.getByLabelText('2pm, now: call the bank, 1 of 2 items done')).toBeTruthy();
  });

  it('puts items into an hour that has not come', async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText('5pm: not yet'));
    await fireEvent.changeText(screen.getByLabelText('Add an item to this hour'), 'pack for the trip');
    await fireEvent.press(screen.getByLabelText('Add the item'));
    expect(all()[id('pack for the trip')]!.slot).toBe('2026-11-19T17');
    expect(screen.getByLabelText('5pm: pack for the trip, 0 of 1 item done')).toBeTruthy();
  });
});

describe('finding a line for an hour', () => {
  it('searches every pad as the item field is typed in and puts a line found in the hour', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank')]);
      cmdSetSlot(slotKey('2026-11-19', 9));
    });
    await fireEvent.changeText(screen.getByLabelText('Add an item to this hour'), 'BAN');
    // A line in another hour says where it is now.
    const found = screen.getByRole('option', { name: /^Put “call the bank” in this hour, now in .*9am$/ });
    expect(screen.queryByRole('option', { name: /buy milk/ })).toBeNull();
    await fireEvent.press(found);
    expect(all()[id('call the bank')]!.slot).toBe('2026-11-19T14');
    expect(screen.getByRole('checkbox', { name: 'call the bank' })).toBeTruthy();
    // The field is cleared, and a line already in the hour is not offered again.
    await fireEvent.changeText(screen.getByLabelText('Add an item to this hour'), 'bank');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('puts the find the arrow keys are on with Return, and adds a new line without one', async () => {
    await setup();
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

  // A swipe as the mouse makes it: down on one hour, moved, up. jsdom has no layout, so the
  // line is given its place: at the page's corner, 480px wide, so each of its 24 boxes
  // takes 20px. The line reads its place on the next tick.
  const at = (place: number) => ({ x: place * 20 + 10, y: 20 });
  const swipe = async (from: number, to: number) => {
    const grid = screen.getByRole('radiogroup', { name: 'Hour' });
    Object.defineProperty(grid, 'offsetWidth', { configurable: true, value: 480 });
    const cell = screen.getAllByRole('radio')[from]!;
    const point = (h: number, buttons: number) => ({ clientX: at(h).x, clientY: at(h).y, pageX: at(h).x, pageY: at(h).y, button: 0, buttons });
    await act(async () => {
      dom.mouseDown(cell, point(from, 1));
      await new Promise((done) => setTimeout(done, 10));
      dom.mouseMove(cell, point(to, 1));
      dom.mouseUp(cell, point(to, 0));
    });
  };

  it('picks a run of hours with a swipe across them, either way', async () => {
    const onPick = vi.fn();
    await render(<SlotPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />);
    expect(screen.getByText('Tap an hour, or swipe across several.')).toBeTruthy();
    await swipe(14, 16);
    expect(onPick).toHaveBeenLastCalledWith('2026-11-19T14+3');
    // Backwards: the run starts at the earlier hour.
    await swipe(17, 11);
    expect(onPick).toHaveBeenLastCalledWith('2026-11-19T11+7');
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  // The web dialog holds focus as it opens. A browser moves focus to what a mouse presses
  // unless the press is default-prevented, and the blur of an ancestor ended the swipe.
  it('swipes with a mouse while the box around the picker holds focus', async () => {
    const onPick = vi.fn();
    await render(
      <div tabIndex={-1} aria-label="Pick an hour">
        <SlotPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />
      </div>,
    );
    screen.getByLabelText('Pick an hour').focus();
    const cell = screen.getAllByRole('radio')[14]!;
    const moveFocus = (event: MouseEvent) => {
      if (!event.defaultPrevented) cell.focus();
    };
    document.addEventListener('mousedown', moveFocus);
    try {
      await swipe(14, 16);
    } finally {
      document.removeEventListener('mousedown', moveFocus);
    }
    expect(onPick).toHaveBeenLastCalledWith('2026-11-19T14+3');
  });

  it('opens a run with its hours checked', async () => {
    await render(<SlotPicker value="2026-11-19T14+2" onPick={() => {}} onCancel={() => {}} clock={clock} />);
    expect(screen.getByRole('radio', { name: '2pm, now' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '3pm' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '4pm' })).toHaveAttribute('aria-checked', 'false');
  });

  it('starts its line of hours at the hour the day starts at', async () => {
    const stores = await openHours();
    await act(async () => {
      await stores.day.getState().setStart(6);
    });
    try {
      const onPick = vi.fn();
      await render(<SlotPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />);
      const hours = screen.getAllByRole('radio').map((el) => el.getAttribute('aria-label'));
      expect(hours.slice(0, 3)).toEqual(['6am', '7am', '8am']);
      expect(hours.at(-1)).toBe('5am');
      expect(screen.getByText('Today, Thu, Nov 19')).toBeTruthy();
      // An hour after midnight is still Thursday's, and is stored under Friday.
      await fireEvent.press(screen.getByRole('radio', { name: '1am' }));
      expect(onPick).toHaveBeenCalledWith('2026-11-20T01');
      // A swipe across midnight is one run, from the hour it starts at.
      await swipe(17, 19);
      expect(onPick).toHaveBeenLastCalledWith('2026-11-19T23+3');
    } finally {
      await act(async () => {
        await stores.day.getState().setStart(0);
      });
    }
  });

  it('opens on the day a line after midnight belongs to', async () => {
    const stores = await openHours();
    await act(async () => {
      await stores.day.getState().setStart(6);
    });
    try {
      await render(<SlotPicker value="2026-11-21T02" onPick={() => {}} onCancel={() => {}} clock={clock} />);
      expect(screen.getByText('Tomorrow, Fri, Nov 20')).toBeTruthy();
      expect(screen.getByRole('radio', { name: '2am' })).toHaveAttribute('aria-checked', 'true');
    } finally {
      await act(async () => {
        await stores.day.getState().setStart(0);
      });
    }
  });
});

describe('a line in a run of hours', () => {
  it('counts on every hour of the run', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank')]);
      cmdSetSlot(slotKey('2026-11-19', 13, 3));
    });
    expect(screen.getByLabelText('1pm: call the bank, 0 of 1 item done')).toBeTruthy();
    expect(screen.getByLabelText('2pm, now: call the bank, 0 of 1 item done')).toBeTruthy();
    expect(screen.getByLabelText('3pm: call the bank, 0 of 1 item done')).toBeTruthy();
    expect(screen.getByLabelText('4pm: not yet')).toBeTruthy();
  });
});
