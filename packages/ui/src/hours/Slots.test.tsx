import { useState } from 'react';
import { vi } from 'vitest';
import { fireEvent as dom } from '@testing-library/react';
import { idOf, insertAt, setDone, slotKey } from '@hissypad/core';
import { dayDate, MemoryStore, type Slot } from '@hissypad/core/hours';
import { applyAll, cmdDeleteSelection, cmdSetText, loadPad, resetStore, select, usePad, zoomTo } from '@hissypad/state';
import { cmdSetSlot, cmdSlotUnarchive, createCategoryStore, createDayStore, createFlagStore, openHours, setSlotFinder } from '@hissypad/state/hours';

import { act, fireEvent, render, screen, within } from '../testing/rntl';
import { DayScreen } from './DayScreen';
import { FocusScreen } from './FocusScreen';
import { LinesContext } from './HostedLines';
import { StoresProvider } from './provider';
import { SlotPicker } from './SlotPicker';

// Thursday 2026-11-19, 14:25 local: 2pm is in progress.
const clock = () => new Date(2026, 10, 19, 14, 25);
const all = () => usePad.getState().all;
const id = (text: string) => idOf(all(), text);
const cross = (line: string) => applyAll((rows, ctx) => setDone(rows, ctx, [line], true, true));

// The host's editor, reduced to what matters here: it draws the store's rows.
function HostRows() {
  const rows = usePad((s) => s.rows);
  return <p data-testid="host-rows">{Object.values(rows).map((r) => r.text).sort().join(' | ')}</p>;
}

// The list of the day's hours and the one-hour screen, both at once (the app shows one or
// the other): a row of the list says what an hour holds, the focus screen is the hour open.
// A tap on a row puts the focus screen on that hour, as in the app.
function Both() {
  const [at, setAt] = useState<Slot | null>(null);
  return (
    <>
      <DayScreen clock={clock} onPick={setAt} />
      <FocusScreen at={at} clock={clock} onList={() => {}} onGo={setAt} onPart={() => {}} />
    </>
  );
}

// `host`: with an editor handed in, as both apps do. Without one an open hour draws no lines.
async function setup(host = false) {
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
      <LinesContext.Provider value={host ? () => <HostRows /> : null}>
        <Both />
      </LinesContext.Provider>
    </StoresProvider>,
  );
  await screen.findByLabelText('2pm, now: blank');
  return { day };
}
const hosted = () => setup(true);

