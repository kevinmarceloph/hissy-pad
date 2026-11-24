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
import { themes } from './theme';

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

// Both were marked done.
const seed: Entry[] = [
  { day: '2026-11-19', hour: 9, note: 'proposals', category: 'deep', planned: null, plannedNote: '', flags: [], state: 'done', updatedAt: 1 },
  { day: '2026-11-18', hour: 22, note: '', category: 'sleep', planned: null, plannedNote: '', flags: [], state: 'done', updatedAt: 1 },
];
const blank = (hour: number, over: Partial<Entry> = {}): Entry => ({
  day: '2026-11-19', hour, note: '', category: null, planned: null, plannedNote: '', flags: [], state: 'open', updatedAt: 1, ...over,
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
  const onEditFlags = vi.fn();
  const onEditPlans = vi.fn();
  await render(
    <StoresProvider day={day} categories={categories} flags={flags} recurring={recurring}>
      <DayScreen clock={clock} onEditFlags={onEditFlags} onEditPlans={onEditPlans} />
    </StoresProvider>,
  );
  return { store, day, categories, flags, recurring, onEditFlags, onEditPlans };
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
    // The hour in progress is open: its three states, and the field that brings lines in.
    expect(screen.getByLabelText('2pm, now: blank')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radio', { name: '2pm: Open', checked: true })).toBeTruthy();
    expect(screen.getByLabelText('Add a line to this hour')).toBeTruthy();
    // Nothing asks for a title: the summary is behind its button.
    expect(screen.queryByLabelText('Summary of 2pm')).toBeNull();
  });

  it('gives an hour a summary and a category behind the Summary button', async () => {
    const { store } = await setup();
    const at = async (hour: number) => (await store.listDay('2026-11-19')).find((e) => e.hour === hour);
    await fireEvent.press(await screen.findByLabelText('10am: blank'));
    expect(screen.queryByLabelText('Summary of 10am')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Summary' }));
    await fireEvent.changeText(screen.getByLabelText('Summary of 10am'), 'lunch');
    await fireEvent.press(screen.getByLabelText('Category: None'));
    // The picker is the one a line of the pad gets its category from, opened in place.
    expect(screen.getByText('Which category is 10am?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Body' }));
    // Choosing closes it and the closed line says what was chosen.
    expect(screen.queryByRole('radio', { name: 'Body' })).toBeNull();
    expect(screen.getByLabelText('Category: Body')).toBeTruthy();

    // Written as it is typed. A summary is not a done hour: that is said by hand.
    expect(await screen.findByLabelText('10am: Body: lunch')).toBeTruthy();
    expect(await at(10)).toMatchObject({ note: 'lunch', category: 'body', state: 'open' });
    await fireEvent.press(screen.getByRole('radio', { name: '10am: Done' }));
    expect(await screen.findByLabelText('10am: Body: lunch, done')).toBeTruthy();
    expect(screen.getByLabelText(/2 of 14 hours done\./)).toBeTruthy();
    expect(await at(10)).toMatchObject({ note: 'lunch', category: 'body', state: 'done' });

    await fireEvent.press(screen.getByText('Close'));
    expect(screen.queryByLabelText('Summary of 10am')).toBeNull();
    // An hour that has a summary opens with it showing.
    await fireEvent.press(screen.getByLabelText('10am: Body: lunch, done'));
    expect(screen.getByLabelText('Summary of 10am').value).toBe('lunch');
  });

  it('clears an hour back to blank', async () => {
    const { store } = await setup();
    await fireEvent.press(await screen.findByLabelText('9am: Deep work: proposals, done'));
    await fireEvent.press(screen.getByText('Clear this hour'));

    expect(await screen.findByLabelText('9am: blank')).toBeTruthy();
    expect((await store.listDay('2026-11-19'))[0]).toMatchObject({ note: '', category: null, state: 'open' });
  });

  it('moves to another day and back', async () => {
    await setup();
    await fireEvent.press(await screen.findByLabelText('Earlier'));
    expect(await screen.findByText('Yesterday')).toBeTruthy();
    expect(screen.getByLabelText('10pm: Sleep, done')).toBeTruthy();
    expect(screen.getByLabelText(/1 of 24 hours done\./)).toBeTruthy();
    // Another day opens with every hour closed.
    expect(screen.queryByLabelText('Add a line to this hour')).toBeNull();

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

    // The picker leaves the archived one out, except on the hour that already has it.
    await fireEvent.press(screen.getByLabelText('9am: Focus: proposals, done'));
    await fireEvent.press(screen.getByLabelText('Category: Focus'));
    expect(screen.getByRole('radio', { name: 'Admin' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Drift' })).toBeNull();
    await fireEvent.press(screen.getByLabelText('8am: Drift, done'));
    await fireEvent.press(screen.getByLabelText('Category: Drift'));
    expect(screen.getByRole('radio', { name: 'Drift', checked: true })).toBeTruthy();
    // No category takes it off.
    await fireEvent.press(screen.getByRole('button', { name: 'No category' }));
    expect(screen.getByLabelText('Category: None')).toBeTruthy();

    // The category list is edited from the app's top menu, not from Hours.
    await fireEvent.press(screen.getByLabelText('Hours menu'));
    expect(screen.queryByLabelText('Edit categories')).toBeNull();
    expect(screen.getByLabelText('Edit flags')).toBeTruthy();
  });

  it('shows a category by its icon in the rows and the legend, and by icon and name in the picker', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const { categories } = await setup(undefined, rows);
    await categories.getState().update('deep', { icon: '\u{1F4BB}', label: 'Deep work, no chat' });

    // The row says the icon where there is one and the name where there is not.
    expect(await screen.findByLabelText('9am: \u{1F4BB}: proposals, done')).toBeTruthy();
    // So does the legend. The picker says the icon and the name.
    expect(screen.getByLabelText(/\u{1F4BB} 1h/u)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('9am: \u{1F4BB}: proposals, done'));
    expect(screen.getByLabelText('Category: \u{1F4BB} Deep work, no chat')).toBeTruthy();
  });

  it('has no plan to edit, and falls back on words planned before', async () => {
    const rows: Entry[] = [
      blank(11, { planned: 'body', plannedNote: 'gym\nlegs, then a short run' }),
      // What was logged wins over what was planned for it.
      blank(12, { note: 'scrolled', category: 'drift', planned: 'deep', plannedNote: 'proposals', state: 'done' }),
    ];
    const { store } = await setup(new MemoryStore(rows));
    // The row shows the first line of the words, with their category.
    await fireEvent.press(await screen.findByLabelText('11am: Body: gym'));
    expect(screen.getByLabelText('12pm: Drift: scrolled, done')).toBeTruthy();
    expect(screen.queryByText(/[Pp]lanned/)).toBeNull();
    expect(screen.queryByLabelText('Edit the plan')).toBeNull();
    expect(screen.queryByLabelText(/^What (is|was|happened)/)).toBeNull();
    // Nothing is offered as what happened, and opening the hour writes nothing.
    expect(screen.queryByLabelText('Summary of 11am')).toBeNull();
    await fireEvent.press(screen.getByText('Close'));
    expect((await store.listDay('2026-11-19'))[0]).toMatchObject({ note: '', category: null, state: 'open', updatedAt: 1 });
  });

  it('opens an hour from anywhere on its row, the bullet included, and marks it done from its switch', async () => {
    const { store } = await setup();
    const at = async (hour: number) => (await store.listDay('2026-11-19')).find((e) => e.hour === hour);

    // The bullet is not a control of its own: no hour has a checkbox, and nothing on a
    // closed row changes its state.
    await screen.findByLabelText('10am: blank');
    expect(screen.queryByRole('checkbox', { name: /done$/ })).toBeNull();

    // An hour is confirmed in the open hour: any that has started, a blank one too.
    await fireEvent.press(screen.getByLabelText('10am: blank'));
    await fireEvent.press(screen.getByRole('radio', { name: '10am: Done' }));
    expect(await screen.findByLabelText('10am: done')).toBeTruthy();
    expect(await at(10)).toMatchObject({ state: 'done', note: '', category: null });
    expect(screen.getByLabelText(/2 of 14 hours done\./)).toBeTruthy();

    // Open takes it back, and what is written on the hour stays.
    await fireEvent.press(screen.getByLabelText('9am: Deep work: proposals, done'));
    await fireEvent.press(screen.getByRole('radio', { name: '9am: Open' }));
    expect(await screen.findByLabelText('9am: Deep work: proposals')).toBeTruthy();
    expect(await at(9)).toMatchObject({ state: 'open', note: 'proposals', category: 'deep' });
  });

  it('puts the open hour in one of three states from its switch', async () => {
    const { store } = await setup();
    const now = async () => (await store.listDay('2026-11-19')).find((e) => e.hour === 14);
    await fireEvent.press(await screen.findByRole('radio', { name: '2pm: Doing' }));
    expect(await screen.findByLabelText('2pm, now: doing')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '2pm: Doing', checked: true })).toBeTruthy();
    expect(await now()).toMatchObject({ state: 'doing' });
    await fireEvent.press(screen.getByRole('radio', { name: '2pm: Done' }));
    expect(await screen.findByLabelText('2pm, now: done')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: '2pm: Open' }));
    expect(await screen.findByLabelText('2pm, now: blank')).toBeTruthy();
    expect(await now()).toMatchObject({ state: 'open' });
  });

  it('follows an edit that lands under the open hour', async () => {
    const { store, day } = await setup();
    await fireEvent.press(await screen.findByLabelText('9am: Deep work: proposals, done'));
    expect(screen.getByLabelText('Summary of 9am').value).toBe('proposals');

    // Another device rewrites the hour and sync lands it while the hour is open.
    await (store as MemoryStore).sync.entries.applyRemote([{ ...seed[0]!, note: 'proposals, then a call', updatedAt: 2 }]);
    await act(async () => {
      await day.getState().refresh();
    });
    expect(screen.getByLabelText('Summary of 9am').value).toBe('proposals, then a call');
    // Nothing is a draft, so closing writes nothing over it.
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

  it('draws a recurring plan on the hours it covers and pins it when an hour is marked done', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    // Made earlier in the month: sleep from 2am to 10am, every day.
    await rows.putRecurring({ id: 'rsleep0001', note: 'sleep', category: 'sleep', from: 2, to: 10, days: [0, 1, 2, 3, 4, 5, 6], since: '2026-11-01', position: 0, archived: false, updatedAt: 1 });
    const { store, recurring, onEditPlans } = await setup(undefined, rows);
    const at = async (hour: number) => (await store.listDay('2026-11-19')).find((e) => e.hour === hour);

    // Eight hours come with its words and category, with nothing stored for them. 9am has its own.
    expect(await screen.findByLabelText('2am: Sleep: sleep')).toBeTruthy();
    expect(screen.getByLabelText('8am: Sleep: sleep')).toBeTruthy();
    expect(screen.getByLabelText('9am: Deep work: proposals, done')).toBeTruthy();
    expect(screen.getByLabelText('1am: blank')).toBeTruthy();
    expect(screen.getByLabelText('10am: blank')).toBeTruthy();
    expect(await at(2)).toBeUndefined();

    // Marking an hour done writes the plan it was showing into the row.
    await fireEvent.press(screen.getByLabelText('2am: Sleep: sleep'));
    await fireEvent.press(screen.getByRole('radio', { name: '2am: Done' }));
    expect(await screen.findByLabelText('2am: Sleep: sleep, done')).toBeTruthy();
    expect(await at(2)).toMatchObject({ state: 'done', note: '', category: null, planned: 'sleep', plannedNote: 'sleep' });
    expect(screen.getByLabelText(/2 of 14 hours done\. .*Sleep 1h/)).toBeTruthy();

    // The plan changes: hours not lived yet follow, the one marked done keeps its own.
    await recurring.getState().update('rsleep0001', { note: 'sleep, no phone', to: 8 });
    expect(await screen.findByLabelText('3am: Sleep: sleep, no phone')).toBeTruthy();
    expect(screen.getByLabelText('2am: Sleep: sleep, done')).toBeTruthy();
    expect(screen.getByLabelText('8am: blank')).toBeTruthy();

    // The recurring plans are reached from the menu, not from Settings.
    await fireEvent.press(screen.getByLabelText('Hours menu'));
    expect(screen.queryByText(/2am-8am/)).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: 'Edit recurring plans' }));
    expect(onEditPlans).toHaveBeenCalled();
  });

  it('keeps words stored on an hour over a recurring plan, and pins the plan on the first write', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    await rows.putRecurring({ id: 'rsleep0001', note: 'sleep', category: 'sleep', from: 2, to: 10, days: [0, 1, 2, 3, 4, 5, 6], since: '2026-11-01', position: 0, archived: false, updatedAt: 1 });
    const own = blank(3, { planned: 'people', plannedNote: 'airport run' });
    const { store } = await setup(new MemoryStore([own]), rows);
    expect(await screen.findByLabelText('3am: People: airport run')).toBeTruthy();

    // A summary typed on a recurring hour takes the row, in the plan's category.
    await fireEvent.press(screen.getByLabelText('4am: Sleep: sleep'));
    await fireEvent.press(screen.getByRole('button', { name: 'Summary' }));
    await fireEvent.changeText(screen.getByLabelText('Summary of 4am'), 'awake, reading');
    expect(await screen.findByLabelText('4am: Sleep: awake, reading')).toBeTruthy();
    expect((await store.listDay('2026-11-19')).find((e) => e.hour === 4)).toMatchObject({
      note: 'awake, reading',
      category: null,
      planned: 'sleep',
      plannedNote: 'sleep',
    });
  });

  it('lists the first line of a summary that runs to several', async () => {
    await setup(new MemoryStore([blank(10, { note: 'fixed the collector\n\nthe retry loop, again' })]));
    expect(await screen.findByLabelText('10am: fixed the collector')).toBeTruthy();
  });

  it('answers a flag Yes or No for an hour, or leaves it unset', async () => {
    const { store, flags, onEditFlags } = await setup();
    await fireEvent.press(await screen.findByLabelText('9am: Deep work: proposals, done'));
    // Nothing is chosen to begin with: unset is neither Yes nor No.
    expect(screen.getByRole('radio', { name: 'Distracted: Yes', checked: false })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Distracted: No', checked: false })).toBeTruthy();

    await fireEvent.press(screen.getByRole('radio', { name: 'Distracted: Yes' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'HALTS: No' }));

    expect(await screen.findByLabelText('9am: Deep work: proposals, done, Distracted: Yes, HALTS: No')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Distracted: Yes', checked: true })).toBeTruthy();
    expect((await store.listDay('2026-11-19'))[0].flags).toEqual(['distracted:yes', 'halts:no']);

    // On the row each answered flag is its icon on the answer's color, at the right.
    const yes = screen.getByTestId('flag-distracted-yes');
    const no = screen.getByTestId('flag-halts-no');
    expect(yes).toHaveStyle({ backgroundColor: themes.light.palette.blue });
    expect(no).toHaveStyle({ backgroundColor: themes.light.palette.rose });
    expect(screen.queryByTestId('flag-mindful-yes')).toBeNull();

    // Another answer replaces the first, and pressing the chosen one unsets the flag.
    await fireEvent.press(screen.getByRole('radio', { name: 'Distracted: No' }));
    expect((await store.listDay('2026-11-19'))[0].flags).toEqual(['distracted:no', 'halts:no']);
    await fireEvent.press(screen.getByRole('radio', { name: 'HALTS: No' }));
    expect((await store.listDay('2026-11-19'))[0].flags).toEqual(['distracted:no']);

    // An archived flag leaves the editor, except on an hour that already carries it.
    await flags.getState().update('distracted', { archived: true });
    await flags.getState().update('mindful', { archived: true });
    expect(screen.getByRole('radio', { name: 'Distracted: Yes' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Mindful: Yes' })).toBeNull();

    await fireEvent.press(screen.getAllByText('Edit flags')[0]);
    expect(onEditFlags).toHaveBeenCalled();
  });

  it('reads a flag from before options as Yes, and offers a flag`s own options', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const flagStore = createFlagStore(rows);
    await flagStore.getState().load();
    await flagStore.getState().update('halts', {
      options: [
        { id: 'yes', label: 'Hungry', color: 'ochre' },
        { id: 'o1a2b3', label: 'Tired', color: 'night' },
        { id: 'no', label: 'No', color: 'rose', archived: true },
      ],
    });
    await setup(
      new MemoryStore([
        { day: '2026-11-19', hour: 9, note: 'scrolled', category: 'drift', planned: null, plannedNote: '', flags: ['distracted', 'halts:no'], state: 'open', updatedAt: 1 },
      ]),
      rows,
    );

    await fireEvent.press(await screen.findByLabelText('9am: Drift: scrolled, Distracted: Yes, HALTS: No'));
    expect(screen.getByRole('radio', { name: 'Distracted: Yes', checked: true })).toBeTruthy();
    // The flag's own options, plus the archived one this hour still carries.
    expect(screen.getByRole('radio', { name: 'HALTS: Hungry' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'HALTS: No', checked: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'HALTS: Tired' }));
    expect(await screen.findByLabelText('9am: Drift: scrolled, Distracted: Yes, HALTS: Tired')).toBeTruthy();
    expect(screen.getByTestId('flag-halts-o1a2b3')).toHaveStyle({
      backgroundColor: themes.light.palette.night,
    });
    // Once it is no longer chosen here, the archived option is not offered.
    expect(screen.queryByRole('radio', { name: 'HALTS: No' })).toBeNull();
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
    await fireEvent.press(screen.getByLabelText('Hours menu'));

    // An hour after midnight is written under the next calendar day.
    await fireEvent.press(screen.getByLabelText('2am: not yet'));
    await fireEvent.press(screen.getByRole('button', { name: 'Summary' }));
    await fireEvent.changeText(screen.getByLabelText('Summary of 2am'), 'sleep');
    expect((await store.listDay('2026-11-20')).find((e) => e.hour === 2)!.note).toBe('sleep');
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
