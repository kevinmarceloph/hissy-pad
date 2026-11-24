// The web's paper-and-ink tokens, for React Native. Charter ships on iOS; Android falls
// back to its serif.
import { Platform, useColorScheme } from 'react-native'
import { LINE_NATIVE, TEXT_SIZE } from '@hissypad/core'

export const serif = Platform.select({ ios: 'Charter', android: 'serif', default: 'serif' })
export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

const light = {
  paper: '#f7f4ec',
  paperRaised: '#fffdf8',
  ink: '#1f1c17',
  inkSoft: '#4d4842',
  inkMute: '#8a847a',
  rule: '#d9d3c6',
  accent: '#b5452b',
  accentSoft: '#f0dfd9',
  accentFaint: '#f4eae4',
  link: '#2a5a8a',
  markHl: '#e4c3b6', // ==highlight==: the accent at 26% on paper, as on the web
  codeBg: '#e8e5dd', // `code`: ink at 7% on paper
}
const dark: typeof light = {
  paper: '#1b1a17',
  paperRaised: '#24221e',
  ink: '#ebe6db',
  inkSoft: '#c9c3b6',
  inkMute: '#857f74',
  rule: '#3a3731',
  accent: '#e0755a',
  accentSoft: '#3a2a26',
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
