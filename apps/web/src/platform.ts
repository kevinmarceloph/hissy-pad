// What kind of machine this is, for the shortcut hints the page prints.
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

// The modifier key as this platform writes it: ⌘ on Apple devices, Ctrl elsewhere.
export const MOD = isMac ? '⌘' : 'Ctrl'

// A shortcut written the Mac way ("⌘⇧7", "⌘Enter") as this platform would write it.
export function shortcut(keys: string): string {
  return isMac ? keys : keys.replace('⌘', 'Ctrl+').replace('⇧', 'Shift+')
}
