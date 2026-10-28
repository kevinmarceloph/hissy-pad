// The web's paper-and-ink tokens, for React Native. Charter ships on iOS; Android falls
// back to its serif.
import { Platform, useColorScheme } from 'react-native'

export const serif = Platform.select({ ios: 'Charter', android: 'serif', default: 'serif' })

const light = {
  paper: '#f7f4ec',
  paperRaised: '#fffdf8',
  ink: '#1f1c17',
  inkSoft: '#4d4842',
  inkMute: '#8a847a',
  rule: '#d9d3c6',
  accent: '#b5452b',
  accentSoft: '#f0dfd9',
  link: '#2a5a8a',
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
  link: '#8fb4d8',
}
export type Theme = typeof light

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light
}

export const SIZE = 17
export const LINE = 26
export const INDENT = 22
export const GUTTER = 36
