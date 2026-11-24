import { vi } from 'vitest';
import { fireEvent as dom } from '@testing-library/react';
import { idOf, slotCounts, slotKey } from '@hissypad/core';
import { dayDate, MemoryStore } from '@hissypad/core/hours';
import { cmdDeleteSelection, loadPad, resetStore, select, usePad } from '@hissypad/state';
import { cmdApplySlot, cmdSetSlot, setSlotPickerOpener, cmdSlotBreak, cmdSlotDone, cmdSlotText, createCategoryStore, createDayStore, createFlagStore, openHours } from '@hissypad/state/hours';

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
    // No summary was typed, so the row says its first line as the pad has them, crossed
    // out or not: an hour keeps no order of its own.
    expect(screen.getByLabelText('2pm, now: call the bank, 1 of 2 items done')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    // An hour with nothing assigned says nothing about items.
    expect(screen.getByLabelText('1pm: blank')).toBeTruthy();
  });

  it('counts only the lines put in the hour, not what is under them', async () => {
    const { day } = await setup();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice'), id('buy milk')]);
    });
    expect(screen.getByLabelText('2pm, now: send invoice, 0 of 2 items done')).toBeTruthy();
    // Nothing is stored on the hour until it is written to.
    expect(day.getState().byHour[14]).toBeUndefined();

    await act(async () => {
      cmdSlotText(cmdSlotBreak(id('send invoice'), true), 'find the PO number');
      cmdSlotText(cmdSlotBreak(id('send invoice'), true), 'export the PDF');
      cmdSlotDone(id('export the PDF'), true);
      cmdSlotDone(id('buy milk'), true);
    });
    // The lines under one are in the hour's list. They are not counted, nor as extra.
    expect(screen.getByLabelText('2pm, now: send invoice, 1 of 2 items done')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select “export the PDF”, done' })).toBeTruthy();
    expect(screen.queryByText(/^\+/)).toBeNull();

    // Done is the hour's own, said by hand; the line stays what the row shows.
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

  it('is a small pad: a bullet selects its line, and the drawer at the foot acts on the selection', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank'), id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
    });
    // The hour in progress is open: its lines are listed, and nothing else of the pad.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByLabelText('Line: buy milk')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Selected lines' })).toBeNull();

    // A bullet selects. It does not cross the line out.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Select “send invoice”' }));
    expect(all()[id('send invoice')]!.done).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Select “send invoice”', checked: true })).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'This line: Done' }));
    expect(all()[id('send invoice')]!.done).toBe(true);
    expect(screen.getByLabelText('2pm, now: call the bank, 1 of 2 items done')).toBeTruthy();

    // More bullets add to the selection: the switch lights no side for a mixed set, and
    // sets them all.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Select “call the bank”' }));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /^These lines/, checked: true })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'These lines: Doing' }));
    expect(all()[id('call the bank')]).toMatchObject({ doing: true });
    expect(all()[id('send invoice')]).toMatchObject({ doing: true, done: false });

    // The same bullet again takes its line out of the selection; the drawer's x clears it.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Select “send invoice”, doing' }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Take this line out of the hour'));
    expect(all()[id('call the bank')]!.slot).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('toolbar', { name: 'Selected lines' })).toBeNull();
  });

  it('moves the selected lines to another hour through the pad\'s picker', async () => {
    await setup();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice'), id('buy milk')]);
    });
    const asked: (readonly string[])[] = [];
    setSlotPickerOpener((ids) => asked.push(ids));
    try {
      await fireEvent.press(screen.getByRole('checkbox', { name: 'Select “buy milk”' }));
      await fireEvent.press(screen.getByLabelText('Move this line to another hour'));
      expect(asked).toEqual([[id('buy milk')]]);
      // The picker's answer moves the line: it leaves this hour's list.
      await act(async () => {
        cmdApplySlot(slotKey('2026-11-19', 16));
      });
      expect(all()[id('buy milk')]!.slot).toBe('2026-11-19T16');
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.queryByRole('toolbar', { name: 'Selected lines' })).toBeNull();
    } finally {
      setSlotPickerOpener(null);
    }
  });

  it('puts a new item at the top of Today, already in the hour', async () => {
    await setup();
    await fireEvent.changeText(screen.getByLabelText('Add an item to this hour'), 'renew passport');
    await fireEvent.press(screen.getByLabelText('Add the item'));
    const made = all()[id('renew passport')]!;
    expect(made.slot).toBe('2026-11-19T14');
    expect(all()[made.parentId!]).toMatchObject({ pad: true, text: 'Today' });
    expect(slotCounts(all())).toEqual({ '2026-11-19T14': { done: 0, open: 1 } });
    // Each top line still has its own way out of the hour.
    await fireEvent.press(screen.getByLabelText('Take “renew passport” out of this hour'));
    expect(all()[made.id]!.slot).toBeNull();
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

  it('offers the drawer for the line being typed, and typing ends a selection', async () => {
    await setup();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice'), id('buy milk')]);
    });
    await act(async () => {
      dom.focus(screen.getByLabelText('Line: send invoice'));
    });
    expect(screen.getByText('This line')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'This line: Doing' }));
    expect(all()[id('send invoice')]).toMatchObject({ doing: true, done: false });
    expect(screen.getByRole('checkbox', { name: 'Select “send invoice”, doing' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'This line: Open' }));
    expect(all()[id('send invoice')]).toMatchObject({ doing: false, done: false });

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Select “buy milk”' }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    await act(async () => {
      dom.focus(screen.getByLabelText('Line: send invoice'));
    });
    expect(screen.getByRole('checkbox', { name: 'Select “buy milk”', checked: false })).toBeTruthy();
    expect(screen.getByText('This line')).toBeTruthy();
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
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Select “send invoice”, archived' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'This line: Done' }));
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
    expect(screen.getByRole('checkbox', { name: 'Select “call the bank”' })).toBeTruthy();
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
    // Nothing is picked yet, so there is nothing to confirm.
    expect(screen.getByRole('button', { name: 'Pick an hour' })).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.press(screen.getByLabelText('The day after'));
    await fireEvent.press(screen.getByRole('radio', { name: '9am' }));
    // A pick is shown, not sent: the hour is checked and the button says it.
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '9am' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Picked Fri, Nov 20, 9am. Pick again to change it.')).toBeTruthy();
    // Another pick replaces it; the button confirms the last one.
    await fireEvent.press(screen.getByRole('radio', { name: '10am' }));
    expect(screen.getByRole('radio', { name: '9am' })).toHaveAttribute('aria-checked', 'false');
    await fireEvent.press(screen.getByRole('button', { name: 'Put in Fri, Nov 20, 10am' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('2026-11-20T10');
  });

  it('shows the day on one line and jumps to a day picked from the calendar', async () => {
    const onPick = vi.fn();
    await render(<SlotPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />);
    const days = screen.getByRole('navigation', { name: 'Days' });
    expect(days).toHaveTextContent('Today');
    expect(days).toHaveTextContent(dayDate('2026-11-19'));
    await fireEvent.press(screen.getByLabelText('Pick a day'));
    await fireEvent.press(screen.getByLabelText(dayDate('2026-11-27')));
    expect(screen.queryByLabelText('Later month')).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: '9am' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Put in/ }));
    expect(onPick).toHaveBeenCalledWith('2026-11-27T09');
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
    // The run is shown, its hours checked, and waits for the button.
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: '4pm' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Put in Today 2pm-5pm' })).toBeTruthy();
    // Backwards: the run starts at the earlier hour, and replaces the first.
    await swipe(17, 11);
    await fireEvent.press(screen.getByRole('button', { name: 'Put in Today 11am-6pm' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenLastCalledWith('2026-11-19T11+7');
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
    await fireEvent.press(screen.getByRole('button', { name: 'Put in Today 2pm-5pm' }));
    expect(onPick).toHaveBeenLastCalledWith('2026-11-19T14+3');
  });

  it('draws the hours as four rows of six on a narrow window, and swipes down the rows', async () => {
    // react-native-web reads the window's width from the document's.
    const width = (value: number) => Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value });
    width(375);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    try {
      const onPick = vi.fn();
      await render(<SlotPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />);
      // Each box says its hour, since a row has room for it.
      expect(screen.getByText('2pm')).toBeTruthy();
      // The rows are 66px tall with 4px between; the day is given 300px of width, 50 a box.
      const grid = screen.getByRole('radiogroup', { name: 'Hour' });
      Object.defineProperty(grid, 'offsetWidth', { configurable: true, value: 300 });
      const at = (place: number) => ({ x: (place % 6) * 50 + 25, y: Math.floor(place / 6) * 70 + 30 });
      const point = (p: number, buttons: number) => ({ clientX: at(p).x, clientY: at(p).y, pageX: at(p).x, pageY: at(p).y, button: 0, buttons });
      const cell = screen.getAllByRole('radio')[10]!;
      await act(async () => {
        dom.mouseDown(cell, point(10, 1));
        await new Promise((done) => setTimeout(done, 10));
        dom.mouseMove(cell, point(13, 1));
        dom.mouseUp(cell, point(13, 0));
      });
      await fireEvent.press(screen.getByRole('button', { name: 'Put in Today 10am-2pm' }));
      expect(onPick).toHaveBeenCalledWith('2026-11-19T10+4');
    } finally {
      width(0);
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });
    }
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
      expect(screen.getByRole('navigation', { name: 'Days' })).toHaveTextContent('TodayThu, Nov 19');
      // An hour after midnight is still Thursday's, and is stored under Friday.
      await fireEvent.press(screen.getByRole('radio', { name: '1am' }));
      await fireEvent.press(screen.getByRole('button', { name: /^Put in/ }));
      expect(onPick).toHaveBeenCalledWith('2026-11-20T01');
      // A swipe across midnight is one run, from the hour it starts at.
      await swipe(17, 19);
      await fireEvent.press(screen.getByRole('button', { name: /^Put in/ }));
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
      expect(screen.getByRole('navigation', { name: 'Days' })).toHaveTextContent('TomorrowFri, Nov 20');
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
