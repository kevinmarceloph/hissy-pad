// HissyPad's paper-and-ink tokens (Kevin's call, 2026-11-19): paper ground, serif ink, one
// pencil-red accent used only where the hand is (the current hour, the open editor, focus).
// The colors themselves are the pad's, shared in core/look.ts.
// Dials: ENERGY 1 / RHYTHM 1 / MOTION 1. Charter ships on Apple devices; Georgia elsewhere.
import { createContext, useContext } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { LINE_NATIVE, LINE_WEB, PAPER_DARK, PAPER_LIGHT, TEXT_SIZE, type PaperColors } from '@hissypad/core';

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

// The paper and the inks are the pad's (core/look.ts), since 2026-11-25: Hours had a
// darker set of its own, with every text color at 7:1 on the paper, and Kevin chose the
// pad's for both. So `inkQuiet`, the quiet text (an hour's label, a placeholder), is the
// pad's muted ink, and so is `line`, the border of a control or of an empty box. `rule`
// only separates rows.
const from = (c: PaperColors, palette: (typeof PALETTES)['light']) => ({
  paper: c.paper,
  paperRaised: c.paperRaised,
  ink: c.ink,
  inkSoft: c.inkSoft,
  inkQuiet: c.inkMute,
  line: c.inkMute,
  rule: c.rule,
  accent: c.accent,
  accentSoft: c.accentSoft,
  palette,
});

const light = from(PAPER_LIGHT, PALETTES.light);
const dark: typeof light = from(PAPER_DARK, PALETTES.dark);

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
// On the web the column is the pad's own: 44rem wide with 16px at each side (`.app` in
// the web's stylesheet), so Hours' rows start and end where the pad's lines do.
export const GUTTER = Platform.OS === 'web' ? 16 : 20;
export const MAX_WIDTH = Platform.OS === 'web' ? 704 : 640;
