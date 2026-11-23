import { describe, expect, it } from 'vitest';
import {
  activeCategories,
  cleanLabel,
  COLORS,
  SAMPLE_CATEGORIES,
  isColorKey,
  labelProblem,
  newCategory,
  newCategoryId,
  nextColor,
  patchCategory,
  sortCategories,
  type Category,
} from './categories';
import {
  dayDate,
  dayKey,
  dayTitle,
  elapsedHours,
  fromDayKey,
  hourLabel,
  shiftDay,
  slotState,
} from './day';
import { applyPatch, isLogged, type Entry } from './entry';
import { MemoryStore } from './store';
import { summarize } from './summary';

// Thursday 2026-11-19, 14:25 local.
const NOW = new Date(2026, 10, 19, 14, 25);
const TODAY = '2026-11-19';

const entry = (hour: number, over: Partial<Entry> = {}): Entry => ({
  day: TODAY,
  hour,
  note: '',
  category: 'deep',
  planned: null,
  plannedNote: '',
  flags: [],
  updatedAt: 1,
  ...over,
});

describe('day', () => {
  it('keys a date in local time and reads it back', () => {
    expect(dayKey(NOW)).toBe(TODAY);
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(fromDayKey(TODAY).getHours()).toBe(0);
    expect(dayKey(fromDayKey(TODAY))).toBe(TODAY);
  });

  it('shifts across month and year ends', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('labels hours on a 12-hour clock', () => {
    expect([0, 1, 11, 12, 13, 23].map(hourLabel)).toEqual(['12am', '1am', '11am', '12pm', '1pm', '11pm']);
  });

  it('places a slot in the past, the present or the future', () => {
    expect(slotState(TODAY, 13, NOW)).toBe('past');
    expect(slotState(TODAY, 14, NOW)).toBe('now');
    expect(slotState(TODAY, 15, NOW)).toBe('future');
    expect(slotState('2026-11-18', 23, NOW)).toBe('past');
    expect(slotState('2026-11-20', 0, NOW)).toBe('future');
  });

  it('counts only finished hours as elapsed', () => {
    expect(elapsedHours(TODAY, NOW)).toBe(14);
    expect(elapsedHours('2026-11-18', NOW)).toBe(24);
    expect(elapsedHours('2026-11-20', NOW)).toBe(0);
  });

  it('titles days relative to today', () => {
    expect(dayTitle(TODAY, NOW)).toBe('Today');
    expect(dayTitle('2026-11-18', NOW)).toBe('Yesterday');
    expect(dayTitle('2026-11-20', NOW)).toBe('Tomorrow');
    expect(dayTitle('2026-11-16', NOW)).toBe('Mon, Nov 16');
    expect(dayDate(TODAY)).toBe('Thu, Nov 19');
  });
});

describe('entry', () => {
  it('counts a note or a category as logged, and an emptied row as not', () => {
    expect(isLogged(undefined)).toBe(false);
    expect(isLogged(entry(9, { category: null, note: '  ' }))).toBe(false);
    expect(isLogged(entry(9, { category: null, note: 'standup' }))).toBe(true);
    expect(isLogged(entry(9, { category: 'rest' }))).toBe(true);
  });

  it('patches only the fields given', () => {
    const base = entry(9, { note: 'standup', category: 'people', planned: null, plannedNote: '', flags: [], updatedAt: 100 });
    expect(applyPatch(base, TODAY, 9, { note: 'standup, then email' }, 200)).toEqual({
      ...base,
      note: 'standup, then email',
      updatedAt: 200,
    });
    expect(applyPatch(base, TODAY, 9, { category: null }, 200).category).toBeNull();
    expect(applyPatch(undefined, TODAY, 9, { category: 'deep' }, 200)).toEqual({
      day: TODAY,
      hour: 9,
      note: '',
      category: 'deep',
      planned: null,
      plannedNote: '',
      flags: [],
      updatedAt: 200,
    });
  });

  it('never stamps an edit older than the row it edits', () => {
    const base = entry(9, { updatedAt: 500 });
    expect(applyPatch(base, TODAY, 9, { note: 'x' }, 200).updatedAt).toBe(501);
  });
});

describe('categories', () => {
  const cat = (id: string, over: Partial<Category> = {}): Category => ({
    id,
    label: id,
    color: 'blue',
    position: 0,
    archived: false,
    updatedAt: 1,
    ...over,
  });

  it('starts with eight defaults, each with its own color from the palette', () => {
    expect(SAMPLE_CATEGORIES.map((c) => c.label)).toEqual([
      'Deep work', 'Admin', 'Learning', 'People', 'Body', 'Rest', 'Sleep', 'Drift',
    ]);
    expect(SAMPLE_CATEGORIES.every((c) => isColorKey(c.color) && c.updatedAt === 0)).toBe(true);
    expect(new Set(SAMPLE_CATEGORIES.map((c) => c.color)).size).toBe(8);
    expect(isColorKey('#ff0000')).toBe(false);
  });

  it('orders by position, breaks ties on id, and hides archived ones from the picker', () => {
    const list = [cat('b', { position: 1 }), cat('z', { position: 0 }), cat('a', { position: 1, archived: true })];
    expect(sortCategories(list).map((c) => c.id)).toEqual(['z', 'a', 'b']);
    expect(activeCategories(list).map((c) => c.id)).toEqual(['z', 'b']);
  });

  it('cleans a label and says why one cannot be used', () => {
    expect(cleanLabel('  Deep   work ')).toBe('Deep work');
    expect(cleanLabel('x'.repeat(80))).toHaveLength(48);
    expect(labelProblem(SAMPLE_CATEGORIES, '   ')).toBe('A category needs a name.');
    expect(labelProblem(SAMPLE_CATEGORIES, 'admin')).toBe('You already have a category called Admin.');
    // Its own name is not a clash, and an archived name is free to reuse.
    expect(labelProblem(SAMPLE_CATEGORIES, 'Admin', 'admin')).toBeNull();
    expect(labelProblem([cat('old', { label: 'Errands', archived: true })], 'Errands')).toBeNull();
  });

  it('adds at the end with the first unused color', () => {
    expect(nextColor(SAMPLE_CATEGORIES)).toBe('sky');
    expect(nextColor(COLORS.map((c, i) => cat(String(i), { color: c.key })))).toBe('blue');
    expect(newCategory(SAMPLE_CATEGORIES, 'cabc', ' Errands ', 'sky', 500)).toEqual({
      id: 'cabc',
      label: 'Errands',
      color: 'sky',
      position: 8,
      archived: false,
      updatedAt: 500,
    });
  });

  it('patches without ever stamping an older time', () => {
    const base = cat('deep', { label: 'Deep work', updatedAt: 500 });
    expect(patchCategory(base, { label: ' Focus ', color: 'moss' }, 200)).toEqual({
      ...base,
      label: 'Focus',
      color: 'moss',
      updatedAt: 501,
    });
  });

  it('makes ids the server will take', () => {
    const id = newCategoryId();
    expect(id).toMatch(/^c[0-9a-z]{9}$/);
    expect(newCategoryId(() => 0)).toBe('c000000000');
  });
});

describe('summarize', () => {
  it('totals hours per category in category order and counts the blanks', () => {
    const rows = [
      entry(0, { category: 'sleep' }),
      entry(1, { category: 'sleep' }),
      entry(9, { category: 'deep' }),
      entry(10, { category: 'deep' }),
      entry(11, { category: null, note: 'call with the landlord' }),
      entry(12, { category: null, note: '' }), // emptied: not logged
      entry(16, { category: 'rest' }), // planned ahead: logged, not elapsed
    ];
    const summary = summarize(rows, TODAY, NOW, SAMPLE_CATEGORIES);
    expect(summary.byCategory.map(({ category, hours }) => [category.id, hours])).toEqual([
      ['deep', 2],
      ['rest', 1],
      ['sleep', 2],
    ]);
    expect(summary).toMatchObject({
      untagged: 1,
      logged: 6,
      blank: 9, // 14 finished hours, 5 of them logged
      elapsed: 14,
    });
  });

  it('ignores other days and reports a full blank past day', () => {
    const summary = summarize([entry(9)], '2026-11-18', NOW, SAMPLE_CATEGORIES);
    expect(summary).toMatchObject({ logged: 0, blank: 24, elapsed: 24, byCategory: [] });
  });

  it('follows the user\'s order, keeps archived hours and counts unknown ids as untagged', () => {
    const categories = SAMPLE_CATEGORIES.map((c) =>
      c.id === 'sleep' ? { ...c, position: -1 } : c.id === 'deep' ? { ...c, archived: true } : c,
    );
    const rows = [entry(0, { category: 'sleep' }), entry(9, { category: 'deep' }), entry(10, { category: 'cnotyet001' })];
    const summary = summarize(rows, TODAY, NOW, categories);
    expect(summary.byCategory.map(({ category, hours }) => [category.id, hours])).toEqual([
      ['sleep', 1],
      ['deep', 1],
    ]);
    expect(summary).toMatchObject({ untagged: 1, logged: 3 });
  });
});

describe('MemoryStore', () => {
  it('starts empty: no category and no flag is seeded', async () => {
    const store = new MemoryStore();
    expect(await store.listCategories()).toEqual([]);
    expect(await store.listFlags()).toEqual([]);
  });

  it('holds the categories it is given and replaces one by id', async () => {
    const store = new MemoryStore([], SAMPLE_CATEGORIES);
    expect(await store.listCategories()).toHaveLength(8);
    await store.putCategory({ ...SAMPLE_CATEGORIES[0]!, label: 'Focus' });
    const list = await store.listCategories();
    expect(list).toHaveLength(8);
    expect(list.find((c) => c.id === 'deep')!.label).toBe('Focus');
  });

  it('keeps one row per day and hour, sorted by hour', async () => {
    const store = new MemoryStore();
    await store.put(entry(10, { note: 'first' }));
    await store.put(entry(8));
    await store.put(entry(10, { note: 'second' }));
    await store.put(entry(10, { day: '2026-11-18' }));
    const rows = await store.listDay(TODAY);
    expect(rows.map((e) => [e.hour, e.note])).toEqual([
      [8, ''],
      [10, 'second'],
    ]);
  });
});
