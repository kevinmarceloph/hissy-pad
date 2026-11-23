import { describe, expect, it } from 'vitest';
import { SAMPLE_CATEGORIES } from './categories';
import { applyPatch, DEED_EMPTY, EMPTY, firstLine, hasPlan, isLogged, planState, toggleDone, type Entry } from './entry';
import {
  activeFlags,
  activeOptions,
  cleanFlagIds,
  cleanIcon,
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

  it('is kept or missed by category only', () => {
    expect(planState(entry(9))).toBe('none');
    expect(planState(entry(9, { planned: 'deep' }))).toBe('open');
    expect(planState(entry(9, { planned: 'deep', note: 'scrolled' }))).toBe('open');
    expect(planState(entry(9, { planned: 'deep', category: 'deep' }))).toBe('kept');
    expect(planState(entry(9, { planned: 'deep', category: 'drift' }))).toBe('missed');
    // Words alone are never judged, even when they differ.
    expect(planState(entry(9, { plannedNote: 'proposals', note: 'scrolled', category: 'drift' }))).toBe('open');
  });

  it('shows the first line that says anything', () => {
    expect(firstLine('fix the collector\n\nthe five-minute one, again')).toBe('fix the collector');
    expect(firstLine('\n  \n  lunch  \nwith the team')).toBe('lunch');
    expect(firstLine('')).toBe('');
  });

  it('clears what happened and keeps the plan once the hour has started', () => {
    const lived = entry(9, { note: 'scrolled', category: 'drift', flags: ['distracted'], planned: 'deep', plannedNote: 'proposals' });
    expect(applyPatch(lived, TODAY, 9, DEED_EMPTY, 300)).toEqual({
      ...entry(9, { planned: 'deep', plannedNote: 'proposals' }),
      updatedAt: 300,
    });
  });

  it('patches the plan without touching what happened, and clears both', () => {
    const base = entry(9, { note: 'email', category: 'admin', updatedAt: 100 });
    const planned = applyPatch(base, TODAY, 9, { planned: 'deep', plannedNote: 'proposals' }, 200);
    expect(planned).toEqual({ ...base, planned: 'deep', plannedNote: 'proposals', updatedAt: 200 });
    expect(applyPatch(planned, TODAY, 9, { planned: null }, 300).planned).toBeNull();
    expect(applyPatch(planned, TODAY, 9, EMPTY, 300)).toEqual({ ...entry(9), updatedAt: 300 });
  });

  it('marks an hour done as planned with one tap, and not done with the next', () => {
    // Nothing to accept and nothing to put back: the box does nothing.
    expect(toggleDone(undefined)).toBeNull();
    expect(toggleDone(entry(9))).toBeNull();

    // Done takes the plan's words and its category.
    const planned = entry(9, { planned: 'sleep', plannedNote: 'sleep\nno phone' });
    const done = toggleDone(planned)!;
    expect(done).toEqual({ patch: { note: 'sleep\nno phone', category: 'sleep' } });
    const after = applyPatch(planned, TODAY, 9, done.patch, 2);
    expect(isLogged(after)).toBe(true);
    expect(planState(after)).toBe('kept');

    // Not done takes what happened and leaves the plan, and hands back what it took.
    const logged = { ...after, note: 'slept badly', flags: ['halts:yes'] };
    const undone = toggleDone(logged)!;
    expect(undone.patch).toBe(DEED_EMPTY);
    expect(undone.taken).toEqual({ note: 'slept badly', category: 'sleep', flags: ['halts:yes'] });
    const blank = applyPatch(logged, TODAY, 9, undone.patch, 3);
    expect(blank).toMatchObject({ note: '', category: null, flags: [], planned: 'sleep', plannedNote: 'sleep\nno phone' });

    // The next tap puts back what was taken, not the plan: a tap by mistake loses nothing.
    expect(toggleDone(blank, undone.taken)).toEqual({ patch: undone.taken });
    // That holds for an hour that never had a plan.
    expect(toggleDone(entry(9), { note: 'lunch', category: null, flags: [] })).toEqual({
      patch: { note: 'lunch', category: null, flags: [] },
    });
  });

  it('counts the planned hours and how many went as planned', () => {
    const rows = [
      entry(8, { planned: 'deep', category: 'deep' }),
      entry(9, { planned: 'deep', category: 'drift' }),
      entry(10, { planned: 'deep' }), // over and blank: due, not kept
      entry(11, { plannedNote: 'call the bank' }), // words alone: planned, never judged
      entry(16, { planned: 'body' }), // not yet: planned, not due
      entry(17, { planned: 'rest', category: 'rest' }), // logged ahead: already kept
    ];
    const summary = summarize(rows, TODAY, NOW, SAMPLE_CATEGORIES);
    expect(summary.planned).toBe(6);
    expect(summary.plan).toEqual({ due: 4, kept: 2 });
    expect(summary.byCategory.map((c) => `${c.category.id} ${c.hours}/${c.planned}`)).toEqual([
      'deep 1/3',
      'body 0/1',
      'rest 1/1',
      'drift 1/0',
    ]);
    // A plan is not a log: 10am and 11am are still blank.
    expect(summary.logged).toBe(3);
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
