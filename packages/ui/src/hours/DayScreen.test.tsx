import { vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import { act, fireEvent, render, screen } from '../testing/rntl';

import type { Entry } from '@hissypad/core/hours';
import { MemoryStore, type EntryStore } from '@hissypad/core/hours';
import { createCategoryStore } from '@hissypad/state/hours';
import { createChimeStore } from '@hissypad/state/hours';
import { createDayStore } from '@hissypad/state/hours';
import { createFlagStore } from '@hissypad/state/hours';
import { createRecurringStore } from '@hissypad/state/hours';
import { StoresProvider } from './provider';

import { DayScreen } from './DayScreen';

// The chime module is native notifications; the screen only asks it two small things.


// The pull itself is the platform's control, which the test renderer does not draw. The
// screen's part is what a pull does, so the test keeps hold of that.
const mockPull = { run: async () => {} };
vi.mock('./PullRefresh', () => ({
  PullIndicator: () => null,
  useRefreshControl: (onRefresh: () => Promise<void>) => {
    mockPull.run = onRefresh;
    return undefined;
  },
}));

// Thursday 2026-11-19, 14:25 local: 14 hours are over, 2pm is in progress.
const clock = () => new Date(2026, 10, 19, 14, 25);

// Written on the hours before 2026-11-27, when an hour had a summary, a category and a
// state of its own. Both were marked done. Nothing on screen writes these any more: an
// hour with no lines still shows them.
const seed: Entry[] = [
  { day: '2026-11-19', hour: 9, note: 'proposals', category: 'deep', flags: [], state: 'done', updatedAt: 1 },
  { day: '2026-11-18', hour: 22, note: '', category: 'sleep', flags: [], state: 'done', updatedAt: 1 },
];
const blank = (hour: number, over: Partial<Entry> = {}): Entry => ({
  day: '2026-11-19', hour, note: '', category: null, flags: [], state: 'open', updatedAt: 1, ...over,
});

// Entries can come from any EntryStore (some tests break it); categories from memory.
async function setup(store: EntryStore = new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS), categoryRows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS)) {
  const day = createDayStore(store, clock);
  const categories = createCategoryStore(categoryRows);
  const flags = createFlagStore(categoryRows);
  const recurring = createRecurringStore(categoryRows, { clock });
  await categories.getState().load();
  await flags.getState().load();
  await recurring.getState().load();
  const onEditPlans = vi.fn();
  await render(
    <StoresProvider day={day} categories={categories} flags={flags} recurring={recurring}>
      <DayScreen clock={clock} onEditPlans={onEditPlans} />
    </StoresProvider>,
  );
  return { store, day, categories, flags, recurring, onEditPlans };
}

