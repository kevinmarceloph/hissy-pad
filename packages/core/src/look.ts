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
