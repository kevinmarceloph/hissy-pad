// The web's paper-and-ink tokens, for React Native. Charter ships on iOS; Android falls
// back to its serif.
import { Platform, useColorScheme } from 'react-native'
import { LINE_NATIVE, PAPER_DARK, PAPER_LIGHT, TEXT_SIZE } from '@hissypad/core'

export const serif = Platform.select({ ios: 'Charter', android: 'serif', default: 'serif' })
export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

// The paper and the inks are the shared set (core/look.ts); the rest is the pad's own.
const light = {
  ...PAPER_LIGHT,
  accentFaint: '#f4eae4',
  link: '#2a5a8a',
  markHl: '#e4c3b6', // ==highlight==: the accent at 26% on paper, as on the web
  codeBg: '#e8e5dd', // `code`: ink at 7% on paper
}
const dark: typeof light = {
  ...PAPER_DARK,
  accentFaint: '#2a221e',
  link: '#8fb4d8',
  markHl: '#52332a',
  codeBg: '#2a2825',
}
export type Theme = typeof light

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light
}

// One set of sizes with the web and the shared screens: core/look.ts.
export const SIZE = TEXT_SIZE
export const LINE = LINE_NATIVE
export const INDENT = 22
export const GUTTER = 36
// A multiline TextInput on iOS (UITextView) puts all of the extra line height above the
// glyphs, while Text splits it around them, so the same style sits lower while editing.
// Measured at 8px on a 3x screen with Charter 17 in a 26pt line; shift the input back up.
export const INPUT_SHIFT = Platform.OS === 'ios' ? 8 / 3 : 0
