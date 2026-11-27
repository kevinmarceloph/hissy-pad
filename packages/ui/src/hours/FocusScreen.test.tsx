import { vi } from 'vitest';
import { findFixedPad, idOf, insertAt, setDone, slotKey } from '@hissypad/core';
import { MemoryStore } from '@hissypad/core/hours';
import { applyAll, loadPad, resetStore, usePad } from '@hissypad/state';
import { cmdSetSlot, createCategoryStore, createDayStore, createFlagStore, createRecurringStore } from '@hissypad/state/hours';

import { act, fireEvent, render, screen } from '../testing/rntl';
import { FocusScreen, PartScreen } from './FocusScreen';
import { LinesContext } from './HostedLines';
import { StoresProvider } from './provider';

// Thursday 2026-11-19, 14:25 local: 2pm is in progress.
const clock = () => new Date(2026, 10, 19, 14, 25);
const all = () => usePad.getState().all;
const id = (text: string) => idOf(all(), text);

// The host's editor, reduced to what matters here: it draws the store's rows.
function HostRows() {
  const rows = usePad((s) => s.rows);
  return <p data-testid="host-rows">{Object.values(rows).map((r) => r.text).sort().join(' | ')}</p>;
}

async function stores() {
  resetStore('call the bank\nsend invoice\nbuy milk');
  await loadPad();
  const rows = new MemoryStore();
  await rows.putRecurring({ id: 'rlunch0001', note: 'lunch', category: null, from: 13, to: 14, days: [0, 1, 2, 3, 4, 5, 6], since: '2026-11-01', position: 0, archived: false, updatedAt: 1 });
  const day = createDayStore(rows, clock);
  const categories = createCategoryStore(rows);
  const flags = createFlagStore(rows);
  const recurring = createRecurringStore(rows, { clock });
  await categories.getState().load();
  await flags.getState().load();
  await recurring.getState().load();
  return { day, categories, flags, recurring };
}

describe('the focus screen', () => {
  async function setup(at: { day: string; hour: number } | null = null) {
    const s = await stores();
    const on = { onList: vi.fn(), onGo: vi.fn(), onPart: vi.fn() };
    await render(
      <StoresProvider {...s}>
        <LinesContext.Provider value={() => <HostRows />}>
          <FocusScreen at={at} clock={clock} {...on} />
        </LinesContext.Provider>
      </StoresProvider>,
    );
    return on;
  }

  it('is the hour the clock is in: its line, its pad, and nothing of the day around it', async () => {
    const on = await setup();
    await act(async () => void cmdSetSlot(slotKey('2026-11-19', 14), [id('send invoice')]));
    // The hour line says the hour and the day, and leads to the list of every hour.
    const line = screen.getByLabelText('2pm, Right now, Thu, Nov 19. Show every hour');
    expect(line).toHaveTextContent('2pmRight nowThu, Nov 19');
    await fireEvent.press(line);
    expect(on.onList).toHaveBeenCalled();
    // The hour's pad is the store's view of that hour, drawn by the host.
    expect(usePad.getState().slotId).toBe('2026-11-19T14');
    expect(screen.getByTestId('host-rows').textContent).toBe('send invoice');
    expect(screen.getByLabelText('Add a line to this hour')).toBeTruthy();
    expect(screen.getByText('Fresh start')).toBeTruthy();
    // No strip, no other hour's row, and nothing to close.
    expect(screen.queryByLabelText(/hours done/)).toBeNull();
    expect(screen.queryByText('Close')).toBeNull();
    expect(screen.queryByLabelText('Back to the hour it is now')).toBeNull();
  });

  it('says the hours before and after with the start of what each holds, and goes to them', async () => {
    const on = await setup();
    await act(async () => void cmdSetSlot(slotKey('2026-11-19', 15), [id('buy milk'), id('call the bank')]));
    // 1pm has a recurring plan and no lines; 3pm says its first line.
    await fireEvent.press(screen.getByLabelText('Previous hour, 1pm: lunch'));
    expect(on.onGo).toHaveBeenLastCalledWith({ day: '2026-11-19', hour: 13 });
    await fireEvent.press(screen.getByLabelText('Next hour, 3pm: call the bank'));
    expect(on.onGo).toHaveBeenLastCalledWith({ day: '2026-11-19', hour: 15 });
  });

  it('on another hour says its day, offers the way back to now, and follows the clock again from there', async () => {
    const on = await setup({ day: '2026-11-20', hour: 0 });
    expect(screen.getByLabelText('12am, Tomorrow, Fri, Nov 20. Show every hour')).toBeTruthy();
    expect(usePad.getState().slotId).toBe('2026-11-20T00');
    // Over midnight, by the calendar.
    await fireEvent.press(screen.getByLabelText('Previous hour, 11pm'));
    expect(on.onGo).toHaveBeenLastCalledWith({ day: '2026-11-19', hour: 23 });
    await fireEvent.press(screen.getByLabelText('Back to the hour it is now'));
    expect(on.onGo).toHaveBeenLastCalledWith(null);
  });

  it('steps onto the hour the clock is in as following it, not as a fixed hour', async () => {
    const on = await setup({ day: '2026-11-19', hour: 13 });
    // Another hour of today says how far off it is, not "Today".
    expect(screen.getByLabelText('1pm, 1 hour ago, Thu, Nov 19. Show every hour')).toHaveTextContent('1pm1 hour agoThu, Nov 19');
    await fireEvent.press(screen.getByLabelText('Next hour, 2pm'));
    expect(on.onGo).toHaveBeenLastCalledWith(null);
  });

  it('counts Today\'s lines waiting for an hour, and leads to them and to the schedule', async () => {
    const on = await setup();
    const today = findFixedPad(all(), 'Today')!.id;
    await act(async () => {
      applyAll((rows, ctx) => {
        let out = rows;
        for (const text of ['draft the post', 'water the plants', 'old news']) out = insertAt(out, ctx, { parentId: today, afterId: null }, text).rows;
        return setDone(out, ctx, [idOf(out, 'old news')], true, true);
      });
      cmdSetSlot(slotKey('2026-11-19', 16), [id('water the plants')]);
    });
    // One open line of Today with no hour: not the done one, not the one with an hour, and
    // not the Inbox's.
    const waiting = screen.getByLabelText('Unscheduled: 1 line of Today with no hour');
    expect(waiting).toHaveTextContent('Unscheduled1');
    await fireEvent.press(waiting);
    expect(on.onPart).toHaveBeenLastCalledWith('own');
    await fireEvent.press(screen.getByLabelText("Schedule: Today's lines with an hour"));
    expect(on.onPart).toHaveBeenLastCalledWith('scheduled');
  });
});

