// HissyPad's paper-and-ink tokens (Kevin's call, 2026-11-19): paper ground, serif ink, one
// pencil-red accent used only where the hand is (the current hour, the open editor, focus).
// Dials: ENERGY 1 / RHYTHM 1 / MOTION 1. Charter ships on Apple devices; Georgia elsewhere.
import { createContext, useContext } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { LINE_NATIVE, LINE_WEB, TEXT_SIZE } from '@hissypad/core';

import { PALETTES } from './palette';

export const serif = Platform.select({
  ios: 'Charter',
  android: 'serif',
  default: "Charter, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
});

// The palette's values live in ./palette.ts (no React Native, so the web pad can draw
// a line's category without loading Hours).
//
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
  palette: PALETTES.light,
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
  palette: PALETTES.dark,
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

// The pad's own type size and line (core/look.ts), so a line of text in Hours sits as one
// does in the pad: 25.5px on the web, 26pt on a phone.
export const SIZE = TEXT_SIZE;
export const SMALL = 14;
export const LINE = Platform.OS === 'web' ? LINE_WEB : LINE_NATIVE;
// One hour is one row, and a row is a comfortable tap: 44pt.
export const ROW = 44;
export const GUTTER = 20;
export const MAX_WIDTH = 640;
