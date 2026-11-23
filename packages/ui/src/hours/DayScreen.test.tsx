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

const seed: Entry[] = [
  { day: '2026-11-19', hour: 9, note: 'proposals', category: 'deep', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
  { day: '2026-11-18', hour: 22, note: '', category: 'sleep', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
];

// Entries can come from any EntryStore (some tests break it); categories from memory.
async function setup(store: EntryStore = new MemoryStore(seed, SAMPLE_CATEGORIES, SAMPLE_FLAGS), categoryRows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS)) {
  const day = createDayStore(store, clock);
  const categories = createCategoryStore(categoryRows);
  const flags = createFlagStore(categoryRows);
  const recurring = createRecurringStore(categoryRows, { clock });
  await categories.getState().load();
  await flags.getState().load();
  await recurring.getState().load();
  const onEditCategories = vi.fn();
  const onEditFlags = vi.fn();
  const onEditPlans = vi.fn();
  await render(
    <StoresProvider day={day} categories={categories} flags={flags} recurring={recurring}>
      <DayScreen clock={clock} onEditCategories={onEditCategories} onEditFlags={onEditFlags} onEditPlans={onEditPlans} />
    </StoresProvider>,
  );
  return { store, day, categories, flags, recurring, onEditCategories, onEditFlags, onEditPlans };
}

describe('DayScreen', () => {
  it('shows today, what is accounted for and the hour in progress', async () => {
    await setup();
    expect(await screen.findByLabelText(/1 of 14 hours accounted for\./)).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Thu, Nov 19')).toBeTruthy();
    expect(screen.getByLabelText('9am: Deep work: proposals')).toBeTruthy();
    expect(screen.getByLabelText('2pm, now: blank')).toBeTruthy();
    expect(screen.getByLabelText('3pm: not yet')).toBeTruthy();
    expect(screen.getByLabelText(/Blank 13h/)).toBeTruthy();
  });

  it('logs an hour with a note and a category', async () => {
    const { store } = await setup();
    await fireEvent.press(await screen.findByLabelText('10am: blank'));
    await fireEvent.changeText(screen.getByLabelText('What happened at 10am?'), 'lunch');
    await fireEvent.press(screen.getByLabelText('Where it went: None'));
    await fireEvent.press(screen.getByRole('option', { name: 'Body' }));
    // Choosing closes the list and the closed line says what was chosen.
    expect(screen.queryByRole('option', { name: 'Body' })).toBeNull();
    expect(screen.getByLabelText('Where it went: Body')).toBeTruthy();
    await fireEvent.press(screen.getByText('Done'));

    expect(await screen.findByLabelText('10am: Body: lunch')).toBeTruthy();
    expect(screen.getByLabelText(/2 of 14 hours accounted for\./)).toBeTruthy();
    expect((await store.listDay('2026-11-19')).find((e) => e.hour === 10)).toMatchObject({
      note: 'lunch',
      category: 'body',
    });
  });

  it('clears an hour back to blank', async () => {
    const { store } = await setup();
    await fireEvent.press(await screen.findByLabelText('9am: Deep work: proposals'));
    await fireEvent.press(screen.getByText('Clear this hour'));
    await fireEvent.press(screen.getByText('Done'));

    expect(await screen.findByLabelText('9am: blank')).toBeTruthy();
    expect((await store.listDay('2026-11-19'))[0]).toMatchObject({ note: '', category: null });
  });

  it('moves to another day and back', async () => {
    await setup();
    await fireEvent.press(await screen.findByLabelText('Earlier'));
    expect(await screen.findByText('Yesterday')).toBeTruthy();
    expect(screen.getByLabelText('10pm: Sleep')).toBeTruthy();
    expect(screen.getByLabelText(/1 of 24 hours accounted for\./)).toBeTruthy();

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
      { day: '2026-11-19', hour: 8, note: '', category: 'drift', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
      { day: '2026-11-19', hour: 9, note: 'proposals', category: 'deep', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
      { day: '2026-11-19', hour: 10, note: '', category: 'cnotyet001', planned: null, plannedNote: '', flags: [], updatedAt: 1 },
    ];
    const { categories, onEditCategories } = await setup(new MemoryStore(rows));
    await categories.getState().update('deep', { label: 'Focus' });
    await categories.getState().update('drift', { archived: true });

    // A rename reaches the row and the legend; an archived category keeps its hours.
    expect(await screen.findByLabelText('9am: Focus: proposals')).toBeTruthy();
    expect(screen.getByLabelText(/Focus 1h/)).toBeTruthy();
    expect(screen.getByLabelText('8am: Drift')).toBeTruthy();
    // An id with no category on this device reads as untagged.
    expect(screen.getByLabelText('10am: Untagged')).toBeTruthy();
    expect(screen.getByLabelText(/Untagged 1h/)).toBeTruthy();

    // The picker leaves the archived one out, except on the hour that already has it.
    await fireEvent.press(screen.getByLabelText('9am: Focus: proposals'));
    await fireEvent.press(screen.getByLabelText('Where it went: Focus'));
    expect(screen.getByRole('option', { name: 'Admin' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Drift' })).toBeNull();
    await fireEvent.press(screen.getByLabelText('8am: Drift'));
    await fireEvent.press(screen.getByLabelText('Where it went: Drift'));
    expect(screen.getByRole('option', { name: 'Drift' })).toBeTruthy();
    // None takes the category off.
    await fireEvent.press(screen.getByRole('option', { name: 'None' }));
    expect(screen.getByLabelText('Where it went: None')).toBeTruthy();

    // The hour editor has no way out to the category list; the foot of the day does.
    expect(screen.queryByText('Edit categories')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Hours menu'));
    await fireEvent.press(screen.getByLabelText('Edit categories'));
    expect(onEditCategories).toHaveBeenCalled();
  });

  it('shows a category by the part of its name before an em dash, in the rows and the legend', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    const { categories } = await setup(new MemoryStore([{ ...seed[0], planned: 'body' }]), rows);
    await categories.getState().update('deep', { label: '\u{1F4BB} \u2014 Deep work, no chat' });
    await categories.getState().update('body', { label: 'Body \u2014 gym or a run' });

    // The row says the short names, the done one and the planned one.
    expect(await screen.findByLabelText('9am: \u{1F4BB}: proposals, planned Body')).toBeTruthy();
    // So does the legend. The pickers say all of it.
    expect(screen.getByLabelText(/\u{1F4BB} 1h/u)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('9am: \u{1F4BB}: proposals, planned Body'));
    expect(screen.getByLabelText('Where it went: \u{1F4BB} \u2014 Deep work, no chat')).toBeTruthy();
    expect(screen.getByText('Planned: Body \u2014 gym or a run')).toBeTruthy();
  });

  it('plans an hour that has not come, in words and by category', async () => {
    const { store } = await setup();
    await fireEvent.press(await screen.findByLabelText('4pm: not yet'));
    // Ahead of time there is only the plan to write.
    expect(screen.queryByLabelText('What happened at 4pm?')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('What is 4pm for?'), 'proposals');
    await fireEvent.press(screen.getByLabelText('Where it should go: None'));
    await fireEvent.press(screen.getByRole('option', { name: 'Deep work' }));
    await fireEvent.press(screen.getByText('Done'));

    expect(await screen.findByLabelText('4pm: planned Deep work: proposals')).toBeTruthy();
    expect(screen.getByLabelText(/Deep work 1h, 1h planned/)).toBeTruthy();
    expect((await store.listDay('2026-11-19')).find((e) => e.hour === 16)).toMatchObject({
      planned: 'deep',
      plannedNote: 'proposals',
      category: null,
      note: '',
    });
  });

  it('says in words whether an hour went as planned', async () => {
    const rows: Entry[] = [
      { ...seed[0], planned: 'deep', plannedNote: 'proposals' },
      { day: '2026-11-19', hour: 10, note: 'scrolled', category: 'drift', planned: 'deep', plannedNote: '', flags: [], updatedAt: 1 },
      { day: '2026-11-19', hour: 11, note: '', category: null, planned: 'body', plannedNote: 'gym', flags: [], updatedAt: 1 },
    ];
    await setup(new MemoryStore(rows));
    expect(await screen.findByLabelText('9am: Deep work: proposals, as planned')).toBeTruthy();
    expect(screen.getByLabelText('10am: Drift: scrolled, planned Deep work')).toBeTruthy();
    expect(screen.getByLabelText('11am: blank, planned Body: gym')).toBeTruthy();
    expect(screen.getByLabelText(/1 of 3 planned hours went as planned\./)).toBeTruthy();
  });

  it('closes the plan once the hour has started and starts what happened from it', async () => {
    const rows: Entry[] = [
      { day: '2026-11-19', hour: 11, note: '', category: null, planned: 'body', plannedNote: 'gym\nlegs, then a short run', flags: [], updatedAt: 1 },
    ];
    const { store } = await setup(new MemoryStore(rows));
    // The list shows the first line of the plan only.
    await fireEvent.press(await screen.findByLabelText('11am: blank, planned Body: gym'));

    // One text field: what happened, holding the plan's words. The plan itself is there to read.
    expect(screen.getByLabelText('What happened at 11am?').value).toBe('gym\nlegs, then a short run');
    expect(screen.queryByLabelText('What is 11am for?')).toBeNull();
    expect(screen.queryByLabelText(/^Where it should go/)).toBeNull();
    expect(screen.getByText('Planned: Body')).toBeTruthy();
    expect(screen.queryByText('Copy from the plan')).toBeNull();

    // Opening and leaving logs nothing.
    await fireEvent.blur(screen.getByLabelText('What happened at 11am?'));
    expect((await store.listDay('2026-11-19'))[0].note).toBe('');

    // Done takes the plan as what happened: its words and its category.
    await fireEvent.press(screen.getByText('Done'));
    expect(await screen.findByLabelText('11am: Body: gym, as planned')).toBeTruthy();
    expect((await store.listDay('2026-11-19'))[0]).toMatchObject({
      note: 'gym\nlegs, then a short run',
      category: 'body',
      planned: 'body',
      plannedNote: 'gym\nlegs, then a short run',
    });

    // Clearing it takes what happened and leaves the plan.
    await fireEvent.press(screen.getByLabelText('11am: Body: gym, as planned'));
    await fireEvent.press(screen.getByText('Clear this hour'));
    await fireEvent.press(screen.getByText('Done'));
    expect(await screen.findByLabelText('11am: blank, planned Body: gym')).toBeTruthy();
  });

  it('offers the planned category as where the hour went', async () => {
    const rows: Entry[] = [
      { day: '2026-11-19', hour: 10, note: '', category: null, planned: 'body', plannedNote: 'gym', flags: [], updatedAt: 1 },
      { day: '2026-11-19', hour: 11, note: '', category: null, planned: 'body', plannedNote: 'gym', flags: [], updatedAt: 1 },
      { day: '2026-11-19', hour: 12, note: '', category: null, planned: 'body', plannedNote: 'gym', flags: [], updatedAt: 1 },
    ];
    const { store } = await setup(new MemoryStore(rows));
    const at = async (hour: number) => (await store.listDay('2026-11-19')).find((e) => e.hour === hour);

    // It comes chosen, marked as the plan's. Opening and leaving still logs nothing.
    await fireEvent.press(await screen.findByLabelText('10am: blank, planned Body: gym'));
    expect(screen.getByLabelText('Where it went: Body, from the plan')).toBeTruthy();
    await fireEvent.blur(screen.getByLabelText('What happened at 10am?'));
    expect(await at(10)).toMatchObject({ note: '', category: null });

    // Words typed and left go in with it.
    await fireEvent.changeText(screen.getByLabelText('What happened at 10am?'), 'gym, short');
    await fireEvent.blur(screen.getByLabelText('What happened at 10am?'));
    expect(await at(10)).toMatchObject({ note: 'gym, short', category: 'body' });
    await fireEvent.press(screen.getByText('Done'));

    // Another category can be chosen in its place.
    await fireEvent.press(screen.getByLabelText('11am: blank, planned Body: gym'));
    await fireEvent.press(screen.getByLabelText('Where it went: Body, from the plan'));
    await fireEvent.press(screen.getByRole('option', { name: 'Admin' }));
    expect(screen.getByLabelText('Where it went: Admin')).toBeTruthy();
    await fireEvent.press(screen.getByText('Done'));
    expect(await at(11)).toMatchObject({ note: 'gym', category: 'admin', planned: 'body' });

    // So can none at all, and Done does not bring the plan's back.
    await fireEvent.press(screen.getByLabelText('12pm: blank, planned Body: gym'));
    await fireEvent.press(screen.getByLabelText('Where it went: Body, from the plan'));
    await fireEvent.press(screen.getByRole('option', { name: 'None' }));
    expect(screen.getByLabelText('Where it went: None')).toBeTruthy();
    await fireEvent.press(screen.getByText('Done'));
    expect(await at(12)).toMatchObject({ note: 'gym', category: null, planned: 'body' });
  });

  it('does not write an open editor\'s old words over an edit that landed under it', async () => {
    const { store, day } = await setup();
    await fireEvent.press(await screen.findByLabelText('9am: Deep work: proposals'));
    expect(screen.getByLabelText('What happened at 9am?').value).toBe('proposals');

    // Another device rewrites the hour and sync lands it while the editor is open.
    await (store as MemoryStore).sync.entries.applyRemote([{ ...seed[0], note: 'proposals, then a call', updatedAt: 2 }]);
    await act(async () => {
      await day.getState().refresh();
    });
    expect(screen.getByLabelText('What happened at 9am?').value).toBe('proposals, then a call');

    // Leaving the field changes nothing: the draft held no typing of its own.
    await fireEvent.blur(screen.getByLabelText('What happened at 9am?'));
    await fireEvent.press(screen.getByText('Done'));
    expect((await store.listDay('2026-11-19'))[0]).toMatchObject({ note: 'proposals, then a call', updatedAt: 2 });
  });

  it('keeps what is being typed when an edit lands under the editor', async () => {
    const { store, day } = await setup();
    await fireEvent.press(await screen.findByLabelText('9am: Deep work: proposals'));
    await fireEvent.changeText(screen.getByLabelText('What happened at 9am?'), 'proposals and invoices');
    await (store as MemoryStore).sync.entries.applyRemote([{ ...seed[0], category: 'admin', updatedAt: 2 }]);
    await act(async () => {
      await day.getState().refresh();
    });
    expect(screen.getByLabelText('What happened at 9am?').value).toBe('proposals and invoices');
  });

  it('keeps a recurring plan\'s words when the plan is made under an open editor', async () => {
    const { store, recurring } = await setup();
    // 2am is open with its plan fields showing and no plan: nothing typed.
    await fireEvent.press(await screen.findByLabelText('2am: blank'));
    await fireEvent.press(screen.getByLabelText('Edit the plan'));
    expect(screen.getByLabelText('What was 2am for?').value).toBe('');

    await act(async () => {
      await recurring.getState().add({ note: 'Sleep', category: 'sleep', from: 2, to: 10, days: [0, 1, 2, 3, 4, 5, 6] });
    });
    expect(screen.getByLabelText('What was 2am for?').value).toBe('Sleep');

    // Logging the hour pins the plan as it is now, words included.
    await fireEvent.changeText(screen.getByLabelText('What happened at 2am?'), 'drafted a message');
    await fireEvent.press(screen.getByText('Done'));
    expect((await store.listDay('2026-11-19')).find((e) => e.hour === 2)).toMatchObject({
      note: 'drafted a message',
      planned: 'sleep',
      plannedNote: 'Sleep',
    });
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
    expect(await screen.findByLabelText('10am: Deep work: from the laptop')).toBeTruthy();
  });

  it('marks an hour done as planned with a tap on its box, and not done with another', async () => {
    const rows: Entry[] = [
      { day: '2026-11-19', hour: 11, note: '', category: null, planned: 'body', plannedNote: 'gym\nlegs', flags: [], updatedAt: 1 },
      // The hour in progress can be marked too. One still ahead cannot.
      { day: '2026-11-19', hour: 14, note: '', category: null, planned: 'deep', plannedNote: '', flags: [], updatedAt: 1 },
      { day: '2026-11-19', hour: 16, note: '', category: null, planned: 'deep', plannedNote: '', flags: [], updatedAt: 1 },
    ];
    const { store } = await setup(new MemoryStore(rows));
    const at = async (hour: number) => (await store.listDay('2026-11-19')).find((e) => e.hour === hour);

    // The box is a checkbox beside the row's own button. An hour with no plan and nothing
    // logged has none, and neither does an hour that has not come.
    expect(await screen.findByRole('checkbox', { name: '11am done as planned', checked: false })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /^10am/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^4pm/ })).toBeNull();

    // One tap takes the plan as what happened: its words and its category.
    await fireEvent.press(screen.getByRole('checkbox', { name: '11am done as planned' }));
    expect(await screen.findByLabelText('11am: Body: gym, as planned')).toBeTruthy();
    expect(await at(11)).toMatchObject({ note: 'gym\nlegs', category: 'body', planned: 'body', plannedNote: 'gym\nlegs' });
    await fireEvent.press(screen.getByRole('checkbox', { name: '2pm done as planned' }));
    expect(await screen.findByLabelText('2pm, now: Deep work, as planned')).toBeTruthy();

    // The next tap takes it back and keeps the plan.
    await fireEvent.press(screen.getByRole('checkbox', { name: '11am done', checked: true }));
    expect(await screen.findByLabelText('11am: blank, planned Body: gym')).toBeTruthy();
    expect(await at(11)).toMatchObject({ note: '', category: null, planned: 'body', plannedNote: 'gym\nlegs' });
  });

  it('puts back what a tap on the box took away, words typed by hand included', async () => {
    const { store } = await setup();
    // 9am was logged by hand and never had a plan.
    await fireEvent.press(await screen.findByRole('checkbox', { name: '9am done', checked: true }));
    expect(await screen.findByLabelText('9am: blank')).toBeTruthy();
    expect((await store.listDay('2026-11-19'))[0]).toMatchObject({ note: '', category: null });

    // The box stays, though the hour has no plan: one more tap undoes the mistake.
    await fireEvent.press(screen.getByRole('checkbox', { name: '9am done as planned', checked: false }));
    expect(await screen.findByLabelText('9am: Deep work: proposals')).toBeTruthy();
    expect((await store.listDay('2026-11-19'))[0]).toMatchObject({ note: 'proposals', category: 'deep' });
  });

  it('draws a recurring plan on the hours it covers and pins it when an hour is marked done', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    // Made earlier in the month: sleep from 2am to 10am, every day.
    await rows.putRecurring({ id: 'rsleep0001', note: 'sleep', category: 'sleep', from: 2, to: 10, days: [0, 1, 2, 3, 4, 5, 6], since: '2026-11-01', position: 0, archived: false, updatedAt: 1 });
    const { store, recurring, onEditPlans } = await setup(undefined, rows);
    const at = async (hour: number) => (await store.listDay('2026-11-19')).find((e) => e.hour === hour);

    // Eight hours come planned, with nothing stored for them. 9am has its own log.
    expect(await screen.findByLabelText('2am: blank, planned Sleep: sleep')).toBeTruthy();
    expect(screen.getByLabelText('8am: blank, planned Sleep: sleep')).toBeTruthy();
    expect(screen.getByLabelText('9am: Deep work: proposals, planned Sleep')).toBeTruthy();
    expect(screen.getByLabelText('1am: blank')).toBeTruthy();
    expect(screen.getByLabelText('10am: blank')).toBeTruthy();
    expect(screen.getByLabelText(/0 of 8 planned hours went as planned\./)).toBeTruthy();
    expect(await at(2)).toBeUndefined();

    // One tap marks an hour done, and writes the plan it was showing into the row.
    await fireEvent.press(screen.getByRole('checkbox', { name: '2am done as planned' }));
    expect(await screen.findByLabelText('2am: Sleep: sleep, as planned')).toBeTruthy();
    expect(await at(2)).toMatchObject({ note: 'sleep', category: 'sleep', planned: 'sleep', plannedNote: 'sleep' });

    // The plan changes: hours not lived yet follow, the one marked done keeps its own.
    await recurring.getState().update('rsleep0001', { note: 'sleep, no phone', to: 8 });
    expect(await screen.findByLabelText('3am: blank, planned Sleep: sleep, no phone')).toBeTruthy();
    expect(screen.getByLabelText('2am: Sleep: sleep, as planned')).toBeTruthy();
    expect(screen.getByLabelText('8am: blank')).toBeTruthy();

    // The recurring plans have their own button at the foot of the day, not a place in Settings.
    await fireEvent.press(screen.getByLabelText('Hours menu'));
    expect(screen.queryByText(/2am-8am/)).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: 'Edit recurring plans' }));
    expect(onEditPlans).toHaveBeenCalled();
  });

  it('keeps an hour`s own plan over a recurring one', async () => {
    const rows = new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS);
    await rows.putRecurring({ id: 'rsleep0001', note: 'sleep', category: 'sleep', from: 2, to: 10, days: [0, 1, 2, 3, 4, 5, 6], since: '2026-11-01', position: 0, archived: false, updatedAt: 1 });
    const own: Entry = { day: '2026-11-19', hour: 3, note: '', category: null, planned: 'people', plannedNote: 'airport run', flags: [], updatedAt: 1 };
    const { store } = await setup(new MemoryStore([own]), rows);
    expect(await screen.findByLabelText('3am: blank, planned People: airport run')).toBeTruthy();

    // An edit in the editor of a recurring hour pins the plan too.
    await fireEvent.press(screen.getByLabelText('4am: blank, planned Sleep: sleep'));
    expect(screen.getByText('Recurring plan: Sleep')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happened at 4am?'), 'awake, reading');
    await fireEvent.press(screen.getByText('Done'));
    expect((await store.listDay('2026-11-19')).find((e) => e.hour === 4)).toMatchObject({
      note: 'awake, reading',
      // The planned category came chosen and was left as it was.
      category: 'sleep',
      planned: 'sleep',
      plannedNote: 'sleep',
    });
  });

  it('opens the plan of an hour that has started only when asked', async () => {
    const rows: Entry[] = [
      { day: '2026-11-19', hour: 11, note: 'email', category: 'admin', planned: 'body', plannedNote: 'gym', flags: [], updatedAt: 1 },
    ];
    const { store } = await setup(new MemoryStore(rows));
    await fireEvent.press(await screen.findByLabelText('11am: Admin: email, planned Body'));

    // The plan is there to read, words and category, and cannot be typed into.
    expect(screen.getByText('Planned: Body')).toBeTruthy();
    expect(screen.getByText('gym')).toBeTruthy();
    expect(screen.queryByLabelText('What was 11am for?')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Edit the plan'));
    await fireEvent.changeText(screen.getByLabelText('What was 11am for?'), 'gym, legs');
    await fireEvent.press(screen.getByLabelText('Where it was meant to go: Body'));
    await fireEvent.press(screen.getByRole('option', { name: 'Admin' }));
    await fireEvent.press(screen.getByText('Done'));

    expect(await screen.findByLabelText('11am: Admin: email, as planned')).toBeTruthy();
    expect((await store.listDay('2026-11-19'))[0]).toMatchObject({
      note: 'email',
      category: 'admin',
      planned: 'admin',
      plannedNote: 'gym, legs',
    });
  });

  it('plans the hour in progress', async () => {
    const { store } = await setup();
    await fireEvent.press(await screen.findByLabelText('2pm, now: blank'));
    expect(screen.getByText('No plan for this hour')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Edit the plan'));
    await fireEvent.changeText(screen.getByLabelText('What is 2pm for?'), 'proposals');
    await fireEvent.press(screen.getByLabelText('Where it should go: None'));
    await fireEvent.press(screen.getByRole('option', { name: 'Deep work' }));
    await fireEvent.press(screen.getByText('Done'));

    // A plan is not a log: the hour is still open, with its plan on the row.
    expect(await screen.findByLabelText('2pm, now: planned Deep work: proposals')).toBeTruthy();
    expect((await store.listDay('2026-11-19')).find((e) => e.hour === 14)).toMatchObject({
      note: '',
      category: null,
      planned: 'deep',
      plannedNote: 'proposals',
    });
  });

  it('keeps a text of several lines and lists its first', async () => {
    const { store } = await setup();
    await fireEvent.press(await screen.findByLabelText('10am: blank'));
    await fireEvent.changeText(screen.getByLabelText('What happened at 10am?'), 'fixed the collector\n\nthe retry loop, again');
    await fireEvent.press(screen.getByText('Done'));

    expect(await screen.findByLabelText('10am: fixed the collector')).toBeTruthy();
    expect((await store.listDay('2026-11-19')).find((e) => e.hour === 10)!.note).toBe('fixed the collector\n\nthe retry loop, again');
  });

  it('answers a flag Yes or No for an hour, or leaves it unset', async () => {
    const { store, flags, onEditFlags } = await setup();
    await fireEvent.press(await screen.findByLabelText('9am: Deep work: proposals'));
    // Nothing is chosen to begin with: unset is neither Yes nor No.
    expect(screen.getByRole('radio', { name: 'Distracted: Yes', checked: false })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Distracted: No', checked: false })).toBeTruthy();

    await fireEvent.press(screen.getByRole('radio', { name: 'Distracted: Yes' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'HALTS: No' }));

    expect(await screen.findByLabelText('9am: Deep work: proposals, Distracted: Yes, HALTS: No')).toBeTruthy();
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
        { day: '2026-11-19', hour: 9, note: 'scrolled', category: 'drift', planned: null, plannedNote: '', flags: ['distracted', 'halts:no'], updatedAt: 1 },
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
    await (store as MemoryStore).sync.entries.applyRemote([
      { day: '2026-11-19', hour: 10, note: 'from the phone', category: 'body', planned: null, plannedNote: '', flags: [], updatedAt: 5 },
    ]);
    await day.getState().refresh();
    expect(await screen.findByLabelText('10am: Body: from the phone')).toBeTruthy();
    expect(screen.queryByText(/^Opening/)).toBeNull();
  });

  it('says so when a day has nothing in it', async () => {
    await setup(new MemoryStore([], SAMPLE_CATEGORIES, SAMPLE_FLAGS));
    expect(await screen.findByLabelText(/Nothing logged for this day yet\./)).toBeTruthy();
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
    expect(await screen.findByLabelText(/1 of 14 hours accounted for\./)).toBeTruthy();
  });

  it('lets the day start at another hour', async () => {
    const rows: Entry[] = [
      ...seed,
      { day: '2026-11-20', hour: 1, note: 'could not sleep', category: null, planned: null, plannedNote: '', flags: [], updatedAt: 1 },
    ];
    const { store, day } = await setup(new MemoryStore(rows));
    expect(await screen.findByLabelText(/1 of 14 hours accounted for\./)).toBeTruthy();
    expect(screen.queryByLabelText('1am: could not sleep')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Hours menu'));
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(screen.getByText('Day starts at 12am')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: '6am' }));

    // 6am to 6am: eight hours are over at 2:25pm, and Friday's 1am is part of Thursday.
    expect(await screen.findByLabelText(/1 of 8 hours accounted for\./)).toBeTruthy();
    // Choosing closes the settings; opening them again shows the choice.
    expect(screen.queryByText('Day starts at 12am')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Hours menu'));
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(screen.getByText('Day starts at 6am')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '6am', checked: true })).toBeTruthy();
    expect(screen.getByLabelText('1am: could not sleep')).toBeTruthy();
    expect(day.getState().start).toBe(6);

    // An hour after midnight is written under the next calendar day.
    await fireEvent.press(screen.getByLabelText('2am: not yet'));
    await fireEvent.changeText(screen.getByLabelText('What is 2am for?'), 'sleep');
    await fireEvent.press(screen.getByText('Done'));
    expect((await store.listDay('2026-11-20')).find((e) => e.hour === 2)!.plannedNote).toBe('sleep');
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