describe('the pad\'s lines in an hour', () => {
  it('titles an hour with its first line and its lines done out of all, and is done when that line is', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank'), id('send invoice'), id('buy milk')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
    });
    // The first line as the pad has them, and how many of the hour's lines are done.
    expect(screen.getByLabelText('2pm, now: call the bank, 0 of 3 done')).toBeTruthy();
    // On the hour's row in the list, and at the foot of the hour's own screen.
    expect(screen.getAllByText('0/3')).toHaveLength(2);
    // A later line crossed out changes nothing about the hour.
    await act(async () => void cross(id('send invoice')));
    expect(screen.getByLabelText('2pm, now: call the bank, 1 of 3 done')).toBeTruthy();
    // First item done = hour done. There is no switch for it.
    await act(async () => void cross(id('call the bank')));
    expect(screen.getByLabelText('2pm, now: call the bank, 2 of 3 done, done')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    // An hour with nothing assigned says nothing about items.
    expect(screen.getByLabelText('1pm: blank')).toBeTruthy();
  });

  it('says the lines put in the hour, not what is under them, and stores nothing on the hour', async () => {
    const { day } = await setup();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice'), id('buy milk')]);
    });
    expect(screen.getByLabelText('2pm, now: send invoice, 0 of 2 done')).toBeTruthy();
    await act(async () => {
      const invoice = id('send invoice');
      applyAll((rows, ctx) => insertAt(insertAt(rows, ctx, { parentId: invoice, afterId: null }, 'find the PO number').rows, ctx, { parentId: invoice, afterId: null }, 'export the PDF').rows);
      cross(id('export the PDF'));
      cross(id('buy milk'));
    });
    // The lines under one are not counted, nor as extra.
    expect(screen.getByLabelText('2pm, now: send invoice, 1 of 2 done')).toBeTruthy();
    expect(screen.queryByText(/^✕/)).toBeNull();
    // The hour has nothing of its own: no summary, no state, no flags to set.
    expect(day.getState().byHour[14]).toBeUndefined();
    expect(screen.queryByText('Summary')).toBeNull();
    expect(screen.queryByText('Flags')).toBeNull();
    expect(screen.queryByText('Clear this hour')).toBeNull();
  });

  it('keeps the lines crossed out during an hour that were not assigned to it behind a text toggle', async () => {
    await setup();
    await act(async () => {
      select([id('call the bank')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
      cross(id('call the bank'));
      // Crossed out at 2:25pm (the clock) without an hour of its own, then cleared.
      const t = clock().toISOString();
      usePad.setState((s) => {
        const r = { ...s.all[id('buy milk')]!, done: true, doneAt: t, deletedAt: t };
        return { all: { ...s.all, [r.id]: r } };
      });
    });
    expect(screen.getByLabelText('2pm, now: call the bank, done, 1 more done')).toBeTruthy();
    // Open, the hour draws no title row: the count is on the toggle at its foot.
    expect(screen.getByText(/✕1 done/)).toBeTruthy();
    // Not listed until asked for.
    expect(screen.queryByRole('list', { name: 'Lines done in this hour' })).toBeNull();
    const toggle = screen.getByLabelText('Done in this hour: 1');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.press(toggle);
    const list = screen.getByRole('list', { name: 'Lines done in this hour' });
    expect(within(list).getByText('buy milk')).toBeTruthy();
    expect(within(list).queryByText('call the bank')).toBeNull();
    // It reads like a hit in Search: the pad it is in under its text.
    expect(within(list).getByText('Inbox')).toBeTruthy();
    expect(within(list).getByRole('listitem')).toHaveAttribute('aria-label', 'buy milk, Inbox');
    await fireEvent.press(screen.getByLabelText('Done in this hour: 1'));
    expect(screen.queryByRole('list', { name: 'Lines done in this hour' })).toBeNull();
  });

  it('opens a new line in the hour from a tap on the empty space under its lines', async () => {
    await hosted();
    // An hour with nothing in it says so, in the space that takes the tap.
    expect(screen.getByText('Nothing in this hour. Tap here to add a line.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add a line to this hour'));
    const made = usePad.getState().editing!.id;
    await act(async () => void cmdSetText(made, 'renew passport'));
    expect(all()[made]).toMatchObject({ text: 'renew passport', slot: '2026-11-19T14' });
    expect(all()[all()[made]!.parentId!]).toMatchObject({ pad: true, text: 'Today' });
    expect(screen.getByLabelText('2pm, now: renew passport')).toBeTruthy();
    expect(screen.queryByText('Nothing in this hour. Tap here to add a line.')).toBeNull();
    // The next tap opens a line after it.
    await fireEvent.press(screen.getByLabelText('Add a line to this hour'));
    const next = usePad.getState().editing!.id;
    await act(async () => void cmdSetText(next, 'book the dentist'));
    expect(screen.getByLabelText('2pm, now: renew passport, 0 of 2 done')).toBeTruthy();
  });

  it('puts a line into an hour that has not come', async () => {
    await hosted();
    await fireEvent.press(screen.getByLabelText('5pm: not yet'));
    await fireEvent.press(screen.getByLabelText('Add a line to this hour'));
    await act(async () => void cmdSetText(usePad.getState().editing!.id, 'pack for the trip'));
    expect(all()[id('pack for the trip')]!.slot).toBe('2026-11-19T17');
    expect(screen.getByLabelText('5pm: pack for the trip')).toBeTruthy();
  });

  it('starts an hour fresh: the lines not done leave it, marked, and the done ones stay', async () => {
    await setup();
    // Nothing in the hour, nothing to take out.
    expect(screen.getByLabelText(/^Fresh start/)).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      select([id('call the bank'), id('send invoice'), id('buy milk')]);
      cmdSetSlot(slotKey('2026-11-19', 14));
      cross(id('call the bank'));
    });
    await fireEvent.press(screen.getByLabelText(/^Fresh start/));
    expect(all()[id('send invoice')]).toMatchObject({ slot: null, fresh: true });
    expect(all()[id('buy milk')]).toMatchObject({ slot: null, fresh: true });
    expect(all()[id('call the bank')]).toMatchObject({ slot: '2026-11-19T14', done: true });
    expect(screen.getByLabelText('2pm, now: call the bank, done')).toBeTruthy();
    expect(screen.getByLabelText(/^Fresh start/)).toHaveAttribute('aria-disabled', 'true');
  });

  it('asks the app for its search from the hour\'s search button', async () => {
    await setup();
    const asked: string[] = [];
    setSlotFinder((slot) => asked.push(slot));
    try {
      await fireEvent.press(screen.getByLabelText('Find a line in a pad for this hour'));
      expect(asked).toEqual(['2026-11-19T14']);
    } finally {
      setSlotFinder(null);
    }
  });
});