describe('DayScreen', () => {
  it('shows today, how much of it is done, and opens on the hour in progress', async () => {
    await setup();
    expect(await screen.findByLabelText(/1 of 14 hours done\./)).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Thu, Nov 19')).toBeTruthy();
    expect(screen.getByLabelText('9am: Deep work: proposals, done')).toBeTruthy();
    expect(screen.getByLabelText('3pm: not yet')).toBeTruthy();
    expect(screen.getByLabelText(/Not done 13h/)).toBeTruthy();
    // The hour in progress is open: the way to find a line for it, Fresh start and Close.
    expect(screen.getByLabelText('2pm, now: blank')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Find a line in a pad for this hour')).toBeTruthy();
    expect(screen.getByText('Fresh start')).toBeTruthy();
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('has nothing to set on an hour: no state, no summary, no category, no flags, no clearing', async () => {
    const { store } = await setup();
    await fireEvent.press(await screen.findByLabelText('9am: Deep work: proposals, done'));
    expect(screen.getByLabelText('9am: Deep work: proposals, done')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('Summary')).toBeNull();
    expect(screen.queryByLabelText(/^Category/)).toBeNull();
    expect(screen.queryByText('Flags')).toBeNull();
    expect(screen.queryByText('Clear this hour')).toBeNull();
    // The bullet is part of the row's button, not a checkbox of its own.
    expect(screen.queryByRole('checkbox')).toBeNull();
    // Opening and closing an hour writes nothing.
    await fireEvent.press(screen.getByText('Close'));
    expect(screen.getByLabelText('9am: Deep work: proposals, done')).toHaveAttribute('aria-expanded', 'false');
    expect((await store.listDay('2026-11-19'))[0]).toEqual(seed[0]);
  });

  it('moves to another day and back', async () => {
    await setup();
    await fireEvent.press(await screen.findByLabelText('Earlier'));
    expect(await screen.findByText('Yesterday')).toBeTruthy();
    expect(screen.getByLabelText('10pm: Sleep, done')).toBeTruthy();
    expect(screen.getByLabelText(/1 of 24 hours done\./)).toBeTruthy();
    // Another day opens with every hour closed.
    expect(screen.queryByLabelText('Find a line in a pad for this hour')).toBeNull();

    // The way back is in the calendar, which closes once a day is picked.
    await fireEvent.press(screen.getByLabelText('Pick a day'));
    expect(screen.getByText('November 2026')).toBeTruthy();
    await fireEvent.press(screen.getByText('Back to today'));
    expect(await screen.findByText('Today')).toBeTruthy();
    expect(screen.queryByText('November 2026')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Pick a day'));
    expect(screen.queryByText('Back to today')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Tue, Nov 17'));
    expect(await screen.findByText('Tue, Nov 17')).toBeTruthy();
  });

  it('follows the category list: renames, archives and ids it does not know', async () => {
    const rows: Entry[] = [
      blank(8, { category: 'drift', state: 'done' }),
      blank(9, { note: 'proposals', category: 'deep', state: 'done' }),
      blank(10, { category: 'cnotyet001', state: 'done' }),
    ];
    const { categories } = await setup(new MemoryStore(rows));
    await categories.getState().update('deep', { label: 'Focus' });
    await categories.getState().update('drift', { archived: true });

    // A rename reaches the row and the legend; an archived category keeps its hours.
    expect(await screen.findByLabelText('9am: Focus: proposals, done')).toBeTruthy();
    expect(screen.getByLabelText(/Focus 1h/)).toBeTruthy();
    expect(screen.getByLabelText('8am: Drift, done')).toBeTruthy();
    // An id with no category on this device reads as untagged.
    expect(screen.getByLabelText('10am: Untagged, done')).toBeTruthy();
    expect(screen.getByLabelText(/Untagged 1h/)).toBeTruthy();

    // The category list is edited from the app's top menu, not from Hours.
    await fireEvent.press(screen.getByLabelText('Hours menu'));
    expect(screen.queryByLabelText('Edit categories')).toBeNull();
    // Flags are hidden (kept for a later version): no way in from the menu.
    expect(screen.queryByLabelText('Edit flags')).toBeNull();
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('shows a category by its icon in the rows and the legend', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const { categories } = await setup(undefined, rows);
    await categories.getState().update('deep', { icon: '\u{1F4BB}', label: 'Deep work, no chat' });

    // The row says the icon where there is one and the name where there is not.
    expect(await screen.findByLabelText('9am: \u{1F4BB}: proposals, done')).toBeTruthy();
    // So does the legend.
    expect(screen.getByLabelText(/\u{1F4BB} 1h/u)).toBeTruthy();
  });

  it('follows an edit that lands under the open hour', async () => {
    const { store, day } = await setup();
    await fireEvent.press(await screen.findByLabelText('9am: Deep work: proposals, done'));

    // A device on older code rewrites the hour and sync lands it while the hour is open.
    await (store as MemoryStore).sync.entries.applyRemote([{ ...seed[0]!, note: 'proposals, then a call', updatedAt: 2 }]);
    await act(async () => {
      await day.getState().refresh();
    });
    expect(screen.getByLabelText('9am: Deep work: proposals, then a call, done')).toBeTruthy();
    // Closing writes nothing over it.
    await fireEvent.press(screen.getByText('Close'));
    expect((await store.listDay('2026-11-19'))[0]).toMatchObject({ note: 'proposals, then a call', updatedAt: 2 });
  });

  it('syncs and re-reads the day when the hours are pulled down', async () => {
    const store = new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS);
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
    await screen.findByLabelText('10am: blank');

    // Another device's hour lands, the way a sync writes it; the pull re-reads the day.
    await store.sync.entries.applyRemote([{ ...seed[0]!, hour: 10, note: 'from the laptop', updatedAt: 2 }]);
    await act(async () => {
      await mockPull.run();
    });
    expect(await screen.findByLabelText('10am: Deep work: from the laptop, done')).toBeTruthy();
  });

  it('draws a recurring plan on the hours it covers, stores nothing for them, and follows the plan', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    // Made earlier in the month: sleep from 2am to 10am, every day.
    await rows.putRecurring({ id: 'rsleep0001', note: 'sleep', category: 'sleep', from: 2, to: 10, days: [0, 1, 2, 3, 4, 5, 6], since: '2026-11-01', position: 0, archived: false, updatedAt: 1 });
    const { store, recurring, onEditPlans } = await setup(undefined, rows);
    const at = async (hour: number) => (await store.listDay('2026-11-19')).find((e) => e.hour === hour);

    // Eight hours come with its words and category, with nothing stored for them. 9am has
    // what was written on it before.
    expect(await screen.findByLabelText('2am: Sleep: sleep')).toBeTruthy();
    expect(screen.getByLabelText('8am: Sleep: sleep')).toBeTruthy();
    expect(screen.getByLabelText('9am: Deep work: proposals, done')).toBeTruthy();
    expect(screen.getByLabelText('1am: blank')).toBeTruthy();
    expect(screen.getByLabelText('10am: blank')).toBeTruthy();

    // Opening one writes nothing: a plan is never pinned into an hour.
    await fireEvent.press(screen.getByLabelText('2am: Sleep: sleep'));
    await fireEvent.press(screen.getByText('Close'));
    expect(await at(2)).toBeUndefined();

    // The plan changes, and every hour it covered follows.
    await recurring.getState().update('rsleep0001', { note: 'sleep, no phone', to: 8 });
    expect(await screen.findByLabelText('3am: Sleep: sleep, no phone')).toBeTruthy();
    expect(screen.getByLabelText('2am: Sleep: sleep, no phone')).toBeTruthy();
    expect(screen.getByLabelText('8am: blank')).toBeTruthy();

    // The recurring plans are reached from the menu, not from Settings.
    await fireEvent.press(screen.getByLabelText('Hours menu'));
    expect(screen.queryByText(/2am-8am/)).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: 'Edit recurring plans' }));
    expect(onEditPlans).toHaveBeenCalled();
  });

  it('keeps what was written on an hour before over a recurring plan', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    await rows.putRecurring({ id: 'rsleep0001', note: 'sleep', category: 'sleep', from: 2, to: 10, days: [0, 1, 2, 3, 4, 5, 6], since: '2026-11-01', position: 0, archived: false, updatedAt: 1 });
    await setup(new MemoryStore([blank(3, { note: 'airport run', category: 'people' })]), rows);
    expect(await screen.findByLabelText('3am: People: airport run')).toBeTruthy();
    expect(screen.getByLabelText('4am: Sleep: sleep')).toBeTruthy();
  });

  it('lists the first line of a summary that runs to several', async () => {
    await setup(new MemoryStore([blank(10, { note: 'fixed the collector\n\nthe retry loop, again' })]));
    expect(await screen.findByLabelText('10am: fixed the collector')).toBeTruthy();
  });

  it('hides the flags: an hour that carries answers shows none, and they stay stored', async () => {
    const answered = blank(9, { note: 'scrolled', category: 'drift', flags: ['distracted:yes', 'halts:no'] });
    const { store } = await setup(new MemoryStore([answered], SAMPLE_CATEGORIES, SAMPLE_FLAGS));
    await fireEvent.press(await screen.findByLabelText('9am: Drift: scrolled'));
    expect(screen.queryByTestId('flag-distracted-yes')).toBeNull();
    expect(screen.queryByText('Flags')).toBeNull();
    expect(screen.queryByText('Edit flags')).toBeNull();
    expect((await store.listDay('2026-11-19'))[0]!.flags).toEqual(['distracted:yes', 'halts:no']);
  });

  it('redraws in place when sync brings rows in', async () => {
    const { store, day } = await setup();
    expect(await screen.findByLabelText('10am: blank')).toBeTruthy();
    await (store as MemoryStore).sync.entries.applyRemote([blank(10, { note: 'from the phone', category: 'body', updatedAt: 5 })]);
    await day.getState().refresh();
    expect(await screen.findByLabelText('10am: Body: from the phone')).toBeTruthy();
    expect(screen.queryByText(/^Opening/)).toBeNull();
  });

  it('says so when no hour of a day is done', async () => {
    await setup(new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS));
    expect(await screen.findByLabelText(/No hour of this day is marked done yet\./)).toBeTruthy();
  });

  it('shows a read failure with a way to retry', async () => {
    let fail = true;
    const flaky: EntryStore = {
      listDay: () => (fail ? Promise.reject(new Error('disk full')) : Promise.resolve(seed.slice(0, 1))),
      put: async () => {},
    };
    await setup(flaky);
    expect(await screen.findByText('Could not read Thu, Nov 19: disk full')).toBeTruthy();

    fail = false;
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByLabelText(/1 of 14 hours done\./)).toBeTruthy();
  });

  it('lets the day start at another hour', async () => {
    const rows: Entry[] = [...seed, { ...blank(1, { note: 'could not sleep' }), day: '2026-11-20' }];
    const { store, day } = await setup(new MemoryStore(rows));
    expect(await screen.findByLabelText(/1 of 14 hours done\./)).toBeTruthy();
    expect(screen.queryByLabelText('1am: could not sleep')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Hours menu'));
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(screen.getByText('Day starts at 12am')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: '6am' }));

    // 6am to 6am: eight hours are over at 2:25pm, and Friday's 1am is part of Thursday.
    expect(await screen.findByLabelText(/1 of 8 hours done\./)).toBeTruthy();
    // Choosing closes the settings; opening them again shows the choice.
    expect(screen.queryByText('Day starts at 12am')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Hours menu'));
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(screen.getByText('Day starts at 6am')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '6am', checked: true })).toBeTruthy();
    expect(screen.getByLabelText('1am: could not sleep')).toBeTruthy();
    expect(day.getState().start).toBe(6);
  });

  it('has no chimes control when nothing can chime', async () => {
    await setup();
    await fireEvent.press(await screen.findByLabelText('Hours menu'));
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(screen.getByText('Day starts at 12am')).toBeTruthy();
    expect(screen.queryByText('Chimes are off')).toBeNull();
  });

  it('sets the chimes to the minutes chosen', async () => {
    const saved: number[][] = [];
    const chimes = createChimeStore({
      apply: async (minutes) => (minutes.length ? 'on' : 'off'),
      resume: (minutes) => (minutes.length ? 'on' : 'off'),
      save: async (minutes) => void saved.push(minutes),
    });
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const categories = createCategoryStore(rows);
    const flags = createFlagStore(rows);
    await categories.getState().load();
    await flags.getState().load();
    await render(
      <StoresProvider day={createDayStore(new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS), clock)} categories={categories} flags={flags} chimes={chimes}>
        <DayScreen clock={clock} />
      </StoresProvider>,
    );

    await fireEvent.press(await screen.findByLabelText('Hours menu'));
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(screen.getByText('Chimes are off')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: ':55' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: ':30' }));
    expect(await screen.findByText('Chimes at :30 and :55')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: ':30', checked: true })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: ':00', checked: false })).toBeTruthy();
    expect(saved.at(-1)).toEqual([30, 55]);

    await fireEvent.press(screen.getByRole('checkbox', { name: ':30' }));
    expect(await screen.findByText('Chimes at :55')).toBeTruthy();
    expect(saved.at(-1)).toEqual([55]);
  });
});
