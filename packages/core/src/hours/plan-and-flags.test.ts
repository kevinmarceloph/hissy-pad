import { describe, expect, it } from 'vitest';
import { cleanIcon, SAMPLE_CATEGORIES } from './categories';
import { applyPatch, EMPTY, firstLine, hasPlan, hourShown, hourState, isLogged, withState, type Entry } from './entry';
import {
  activeFlags,
  activeOptions,
  cleanFlagIds,
  cleanOptions,
  SAMPLE_FLAGS,
  DEFAULT_OPTIONS,
  flagChoice,
  flagChoices,
  flagLabelProblem,
  flagMark,
  flagOption,
  newFlag,
  newFlagId,
  newOptionId,
  nextOptionColor,
  optionLabelProblem,
  patchFlag,
  setFlagChoice,
} from './flags';
import { summarize } from './summary';

// Thursday 2026-11-19, 14:25 local: 14 hours are over.
const NOW = new Date(2026, 10, 19, 14, 25);
const TODAY = '2026-11-19';

const entry = (hour: number, over: Partial<Entry> = {}): Entry => ({
  day: TODAY,
  hour,
  note: '',
  category: null,
  planned: null,
  plannedNote: '',
  flags: [],
  state: 'open',
  updatedAt: 1,
  ...over,
});

describe('the plan', () => {
  it('is a category, words, or both, and is not a log', () => {
    expect(hasPlan(undefined)).toBe(false);
    expect(hasPlan(entry(9))).toBe(false);
    expect(hasPlan(entry(9, { plannedNote: '  ' }))).toBe(false);
    expect(hasPlan(entry(9, { planned: 'deep' }))).toBe(true);
    expect(hasPlan(entry(9, { plannedNote: 'proposals' }))).toBe(true);
    expect(isLogged(entry(9, { planned: 'deep', plannedNote: 'proposals' }))).toBe(false);
  });

  it('shows the first line that says anything', () => {
    expect(firstLine('fix the collector\n\nthe five-minute one, again')).toBe('fix the collector');
    expect(firstLine('\n  \n  lunch  \nwith the team')).toBe('lunch');
    expect(firstLine('')).toBe('');
  });

  it('patches the plan without touching what happened, and clears both', () => {
    const base = entry(9, { note: 'email', category: 'admin', updatedAt: 100 });
    const planned = applyPatch(base, TODAY, 9, { planned: 'deep', plannedNote: 'proposals' }, 200);
    expect(planned).toEqual({ ...base, planned: 'deep', plannedNote: 'proposals', updatedAt: 200 });
    expect(applyPatch(planned, TODAY, 9, { planned: null }, 300).planned).toBeNull();
    expect(applyPatch(planned, TODAY, 9, EMPTY, 300)).toEqual({ ...entry(9), updatedAt: 300 });
  });

  it('has a state of its own, set by a patch and kept by the others', () => {
    expect(hourState(undefined)).toBe('open');
    const done = applyPatch(entry(9, { note: 'email' }), TODAY, 9, { state: 'done' }, 200);
    expect(done).toMatchObject({ note: 'email', state: 'done' });
    expect(applyPatch(done, TODAY, 9, { note: 'email, then lunch' }, 300).state).toBe('done');
    expect(applyPatch(done, TODAY, 9, EMPTY, 300).state).toBe('open');
  });

  it('reads a row from before hours had a state as done when it was logged', () => {
    const { state: _none, ...old } = entry(9, { note: 'email' });
    expect(withState(old).state).toBe('done');
    const { state: _gone, ...blank } = entry(9, { planned: 'deep' });
    expect(withState(blank).state).toBe('open');
    expect(withState({ ...old, state: 'doing' }).state).toBe('doing');
    expect(withState({ ...old, state: 'kept' }).state).toBe('done');
  });

  it('shows its summary, or else the line on top of its list, or else what it falls back on', () => {
    const top = { text: 'write the proposal', category: 'deep' };
    expect(hourShown(undefined, undefined)).toEqual({ title: '', category: null, from: null });
    expect(hourShown(undefined, top)).toEqual({ title: 'write the proposal', category: 'deep', from: 'line' });
    // A summary wins over the line, and the hour's own category over the line's.
    expect(hourShown(entry(9, { note: 'proposals\nall morning' }), top)).toEqual({ title: 'proposals', category: 'deep', from: 'summary' });
    expect(hourShown(entry(9, { category: 'admin' }), top)).toEqual({ title: 'write the proposal', category: 'admin', from: 'line' });
    // With no line and no summary, a recurring plan's words and category.
    expect(hourShown(entry(9, { planned: 'sleep', plannedNote: 'sleep' }), undefined)).toEqual({ title: 'sleep', category: 'sleep', from: 'plan' });
    expect(hourShown(entry(9, { planned: 'sleep', plannedNote: 'sleep' }), top)).toMatchObject({ title: 'write the proposal', category: 'deep' });
  });

  it('counts the hours marked done, by the category each row shows', () => {
    const hour = (h: number, state: 'open' | 'doing' | 'done', category: string | null) => ({ day: TODAY, hour: h, state, category });
    const rows = [
      hour(8, 'done', 'deep'),
      hour(9, 'done', 'drift'),
      hour(10, 'open', 'deep'), // over and not confirmed
      hour(11, 'doing', 'deep'),
      hour(12, 'done', null),
      hour(17, 'done', 'rest'), // marked ahead of time
    ];
    const summary = summarize(rows, TODAY, NOW, SAMPLE_CATEGORIES);
    expect(summary.byCategory.map((c) => `${c.category.id} ${c.hours}`)).toEqual(['deep 1', 'rest 1', 'drift 1']);
    expect(summary).toMatchObject({ done: 4, untagged: 1, elapsed: 14, open: 11 });
  });
});

