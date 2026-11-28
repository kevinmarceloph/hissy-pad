// What kind of machine this is, for the shortcut hints the page prints.
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

// The modifier key as this platform writes it: ⌘ on Apple devices, Ctrl elsewhere.
export const MOD = isMac ? '⌘' : 'Ctrl'

// A shortcut written the Mac way ("⌘⇧7", "⌘Enter") as this platform would write it.
export function shortcut(keys: string): string {
  return isMac ? keys : keys.replace('⌘', 'Ctrl+').replace('⇧', 'Shift+')
}

// The Mac app (apps/mac): the same page in a window of its own, which says so before the
// page runs. There the page has a sidebar in place of the top bar, signs in through a
// hissypad:// link, and asks the app for what a browser would do itself.
type Shell = { version: string; notifications: boolean }
type ShellWindow = Window & {
  hissypadMac?: Shell
  webkit?: { messageHandlers?: { hissypad?: { postMessage(message: unknown): Promise<unknown> } } }
}
const shellWindow = (): ShellWindow | null => (typeof window === 'undefined' ? null : (window as ShellWindow))

export const macShell = (): Shell | null => shellWindow()?.hissypadMac ?? null
export const isMacApp = (): boolean => macShell() !== null

// Where a sign-in comes back to: the app's own link there, this page in a browser.
export const authRedirect = (): string => (isMacApp() ? 'hissypad://auth' : window.location.origin)

// Ask the Mac app for something; null in a browser or when it does not answer.
export async function macAsk(message: { type: string } & Record<string, unknown>): Promise<unknown> {
  try {
    return (await shellWindow()?.webkit?.messageHandlers?.hissypad?.postMessage(message)) ?? null
  } catch {
    return null
  }
}
