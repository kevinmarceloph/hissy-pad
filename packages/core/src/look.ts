// The sizes a line of text is drawn in, kept in one place for the three things that draw
// one: the web's pad (styles.css), the phone's pad (apps/mobile/src/theme.ts) and the
// screens both apps share (packages/ui, Hours).
//
// The type is 17 everywhere. The line is 1.5 times that on the web, 25.5px, and 26pt on a
// phone: a whole number there, which the phone's text input was measured against
// (INPUT_SHIFT in the phone's theme). The web's stylesheet cannot import this file; a test
// in apps/web holds its --size and --lh to these numbers.
export const TEXT_SIZE = 17
export const LINE_RATIO_WEB = 1.5
export const LINE_WEB = TEXT_SIZE * LINE_RATIO_WEB
export const LINE_NATIVE = 26

// The paper and the inks, light and dark: the pad's set, which Hours took on 2026-11-25
// (Kevin; it had darker soft inks and accent of its own until then). Paper ground, serif
// ink, one pencil-red accent. The web's stylesheet repeats these (the same test holds it
// to them); the phone's theme and the shared screens import them.
export interface PaperColors {
  paper: string
  paperRaised: string
  ink: string
  inkSoft: string
  inkMute: string
  rule: string
  accent: string
  accentSoft: string // the accent at 12% on paper
}
export const PAPER_LIGHT: PaperColors = {
  paper: '#f7f4ec',
  paperRaised: '#fffdf8',
  ink: '#1f1c17',
  inkSoft: '#4d4842',
  inkMute: '#8a847a',
  rule: '#d9d3c6',
  accent: '#b5452b',
  accentSoft: '#f0dfd9',
}
export const PAPER_DARK: PaperColors = {
  paper: '#1b1a17',
  paperRaised: '#24221e',
  ink: '#ebe6db',
  inkSoft: '#c9c3b6',
  inkMute: '#857f74',
  rule: '#3a3731',
  accent: '#e0755a',
  accentSoft: '#3a2a26',
}
