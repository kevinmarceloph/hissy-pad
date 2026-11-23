// HissyPad's paper-and-ink tokens (Kevin's call, 2026-11-19): paper ground, serif ink, one
// pencil-red accent used only where the hand is (the current hour, the open editor, focus).
// Dials: ENERGY 1 / RHYTHM 1 / MOTION 1. Charter ships on Apple devices; Georgia elsewhere.
import { createContext, useContext } from 'react';
import { Platform, useColorScheme } from 'react-native';

import type { ColorKey } from '@hissypad/core/hours';

export const serif = Platform.select({
  ios: 'Charter',
  android: 'serif',
  default: "Charter, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
});

// Category colors are data, like the series colors of a chart, not decoration. A category
// stores a key from this palette, never a hex, and a swatch always sits next to its label.
//
// The values were searched for, not picked by eye. Kevin is a deuteranope and asked for
// stronger contrast between the label colors (2026-11-20), so the search maximized how far
// apart the colors sit under simulated deuteranopia: the eight the default categories use
// are at least 14 apart (OKLab distance x 100; 2 is about the edge of noticeable), all
// twelve at least 8.5, and all of them that far from the ink untagged hours are drawn in.
// Each is 3:1 or better against the paper in its theme: a higher floor squeezes them into
// a narrower band of lightness and closer together. src/ui/__tests__/theme.test.ts holds
// those numbers. Twelve colors cannot all be far apart for a deuteranope, which is why the
// screen never rests on color alone.
type Palette = Record<ColorKey, string>;

// Text is 7:1 or better on the paper in both themes (ink, inkSoft, inkQuiet). `line` is
// the border of a control or an empty box, 4:1 or better. `rule` only separates rows.
const light = {
  paper: '#f7f4ec',
  paperRaised: '#fffdf8',
  ink: '#1f1c17',
  inkSoft: '#3b3731',
  inkQuiet: '#57524a',
  line: '#7a7469',
  rule: '#bdb5a4',
  accent: '#a83d24',
  accentSoft: '#f0dfd9',
  palette: {
    blue: '#5589e0',
    sky: '#135377',
    teal: '#067a83',
    moss: '#4fa002',
    olive: '#332f00',
    ochre: '#755b00',
    brown: '#8e7364',
    rose: '#f93aa6',
    plum: '#781db9',
    indigo: '#2103a2',
    night: '#2a1f67',
    stone: '#44403d',
  } as Palette,
};

const dark: typeof light = {
  paper: '#1b1a17',
  paperRaised: '#24221e',
  ink: '#ebe6db',
  inkSoft: '#d3cdc0',
  inkQuiet: '#b3ad9f',
  line: '#8f897d',
  rule: '#524e46',
  accent: '#e8826a',
  accentSoft: '#3a2a26',
  palette: {
    blue: '#145dff',
    sky: '#aed7ef',
    teal: '#007c60',
    moss: '#c9ff4c',
    olive: '#c0d995',
    ochre: '#ff9900',
    brown: '#a25a29',
    rose: '#f13350',
    plum: '#d889ff',
    indigo: '#8f7aff',
    night: '#5587c2',
    stone: '#c3b4ac',
  } as Palette,
};

export const themes = { light, dark };

export type Theme = typeof light;

// The host can say which scheme to draw (HissyPad's web app has its own Light / Dark
// switch); without one the device's setting decides.
export const SchemeContext = createContext<'light' | 'dark' | null>(null);

export function useTheme(): Theme {
  const forced = useContext(SchemeContext);
  const device = useColorScheme();
  return (forced ?? device) === 'dark' ? dark : light;
}

export const SIZE = 17;
export const SMALL = 14;
export const LINE = 26;
// One hour is one row, and a row is a comfortable tap: 44pt.
export const ROW = 44;
export const GUTTER = 20;
export const MAX_WIDTH = 640;
