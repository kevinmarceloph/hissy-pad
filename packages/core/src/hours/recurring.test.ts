import { describe, expect, it } from 'vitest';
import { applyPatch, type Entry } from './entry';
import {
  cleanDays,
  covers,
  daysLabel,
  EVERY_DAY,
  newRecurring,
  newRecurringId,
  patchRecurring,
  pinRecurring,
  recurringAt,
  recurringProblem,
  spanHours,
  spanLabel,
  toggleDay,
  withRecurring,
  type RecurringPlan,
} from './recurring';

// 2026-11-21 is a Saturday, 2026-11-22 a Sunday, 2026-11-20 a Friday.
const FRI = '2026-11-20';
const SAT = '2026-11-21';
const SUN = '2026-11-22';

const plan = (over: Partial<RecurringPlan> = {}): RecurringPlan => ({
  id: 'rsleep0001',
  note: 'sleep',
  category: 'sleep',
  from: 2,
  to: 10,
  days: [...EVERY_DAY],
  since: '2026-11-01',
  position: 0,
  archived: false,
  updatedAt: 1,
  ...over,
});

const hoursOn = (p: RecurringPlan, day: string) => Array.from({ length: 24 }, (_, h) => h).filter((h) => covers(p, day, h));

describe('a recurring plan', () => {
  it('covers its hours, up to and not including the last', () => {
    // 2am to 9:30am, rounded up to 10am: eight hours, 2am through 9am.
    expect(hoursOn(plan(), SAT)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(spanHours(2, 10)).toBe(8);
    expect(spanLabel(2, 10)).toBe('2am-10am');
  });

  it('runs across midnight and belongs to the day it starts on', () => {
    const night = plan({ from: 22, to: 3, days: [5] }); // Fridays
    expect(spanHours(22, 3)).toBe(5);
    expect(hoursOn(night, FRI)).toEqual([22, 23]);
    // The small hours of Saturday are Friday's run.
    expect(hoursOn(night, SAT)).toEqual([0, 1, 2]);
    expect(hoursOn(night, SUN)).toEqual([]);
  });

  it('covers a whole day when both ends are the same hour', () => {
    const off = plan({ from: 6, to: 6, days: [6] }); // Saturdays, from 6am
    expect(spanHours(6, 6)).toBe(24);
    expect(hoursOn(off, SAT)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(hoursOn(off, SUN)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(spanLabel(6, 6)).toBe('all day from 6am');
  });

  it('keeps to its weekdays', () => {
    const weekdays = plan({ days: [1, 2, 3, 4, 5] });
    expect(covers(weekdays, FRI, 3)).toBe(true);
    expect(covers(weekdays, SAT, 3)).toBe(false);
    expect(covers(plan({ days: [] }), SAT, 3)).toBe(false);
  });

  it('leaves the days before it was made alone, and nothing once archived', () => {
    const made = plan({ since: SAT });
    expect(covers(made, FRI, 3)).toBe(false);
    expect(covers(made, SAT, 3)).toBe(true);
    // A run that started the night before it was made is not its own.
    const night = plan({ from: 22, to: 6, since: SAT });
    expect(covers(night, SAT, 1)).toBe(false);
    expect(covers(night, SAT, 23)).toBe(true);
    expect(covers(plan({ archived: true }), SAT, 3)).toBe(false);
  });

  it('gives way to a plan on fewer days, then to the one listed first', () => {
    const sleep = plan();
    const church = plan({ id: 'rchurch001', note: 'church', category: 'people', from: 9, to: 11, days: [0], position: 1 });
    const list = [sleep, church];
    expect(recurringAt(list, SUN, 9)?.id).toBe('rchurch001');
    expect(recurringAt(list, SUN, 8)?.id).toBe('rsleep0001');
    expect(recurringAt(list, SAT, 9)?.id).toBe('rsleep0001');
    expect(recurringAt(list, SAT, 12)).toBeUndefined();

    const nap = plan({ id: 'rnap000001', note: 'nap', from: 9, to: 10, position: 2 });
    expect(recurringAt([nap, sleep], SAT, 9)?.id).toBe('rsleep0001');
  });

  it('says its days in words', () => {
    expect(daysLabel(EVERY_DAY)).toBe('every day');
    expect(daysLabel([1, 2, 3, 4, 5])).toBe('weekdays');
    expect(daysLabel([6, 0])).toBe('weekends');
    expect(daysLabel([1, 3])).toBe('Mon, Wed');
    expect(daysLabel([])).toBe('no days');
    expect(cleanDays([3, 1, 3, 9, '2', -1])).toEqual([1, 3]);
    expect(cleanDays('1,2')).toEqual([]);
    expect(toggleDay([1, 3], 3)).toEqual([1]);
    expect(toggleDay([1, 3], 0)).toEqual([0, 1, 3]);
  });

  it('needs words or a category, and at least one day', () => {
    const fields = { note: '', category: null, from: 2, to: 10, days: [1] };
    expect(recurringProblem(fields)).toMatch(/what the hours are for/);
    expect(recurringProblem({ ...fields, note: 'sleep' })).toBeNull();
    expect(recurringProblem({ ...fields, category: 'sleep' })).toBeNull();
    expect(recurringProblem({ ...fields, note: 'sleep', days: [] })).toMatch(/one day/);
  });

  it('is made, edited and archived like a category', () => {
    const now = new Date(2026, 10, 21, 10, 0);
    const made = newRecurring([plan({ position: 4 })], 'rnew000001', { note: '  gym\nlegs  ', category: 'body', from: 18, to: 19, days: [3, 1] }, now);
    expect(made).toEqual({
      id: 'rnew000001',
      note: 'gym\nlegs',
      category: 'body',
      from: 18,
      to: 19,
      days: [1, 3],
      since: SAT,
      position: 5,
      archived: false,
      updatedAt: now.getTime(),
    });
    const edited = patchRecurring(made, { to: 20, days: [5, 5, 1] }, 5);
    expect(edited).toMatchObject({ from: 18, to: 20, days: [1, 5], note: 'gym\nlegs', updatedAt: now.getTime() + 1 });
    expect(patchRecurring(edited, { archived: true }, now.getTime() + 10).archived).toBe(true);
    expect(newRecurringId(() => 0.5)).toMatch(/^r[a-z0-9]{9}$/);
  });
});

describe('an hour under a recurring plan', () => {
  const stored = (over: Partial<Entry> = {}): Entry => ({
    day: SAT,
    hour: 3,
    note: '',
    category: null,
    planned: null,
    plannedNote: '',
    flags: [],
    state: 'open',
    updatedAt: 7,
    ...over,
  });

  it('shows the recurring plan where it has none of its own', () => {
    // No row at all: a blank one carries the plan.
    expect(withRecurring(undefined, plan(), SAT, 3)).toEqual(stored({ planned: 'sleep', plannedNote: 'sleep', updatedAt: 0 }));
    // A row with something logged and no plan takes it too.
    expect(withRecurring(stored({ note: 'up late' }), plan(), SAT, 3)).toMatchObject({ note: 'up late', planned: 'sleep' });
    // Its own plan wins, in words or by category.
    const own = stored({ plannedNote: 'night out' });
    expect(withRecurring(own, plan(), SAT, 3)).toBe(own);
    expect(withRecurring(undefined, undefined, SAT, 3)).toBeUndefined();
  });

  it('is pinned into the row by the first write to the hour', () => {
    const patch = pinRecurring({ state: 'done' }, undefined, plan());
    const row = applyPatch(undefined, SAT, 3, patch, 100);
    expect(row).toMatchObject({ state: 'done', planned: 'sleep', plannedNote: 'sleep' });

    // The plan changes later; the hour that was lived keeps the one it was lived under.
    const later = plan({ note: 'sleep early', category: 'rest' });
    expect(withRecurring(row, later, SAT, 3)).toBe(row);
    const undone = applyPatch(row, SAT, 3, pinRecurring({ state: 'open' }, row, later), 200);
    expect(undone).toMatchObject({ state: 'open', planned: 'sleep', plannedNote: 'sleep' });
  });

  it('lets a patch that sets the plan win over the pin', () => {
    expect(pinRecurring({ planned: 'body' }, undefined, plan())).toEqual({ planned: 'body', plannedNote: 'sleep' });
    expect(pinRecurring({ planned: null, plannedNote: '' }, undefined, plan())).toEqual({ planned: null, plannedNote: '' });
    // Nothing to pin on an hour with its own plan, or under no recurring plan.
    expect(pinRecurring({ note: 'x' }, stored({ planned: 'deep' }), plan())).toEqual({ note: 'x' });
    expect(pinRecurring({ note: 'x' }, undefined, undefined)).toEqual({ note: 'x' });
  });
});