describe('the hour line of an hour still to come today', () => {
  it('says in how many hours it starts', async () => {
    const s = await stores();
    await render(
      <StoresProvider {...s}>
        <FocusScreen at={{ day: '2026-11-19', hour: 17 }} clock={clock} onList={() => {}} onGo={() => {}} onPart={() => {}} />
      </StoresProvider>,
    );
    expect(screen.getByLabelText('5pm, In 3 hours, Thu, Nov 19. Show every hour')).toBeTruthy();
  });
});

describe('Today\'s two sections inside Hours', () => {
  async function setup(part: 'own' | 'scheduled') {
    const s = await stores();
    const today = findFixedPad(all(), 'Today')!.id;
    applyAll((rows, ctx) => {
      let out = rows;
      for (const text of ['draft the post', 'water the plants']) out = insertAt(out, ctx, { parentId: today, afterId: null }, text).rows;
      return out;
    });
    cmdSetSlot(slotKey('2026-11-19', 16), [id('water the plants')]);
    const onBack = vi.fn();
    const view = await render(
      <StoresProvider {...s}>
        <LinesContext.Provider value={() => <HostRows />}>
          <PartScreen part={part} onBack={onBack} />
        </LinesContext.Provider>
      </StoresProvider>,
    );
    return { onBack, view };
  }

  it('shows Today\'s lines with no hour as a pad, takes a tap for a new one, and goes back', async () => {
    const { onBack } = await setup('own');
    expect(usePad.getState().partId).toBe('own');
    expect(screen.getByTestId('host-rows').textContent).toBe('draft the post');
    await fireEvent.press(screen.getByLabelText('Add a line to Today'));
    const made = usePad.getState().editing!.id;
    expect(all()[made]).toMatchObject({ parentId: findFixedPad(all(), 'Today')!.id, slot: null });
    await fireEvent.press(screen.getByLabelText('Unscheduled. Back to the hour'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows Today\'s lines with an hour as a pad, and gives the view back when it goes', async () => {
    const { view } = await setup('scheduled');
    expect(usePad.getState().partId).toBe('scheduled');
    expect(screen.getByTestId('host-rows').textContent).toBe('water the plants');
    expect(screen.getByRole('heading', { name: 'Schedule' })).toBeTruthy();
    // No space to tap for a new line: one made here would take the hour of the last line.
    expect(screen.queryByLabelText('Add a line to Today')).toBeNull();
    await act(async () => view.unmount());
    expect(usePad.getState().partId).toBeNull();
  });
});
