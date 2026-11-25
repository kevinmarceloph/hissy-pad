import { hourBox, ICON_MIN, iconSize, type HourCell } from './Mark';

describe('an hour box with its category icon', () => {
  const cell = (over: Partial<HourCell>): HourCell => ({ state: 'open', color: '#123456', icon: '💻', any: true, ...over });

  it('carries the icon in every state, and none for an hour with no category icon', () => {
    for (const state of ['open', 'doing', 'done'] as const) expect(hourBox(cell({ state }), '#000').icon).toBe('💻');
    expect(hourBox(cell({ icon: null }), '#000').icon).toBeNull();
    expect(hourBox(undefined, '#000').icon).toBeNull();
  });

  it('draws the icon in the rows of six and in a wide line, clear of the outline', () => {
    // The picker's rows on a phone: about 55 wide, 30 tall.
    expect(iconSize(55, 30)).toBe(16);
    // 24 in a line across the web's dialog: about 19 wide.
    expect(iconSize(19, 30)).toBe(12);
    expect(iconSize(21, 22)).toBe(14);
  });

  it('leaves the icon out of a box too narrow for it: the one-line strip on a phone', () => {
    expect(iconSize(12.6, 22)).toBe(0);
    expect(iconSize(ICON_MIN + 6, 22)).toBe(0);
    expect(iconSize(ICON_MIN + 7, 22)).toBe(ICON_MIN);
  });
});
