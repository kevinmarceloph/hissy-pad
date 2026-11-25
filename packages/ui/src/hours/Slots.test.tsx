import { vi } from 'vitest';
import { fireEvent as dom } from '@testing-library/react';
import { idOf, insertAt, slotCounts, slotKey } from '@hissypad/core';
import { dayDate, MemoryStore } from '@hissypad/core/hours';
import { applyAll, cmdDeleteSelection, loadPad, resetStore, select, usePad, zoomTo } from '@hissypad/state';
import { cmdSetSlot, cmdSlotDone, createCategoryStore, createDayStore, createFlagStore, openHours } from '@hissypad/state/hours';

import { act, fireEvent, render, screen, within } from '../testing/rntl';
import { DayScreen } from './DayScreen';
import { LinesContext } from './HostedLines';
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
  it('shows the line on top of an hour on its row, with no count of its lines done out of all', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank'), id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
      cmdSlotDone(id('call the bank'), true);
    });
    // No summary was typed, so the row says its first line as the pad has them, crossed
    // out or not: an hour keeps no order of its own.
    expect(screen.getByLabelText('2pm, now: call the bank')).toBeTruthy();
    expect(screen.queryByText('1/2')).toBeNull();
    // An hour with nothing assigned says nothing about items.
    expect(screen.getByLabelText('1pm: blank')).toBeTruthy();
  });

  it('says the lines put in the hour, not what is under them', async () => {
    const { day } = await setup();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice'), id('buy milk')]);
    });
    expect(screen.getByLabelText('2pm, now: send invoice')).toBeTruthy();
    // Nothing is stored on the hour until it is written to.
    expect(day.getState().byHour[14]).toBeUndefined();

    await act(async () => {
      const invoice = id('send invoice');
      applyAll((rows, ctx) => insertAt(insertAt(rows, ctx, { parentId: invoice, afterId: null }, 'find the PO number').rows, ctx, { parentId: invoice, afterId: null }, 'export the PDF').rows);
      cmdSlotDone(id('export the PDF'), true);
      cmdSlotDone(id('buy milk'), true);
    });
    // The lines under one are not counted, nor as extra.
    expect(screen.getByLabelText('2pm, now: send invoice')).toBeTruthy();
    expect(screen.queryByText(/^✕/)).toBeNull();
    expect(screen.queryByText(/\d\/\d/)).toBeNull();

    // Done is the hour's own, said by hand; the line stays what the row shows.
    await fireEvent.press(screen.getByRole('radio', { name: '2pm: Done' }));
    expect(screen.getByLabelText('2pm, now: send invoice, done')).toBeTruthy();
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
    expect(screen.getByLabelText('2pm, now: call the bank, 1 more done')).toBeTruthy();
    expect(screen.getByText('✕1')).toBeTruthy();
    // The open hour lists it under a heading of its own; its own line is not listed there.
    const list = screen.getByRole('list', { name: 'Lines done in this hour' });
    expect(within(list).getByText('buy milk')).toBeTruthy();
    expect(within(list).queryByText('call the bank')).toBeNull();
  });

  it('puts a new item at the top of Today, already in the hour', async () => {
    await setup();
    await fireEvent.changeText(screen.getByLabelText('Add a line to this hour'), 'renew passport');
    await fireEvent.press(screen.getByLabelText('Add the line'));
    const made = all()[id('renew passport')]!;
    expect(made.slot).toBe('2026-11-19T14');
    expect(all()[made.parentId!]).toMatchObject({ pad: true, text: 'Today' });
    expect(slotCounts(all())).toEqual({ '2026-11-19T14': { done: 0, open: 1 } });
  });

  it('keeps an archived line in its hour, under an Archived heading, and unarchives it from there', async () => {
    await setup();
    const invoice = id('send invoice');
    await act(async () => {
      select([id('call the bank'), invoice]);
      cmdSetSlot(slotKey('2026-11-19', 14));
      cmdSlotDone(invoice, true);
      select([invoice]);
      cmdDeleteSelection();
    });
    expect(all()[invoice]!.deletedAt).not.toBeNull();
    // It still counts: it was the hour's, and it was done.
    expect(screen.getByLabelText('2pm, now: call the bank')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Archived' })).toBeTruthy();
    expect(screen.getByText('send invoice')).toBeTruthy();
    // Its way out is back to its pad, not out of the hour.
    expect(screen.queryByLabelText('Take “send invoice” out of this hour')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Unarchive “send invoice”'));
    expect(all()[invoice]).toMatchObject({ deletedAt: null, slot: '2026-11-19T14', done: true });
    expect(screen.queryByRole('heading', { name: 'Archived' })).toBeNull();
    // Nothing jumps to the line: it is not selected, and the pad that is open stays open.
    expect(usePad.getState().selection).not.toContain(invoice);
    expect(usePad.getState().padId).toBeNull();
  });

  it('puts items into an hour that has not come', async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText('5pm: not yet'));
    await fireEvent.changeText(screen.getByLabelText('Add a line to this hour'), 'pack for the trip');
    await fireEvent.press(screen.getByLabelText('Add the line'));
    expect(all()[id('pack for the trip')]!.slot).toBe('2026-11-19T17');
    expect(screen.getByLabelText('5pm: pack for the trip')).toBeTruthy();
  });
});

