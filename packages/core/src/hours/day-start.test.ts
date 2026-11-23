import { describe, expect, it } from 'vitest';
import { SAMPLE_CATEGORIES } from './categories';
import { cleanDayStart, dayOf, daySlots, dayTitle, elapsedHours, slotDay, slotState } from './day';
import type { Entry } from './entry';
import { summarize } from './summary';

const entry = (day: string, hour: number, over: Partial<Entry> = {}): Entry => ({
  day,
  hour,
  note: '',
  category: 'deep',
  planned: null,
  plannedNote: '',
  flags: [],
  updatedAt: 1,
  ...over,
});

describe('a day that starts at 6am', () => {
  it('runs from 6am to 6am the next day', () => {
    const slots = daySlots('2026-11-20', 6);
    expect(slots).toHaveLength(24);
    expect(slots[0]).toEqual({ day: '2026-11-20', hour: 6 });
    expect(slots[17]).toEqual({ day: '2026-11-20', hour: 23 });
    expect(slots[18]).toEqual({ day: '2026-11-21', hour: 0 });
    expect(slots[23]).toEqual({ day: '2026-11-21', hour: 5 });
    expect(slotDay('2026-11-20', 5, 6)).toBe('2026-11-21');
    expect(slotDay('2026-11-20', 6, 6)).toBe('2026-11-20');
  });

  it('keeps midnight to midnight when the start is 0', () => {
    const slots = daySlots('2026-11-20');
    expect(slots[0]).toEqual({ day: '2026-11-20', hour: 0 });
    expect(slots[23]).toEqual({ day: '2026-11-20', hour: 23 });
  });

  it('is still yesterday until the start hour', () => {
    const twoAm = new Date(2026, 10, 21, 2, 30); // Saturday 2:30am
    expect(dayOf(twoAm, 6)).toBe('2026-11-20');
    expect(dayOf(twoAm, 0)).toBe('2026-11-21');
    expect(dayOf(new Date(2026, 10, 21, 6, 0), 6)).toBe('2026-11-21');
    expect(dayTitle('2026-11-20', twoAm, 6)).toBe('Today');
    expect(dayTitle('2026-11-21', twoAm, 6)).toBe('Tomorrow');
  });

  it('counts the hours that are over from the start hour', () => {
    expect(elapsedHours('2026-11-20', new Date(2026, 10, 20, 14, 25), 6)).toBe(8);
    expect(elapsedHours('2026-11-20', new Date(2026, 10, 21, 2, 30), 6)).toBe(20);
    expect(elapsedHours('2026-11-19', new Date(2026, 10, 21, 2, 30), 6)).toBe(24);
    expect(elapsedHours('2026-11-21', new Date(2026, 10, 21, 2, 30), 6)).toBe(0);
    // The slot after midnight is judged by where it really sits on the clock.
    expect(slotState('2026-11-21', 1, new Date(2026, 10, 21, 2, 30))).toBe('past');
    expect(slotState('2026-11-21', 3, new Date(2026, 10, 21, 2, 30))).toBe('future');
  });

  it('summarizes the hours of the day on the screen, not of the calendar day', () => {
    const now = new Date(2026, 10, 21, 2, 30);
    const rows = [
      entry('2026-11-20', 3), // before the start: belongs to Thursday's day
      entry('2026-11-20', 9),
      entry('2026-11-21', 1, { category: 'sleep' }), // after midnight: still Friday's day
      entry('2026-11-21', 7), // Saturday's day
    ];
    const summary = summarize(rows, '2026-11-20', now, SAMPLE_CATEGORIES, 6);
    expect(summary.logged).toBe(2);
    expect(summary.elapsed).toBe(20);
    expect(summary.blank).toBe(18);
    expect(summary.byCategory.map((c) => `${c.category.id} ${c.hours}`)).toEqual(['deep 1', 'sleep 1']);
  });

  it('reads anything that is not an hour as midnight', () => {
    expect(cleanDayStart('6')).toBe(6);
    expect(cleanDayStart(23)).toBe(23);
    expect(cleanDayStart(null)).toBe(0);
    expect(cleanDayStart('')).toBe(0);
    expect(cleanDayStart('24')).toBe(0);
    expect(cleanDayStart('6.5')).toBe(0);
  });
});
