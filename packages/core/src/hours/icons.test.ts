import { describe, expect, it } from 'vitest';

import { cleanIcon, iconIsCode, iconProblem, SAMPLE_CATEGORIES, type Category } from './categories';

const list: Category[] = SAMPLE_CATEGORIES.slice(0, 3).map((c, i) => ({ ...c, icon: ['🛒', 'HP', ''][i]! }));

describe('category icons', () => {
  it('takes an emoji whole, or a code of up to three letters and digits', () => {
    expect(cleanIcon('🛒 groceries')).toBe('🛒');
    expect(cleanIcon('👍🏽')).toBe('👍🏽');
    expect(cleanIcon('🇵🇭')).toBe('🇵🇭');
    expect(cleanIcon(' HP ')).toBe('HP');
    expect(cleanIcon('W')).toBe('W');
    expect(cleanIcon('Writing')).toBe('Wri');
    expect(cleanIcon('H.P. stuff')).toBe('HP');
    expect(cleanIcon('42')).toBe('42');
    expect(cleanIcon('...')).toBe('');
  });

  it('tells a code from an emoji', () => {
    expect(iconIsCode('HP')).toBe(true);
    expect(iconIsCode('W')).toBe(true);
    expect(iconIsCode('🛒')).toBe(false);
    expect(iconIsCode('🇵🇭')).toBe(false);
    expect(iconIsCode('')).toBe(false);
  });

  it('needs an icon, and one no other active category uses', () => {
    expect(iconProblem(list, '  ')).toMatch(/needs an icon/);
    expect(iconProblem(list, '🛒')).toBe(`${list[0]!.label} already uses 🛒.`);
    // Case does not make a code another one.
    expect(iconProblem(list, 'hp')).toBe(`${list[1]!.label} already uses HP.`);
    expect(iconProblem(list, 'HP', list[1]!.id)).toBeNull();
    expect(iconProblem(list, 'W')).toBeNull();
    // An archived category gives its icon up.
    expect(iconProblem([{ ...list[1]!, archived: true }], 'HP')).toBeNull();
  });
});