describe('SlotPicker', () => {
  it('opens on today, marks the hour in progress and picks an hour of another day', async () => {
    const onPick = vi.fn();
    await render(<SlotPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />);
    expect(screen.getByText('Which hour is this line for?')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '2pm, now' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No hour' })).toHaveAttribute('aria-disabled', 'true');
    // Nothing is picked yet, so there is nothing to confirm.
    expect(screen.getByRole('button', { name: 'Pick an hour' })).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.press(screen.getByLabelText('The day after'));
    await fireEvent.press(screen.getByRole('checkbox', { name: '9am' }));
    // A pick is shown, not sent: the hour is checked and the button says it.
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '9am' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Picked Tomorrow 9am. Tap an hour to add it or take it out.')).toBeTruthy();
    // Another tap adds its hour, and a tap on a picked one takes it out.
    await fireEvent.press(screen.getByRole('checkbox', { name: '10am' }));
    expect(screen.getByRole('checkbox', { name: '9am' })).toHaveAttribute('aria-checked', 'true');
    await fireEvent.press(screen.getByRole('checkbox', { name: '9am' }));
    expect(screen.getByRole('checkbox', { name: '9am' })).toHaveAttribute('aria-checked', 'false');
    await fireEvent.press(screen.getByRole('button', { name: 'Put in Tomorrow 10am' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('2026-11-20T10');
  });

  it('picks hours that are apart with a tap on each, on more than one day', async () => {
    const onPick = vi.fn();
    await render(<SlotPicker value="2026-11-19T08" onPick={onPick} onCancel={() => {}} clock={clock} />);
    // The first tap starts from nothing: the hour the line is in is not kept.
    await fireEvent.press(screen.getByRole('checkbox', { name: '9am' }));
    expect(screen.getByRole('checkbox', { name: '8am' })).toHaveAttribute('aria-checked', 'false');
    await fireEvent.press(screen.getByRole('checkbox', { name: '4pm' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: '3pm' }));
    expect(screen.getByRole('button', { name: 'Put in Today 9am, 3pm-5pm' })).toBeTruthy();
    // The hours picked stay while the day is stepped.
    await fireEvent.press(screen.getByLabelText('The day after'));
    expect(screen.getByRole('checkbox', { name: '9am' })).toHaveAttribute('aria-checked', 'false');
    await fireEvent.press(screen.getByRole('checkbox', { name: '7am' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Put in Today 9am, 3pm-5pm; .*7am$/ }));
    expect(onPick).toHaveBeenCalledWith('2026-11-19T09,2026-11-19T15+2,2026-11-20T07');
  });

  it('has nothing to confirm once every hour picked is taken out again', async () => {
    await render(<SlotPicker value={null} onPick={() => {}} onCancel={() => {}} clock={clock} />);
    await fireEvent.press(screen.getByRole('checkbox', { name: '9am' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: '9am' }));
    expect(screen.getByRole('button', { name: 'Pick an hour' })).toHaveAttribute('aria-disabled', 'true');
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
    await fireEvent.press(screen.getByRole('checkbox', { name: '9am' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Put in/ }));
    expect(onPick).toHaveBeenCalledWith('2026-11-27T09');
  });

  it('opens on the hour the lines are in and can take them out of it', async () => {
    const onPick = vi.fn();
    await render(<SlotPicker value="2026-11-21T08" count={3} onPick={onPick} onCancel={() => {}} clock={clock} />);
    expect(screen.getByText('Which hour are these 3 lines for?')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '8am' })).toHaveAttribute('aria-checked', 'true');
    await fireEvent.press(screen.getByRole('button', { name: 'No hour' }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  // A swipe as the mouse makes it: down on one hour, moved, up. jsdom has no layout, so the
  // line is given its place: at the page's corner, 480px wide, so each of its 24 boxes
  // takes 20px. The line reads its place on the next tick.
  const at = (place: number) => ({ x: place * 20 + 10, y: 20 });
  const swipe = async (from: number, to: number) => {
    const grid = screen.getByRole('group', { name: 'Hours' });
    Object.defineProperty(grid, 'offsetWidth', { configurable: true, value: 480 });
    const cell = screen.getAllByRole('checkbox')[from]!;
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
    expect(screen.getByText('Tap the hours, or swipe across several.')).toBeTruthy();
    await swipe(14, 16);
    // The run is shown, its hours checked, and waits for the button.
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '4pm' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Put in Today 2pm-5pm' })).toBeTruthy();
    // Backwards: the run starts at the earlier hour. It is added to the first, and a run
    // that is apart from it stays apart.
    await swipe(12, 11);
    expect(screen.getByRole('button', { name: 'Put in Today 11am-1pm, 2pm-5pm' })).toBeTruthy();
    await swipe(17, 13);
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
    const cell = screen.getAllByRole('checkbox')[14]!;
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
      const grid = screen.getByRole('group', { name: 'Hours' });
      Object.defineProperty(grid, 'offsetWidth', { configurable: true, value: 300 });
      const at = (place: number) => ({ x: (place % 6) * 50 + 25, y: Math.floor(place / 6) * 70 + 30 });
      const point = (p: number, buttons: number) => ({ clientX: at(p).x, clientY: at(p).y, pageX: at(p).x, pageY: at(p).y, button: 0, buttons });
      const cell = screen.getAllByRole('checkbox')[10]!;
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
    expect(screen.getByRole('checkbox', { name: '2pm, now' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: '3pm' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: '4pm' })).toHaveAttribute('aria-checked', 'false');
  });

  it('starts its line of hours at the hour the day starts at', async () => {
    const stores = await openHours();
    await act(async () => {
      await stores.day.getState().setStart(6);
    });
    try {
      const onPick = vi.fn();
      await render(<SlotPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />);
      const hours = screen.getAllByRole('checkbox').map((el) => el.getAttribute('aria-label'));
      expect(hours.slice(0, 3)).toEqual(['6am', '7am', '8am']);
      expect(hours.at(-1)).toBe('5am');
      expect(screen.getByRole('navigation', { name: 'Days' })).toHaveTextContent('TodayThu, Nov 19');
      // An hour after midnight is still Thursday's, and is stored under Friday.
      await fireEvent.press(screen.getByRole('checkbox', { name: '1am' }));
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
      expect(screen.getByRole('checkbox', { name: '2am' })).toHaveAttribute('aria-checked', 'true');
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
  it('asks the store to show the hour, and the next one when the screen moves on', async () => {
    await hosted();
    await act(async () => {
      cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice')]);
      cmdSetSlot(slotKey('2026-11-19', 15), [id('buy milk')]);
    });
    // The hour in progress is open: the store shows it, and the host draws its lines.
    expect(usePad.getState().slotId).toBe('2026-11-19T14');
    expect(screen.getByTestId('host-rows').textContent).toBe('send invoice');
    // No field: the space under the lines takes a tap for a new one.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByLabelText('Add a line to this hour')).toBeTruthy();

    // The focus screen has nothing to close.
    expect(screen.queryByText('Close')).toBeNull();

    // Another hour, picked in the list, takes the view.
    await fireEvent.press(screen.getByLabelText('3pm: buy milk'));
    expect(usePad.getState().slotId).toBe('2026-11-19T15');
    expect(screen.getByTestId('host-rows').textContent).toBe('buy milk');
    // And so does the hour after it, from the screen's own way on.
    await fireEvent.press(screen.getByLabelText('Next hour, 4pm'));
    expect(usePad.getState().slotId).toBe('2026-11-19T16');
    expect(screen.getByTestId('host-rows').textContent).toBe('');
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

  it('keeps an archived line among the hour\'s lines, with what was archived under it', async () => {
    await hosted();
    const invoice = id('send invoice');
    await act(async () => {
      applyAll((rows, ctx) => insertAt(rows, ctx, { parentId: invoice, afterId: null }, 'export the PDF').rows);
      cmdSetSlot(slotKey('2026-11-19', 14), [id('call the bank'), invoice]);
      cross(invoice);
      select([invoice]);
      cmdDeleteSelection();
    });
    expect(all()[invoice]!.deletedAt).not.toBeNull();
    // No heading of its own: the host's editor draws it with the others, and its row
    // carries the archived mark (each app's Row).
    expect(screen.getByTestId('host-rows').textContent).toBe('call the bank | export the PDF | send invoice');
    expect(screen.queryByText('Archived')).toBeNull();
    // It still counts in the hour's title.
    expect(screen.getByLabelText('2pm, now: call the bank, 1 of 2 done')).toBeTruthy();
    // The mark brings it back in place, as done as it was, with the line under it.
    await act(async () => void cmdSlotUnarchive(invoice));
    expect(all()[invoice]).toMatchObject({ deletedAt: null, slot: '2026-11-19T14', done: true });
    expect(all()[id('export the PDF')]).toMatchObject({ deletedAt: null, parentId: invoice });
    expect(screen.getByTestId('host-rows').textContent).toBe('call the bank | export the PDF | send invoice');
    // Nothing jumps to the line: the pad that is open stays open.
    expect(usePad.getState().padId).toBeNull();
  });
});