describe('flags', () => {
  it('has three sample flags', () => {
    expect(SAMPLE_FLAGS.map((f) => f.label)).toEqual(['Distracted', 'Mindful', 'HALTS']);
    for (const f of SAMPLE_FLAGS) {
      expect(f.updatedAt).toBe(0);
    }
  });

  it('keeps an hour`s answers as a sorted set of tokens', () => {
    expect(cleanFlagIds(['mindful:yes', 'halts:no', 'mindful:yes'])).toEqual(['halts:no', 'mindful:yes']);
    expect(applyPatch(undefined, TODAY, 9, { flags: ['mindful:no', 'halts:yes'] }, 5).flags).toEqual(['halts:yes', 'mindful:no']);
  });

  it('starts every flag unset, and takes Yes, No or unset again', () => {
    expect(flagChoice([], 'distracted')).toBeNull();
    const yes = setFlagChoice([], 'distracted', 'yes');
    expect(yes).toEqual(['distracted:yes']);
    const both = setFlagChoice(yes, 'mindful', 'no');
    expect(both).toEqual(['distracted:yes', 'mindful:no']);
    expect(flagChoice(both, 'mindful')).toBe('no');
    // Another answer replaces the first; null goes back to unset. Other flags stay.
    expect(setFlagChoice(both, 'distracted', 'no')).toEqual(['distracted:no', 'mindful:no']);
    expect(setFlagChoice(both, 'distracted', null)).toEqual(['mindful:no']);
  });

  it('reads a token from before options as Yes, and replaces it on the next answer', () => {
    expect(flagChoice(['distracted', 'halts'], 'halts')).toBe('yes');
    expect(flagChoices(['distracted', 'halts:o1a2b3'])).toEqual([
      { flag: 'distracted', option: 'yes' },
      { flag: 'halts', option: 'o1a2b3' },
    ]);
    expect(setFlagChoice(['distracted', 'halts'], 'distracted', 'no')).toEqual(['distracted:no', 'halts']);
    expect(setFlagChoice(['distracted', 'halts'], 'distracted', null)).toEqual(['halts']);
  });

  it('gives every flag Yes (blue) and No (rose), the same list the database defaults to', () => {
    expect(DEFAULT_OPTIONS).toEqual([
      { id: 'yes', label: 'Yes', color: 'blue' },
      { id: 'no', label: 'No', color: 'rose' },
    ]);
    for (const f of SAMPLE_FLAGS) expect(f.options).toEqual(DEFAULT_OPTIONS);
    expect(newFlag(SAMPLE_FLAGS, 'fnew000001', 'In flow', '', 5).options).toEqual(DEFAULT_OPTIONS);
  });

  it('cleans an option list and falls back to the defaults', () => {
    expect(cleanOptions('nope')).toEqual(DEFAULT_OPTIONS);
    expect(cleanOptions([{ id: 'yes', label: ' ' }, 7, null])).toEqual(DEFAULT_OPTIONS);
    expect(
      cleanOptions([
        { id: 'yes', label: ' Hungry ', color: 'ochre' },
        { id: 'yes', label: 'Twice', color: 'blue' },
        { id: 'o1a2b3', label: 'Tired', color: 'not a color', archived: true },
        { id: 'Bad Id', label: 'Dropped', color: 'blue' },
      ]),
    ).toEqual([
      { id: 'yes', label: 'Hungry', color: 'ochre' },
      { id: 'o1a2b3', label: 'Tired', color: 'stone', archived: true },
    ]);
    expect(cleanOptions(Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, label: `Option ${i}`, color: 'blue' })))).toHaveLength(8);
  });

  it('edits options through a flag patch', () => {
    const halts = SAMPLE_FLAGS[2]!;
    const options = [...halts.options, { id: 'o1a2b3', label: 'Tired', color: 'night' as const }];
    const next = patchFlag(halts, { options }, 5);
    expect(next.options).toHaveLength(3);
    expect(next.updatedAt).toBe(5);
    expect(flagOption(next, 'o1a2b3')?.label).toBe('Tired');
    expect(flagOption(next, 'gone')).toBeNull();

    const archived = patchFlag(next, { options: next.options.map((o) => (o.id === 'no' ? { ...o, archived: true } : o)) }, 6);
    expect(activeOptions(archived).map((o) => o.label)).toEqual(['Yes', 'Tired']);
    // An archived option still answers for the hours that carry it.
    expect(flagOption(archived, 'no')?.color).toBe('rose');
    // A rename leaves the options alone.
    expect(patchFlag(archived, { label: 'Needs' }, 7).options).toEqual(archived.options);
  });

  it('names what is wrong with an option label, and picks a fresh id and color', () => {
    expect(optionLabelProblem(DEFAULT_OPTIONS, ' ')).toBe('An option needs a name.');
    expect(optionLabelProblem(DEFAULT_OPTIONS, 'yes')).toBe('This flag already has an option called Yes.');
    expect(optionLabelProblem(DEFAULT_OPTIONS, 'YES', 'yes')).toBeNull();
    expect(newOptionId(() => 0.5)).toMatch(/^o[a-z0-9]{5}$/);
    expect(nextOptionColor(DEFAULT_OPTIONS)).toBe('sky');
  });

  it('counts a flagged hour as logged', () => {
    expect(isLogged(entry(9, { flags: ['distracted:yes'] }))).toBe(true);
    // No is an answer too.
    expect(isLogged(entry(9, { flags: ['distracted:no'] }))).toBe(true);
  });

  it('takes one emoji as an icon and falls back to a letter', () => {
    expect(cleanIcon('  🧘  ')).toBe('🧘');
    expect(cleanIcon('🛑🛑 stop')).toBe('🛑');
    expect(cleanIcon('')).toBe('');
    expect(patchFlag(SAMPLE_FLAGS[0]!, { icon: '📱 phone' }, 5).icon).toBe('📱');
    expect(patchFlag(SAMPLE_FLAGS[0]!, { label: 'Scattered' }, 5).icon).toBe('😵');
    expect(flagMark(SAMPLE_FLAGS[2]!)).toBe('🛑');
    expect(flagMark({ icon: '', label: 'in flow' })).toBe('I');
  });

  it('adds, renames and archives like a category', () => {
    expect(flagLabelProblem(SAMPLE_FLAGS, ' ')).toBe('A flag needs a name.');
    expect(flagLabelProblem(SAMPLE_FLAGS, 'halts')).toBe('You already have a flag called HALTS.');
    expect(flagLabelProblem(SAMPLE_FLAGS, 'HALTS', 'halts')).toBeNull();

    const added = newFlag(SAMPLE_FLAGS, 'fabc', '  In   flow ', ' 🌊 extra', 500);
    expect(added).toEqual({ id: 'fabc', label: 'In flow', icon: '🌊', position: 3, archived: false, options: DEFAULT_OPTIONS, updatedAt: 500 });

    const archived = patchFlag(SAMPLE_FLAGS[1]!, { archived: true }, 0);
    expect(archived.updatedAt).toBe(1); // never older than the row it edits
    expect(activeFlags([...SAMPLE_FLAGS.filter((f) => f.id !== 'mindful'), archived, added]).map((f) => f.id)).toEqual([
      'distracted',
      'halts',
      'fabc',
    ]);
    expect(newFlagId(() => 0.5)).toMatch(/^f[a-z0-9]{9}$/);
  });
});
