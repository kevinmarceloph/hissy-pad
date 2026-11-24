import { COLORS } from '@hissypad/core/hours';

import { inkOn, PALETTES } from './palette';

// WCAG contrast of two hexes.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('inkOn', () => {
  it('picks dark text on light colors and light text on dark ones', () => {
    expect(inkOn('#c9ff4c')).toBe('#000000');
    expect(inkOn('#2103a2')).toBe('#ffffff');
  });

  it('gives a category name 4.5:1 or better on every palette color in both schemes', () => {
    for (const palette of [PALETTES.light, PALETTES.dark])
      for (const { key } of COLORS) expect(contrast(inkOn(palette[key]), palette[key])).toBeGreaterThanOrEqual(4.5);
  });
});