describe('finding a line for an hour', () => {
  it('searches every pad as the item field is typed in and puts a line found in the hour', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank')]);
      cmdSetSlot(slotKey('2026-11-19', 9));
    });
    await fireEvent.changeText(screen.getByLabelText('Add a line to this hour'), 'BAN');
    // A line in another hour says where it is now.
    const found = screen.getByRole('option', { name: /^Put “call the bank” in this hour, now in .*9am$/ });
    expect(screen.queryByRole('option', { name: /buy milk/ })).toBeNull();
    await fireEvent.press(found);
    expect(all()[id('call the bank')]!.slot).toBe('2026-11-19T14');
    // The field is cleared, and a line already in the hour is not offered again.
    await fireEvent.changeText(screen.getByLabelText('Add a line to this hour'), 'bank');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('puts the find the arrow keys are on with Return, and adds a new line without one', async () => {
    await setup();
    const field = screen.getByLabelText('Add a line to this hour');
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
    expect(screen.getByLabelText('1pm: call the bank')).toBeTruthy();
    expect(screen.getByLabelText('2pm, now: call the bank')).toBeTruthy();
    expect(screen.getByLabelText('3pm: call the bank')).toBeTruthy();
    expect(screen.getByLabelText('4pm: not yet')).toBeTruthy();
  });
});

describe('an open hour drawn by the host\'s own editor', () => {
  // The host's editor, reduced to what matters here: it draws the store's rows.
  function HostRows() {
    const rows = usePad((s) => s.rows);
    return <p data-testid="host-rows">{Object.values(rows).map((r) => r.text).sort().join(' | ')}</p>;
  }

  async function hosted() {
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
        <LinesContext.Provider value={() => <HostRows />}>
          <DayScreen clock={clock} />
        </LinesContext.Provider>
      </StoresProvider>,
    );
    await screen.findByLabelText('2pm, now: blank');
  }

  it('asks the store to show the hour, and gives the view back when the hour closes', async () => {
    await hosted();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 15), [id('buy milk')]);
    });
    // The hour in progress is open: the store shows it, and the host draws its lines.
    expect(usePad.getState().slotId).toBe('2026-11-19T14');
    expect(screen.getByTestId('host-rows').textContent).toBe('send invoice');
    // The small pad and its drawer are not drawn; the field that brings lines in is.
    expect(screen.queryByRole('checkbox', { name: /^Select/ })).toBeNull();
    expect(screen.getByLabelText('Add a line to this hour')).toBeTruthy();

    // Another hour takes the view; closing it gives the view back to the pad.
    await fireEvent.press(screen.getByLabelText('3pm: buy milk'));
    expect(usePad.getState().slotId).toBe('2026-11-19T15');
    expect(screen.getByTestId('host-rows').textContent).toBe('buy milk');
    await fireEvent.press(screen.getByText('Close'));
    expect(usePad.getState().slotId).toBeNull();
    expect(Object.keys(usePad.getState().rows)).toHaveLength(3);
  });

  it('steps aside while a card zooms into a line, and takes the view back after', async () => {
    await hosted();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice')]);
    });
    await act(async () => {
      zoomTo(id('call the bank'));
    });
    // The card has the store's view: the hour draws no lines over it.
    expect(screen.queryByTestId('host-rows')).toBeNull();
    await act(async () => {
      zoomTo(null);
    });
    expect(usePad.getState().slotId).toBe('2026-11-19T14');
    expect(screen.getByTestId('host-rows').textContent).toBe('send invoice');
  });

  it('lists an archived line under the editor, since a view holds live lines only', async () => {
    await hosted();
    const invoice = id('send invoice');
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('call the bank'), invoice]);
      select([invoice]);
      cmdDeleteSelection();
    });
    expect(screen.getByTestId('host-rows').textContent).toBe('call the bank');
    expect(screen.getByRole('heading', { name: 'Archived' })).toBeTruthy();
    // Unarchived, it is a live line again: the host's editor draws it with the others.
    await fireEvent.press(screen.getByLabelText('Unarchive “send invoice”'));
    expect(all()[invoice]!.deletedAt).toBeNull();
    expect(screen.getByTestId('host-rows').textContent).toBe('call the bank | send invoice');
    expect(screen.queryByRole('heading', { name: 'Archived' })).toBeNull();
  });
});
