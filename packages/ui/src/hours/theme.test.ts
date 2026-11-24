import { COLORS, SAMPLE_CATEGORIES, type ColorKey } from '@hissypad/core/hours';

import { themes } from './theme';

// The screen is for a deuteranope who asked for stronger contrast between the label colors. These are the numbers
// the tokens in theme.ts promise.

type Rgb = [number, number, number];

const linear = (hex: string): Rgb =>
  [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(linear(a)), luminance(linear(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Machado, Oliveira and Fernandes (2009): deuteranopia at full severity, on linear RGB.
const DEUTERANOPIA = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];

const seenByDeuteranope = (c: Rgb): Rgb =>
  DEUTERANOPIA.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))) as Rgb;

function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// OKLab distance x 100. About 2 is the edge of noticeable.
function distance(a: Rgb, b: Rgb): number {
  const [p, q] = [oklab(a), oklab(b)];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// The smallest distance between any two of the colors, as a deuteranope and as anyone else.
function closest(colors: string[]): number {
  let least = Infinity;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const [a, b] = [linear(colors[i]), linear(colors[j])];
      least = Math.min(least, distance(a, b), distance(seenByDeuteranope(a), seenByDeuteranope(b)));
    }
  }
  return least;
}

describe.each(Object.entries(themes))('%s theme', (_name, theme) => {
  const papers = [theme.paper, theme.paperRaised];
  const keys = COLORS.map((c) => c.key);
  const defaults = [...new Set(SAMPLE_CATEGORIES.map((c) => c.color))] as ColorKey[];

  // The paper and the inks are the pad's own (core/look.ts), not searched for here. What
  // holds: the ink a line is read in is 7:1 or better, the quiet ink and the borders drawn
  // in it are 3:1, and the accent is 4.5:1.
  it('sets the text inks at 7:1 or better, and the quiet ink and borders at 3:1', () => {
    for (const paper of papers) {
      for (const ink of [theme.ink, theme.inkSoft]) expect(contrast(ink, paper)).toBeGreaterThanOrEqual(7);
      expect(contrast(theme.inkQuiet, paper)).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.line, paper)).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws the accent at 4.5:1 or better', () => {
    for (const paper of papers) expect(contrast(theme.accent, paper)).toBeGreaterThanOrEqual(4.5);
  });

  it('sets every category color at 3:1 or better', () => {
    for (const key of keys) {
      for (const paper of papers) expect(contrast(theme.palette[key], paper)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the category colors apart for a deuteranope, and apart from untagged ink', () => {
    expect(closest([...defaults.map((key) => theme.palette[key]), theme.ink])).toBeGreaterThanOrEqual(14);
    expect(closest([...keys.map((key) => theme.palette[key]), theme.ink])).toBeGreaterThanOrEqual(8.5);
  });
});
