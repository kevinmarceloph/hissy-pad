// Signing the Apple Watch in. The watch syncs by itself, with a session of its own, and it
// has no way to type an email: the phone gets it a one-time sign-in token (the
// `watch-token` Edge Function) and passes it over. This is the decision of when to, kept
// here so it can be tested; the calls are in apps/mobile/src/widget.ts. Siri's sender on
// the phone (apps/mobile/native/SiriSync.swift) is signed in by the same rule: read
// "the watch" below as either.
//
// The watch tells the phone which account it is signed in to (`user`, '' for none), and
// the phone hands a token over whenever that is not its own account. A hand-over can fail
// quietly (the watch has no network to trade the token in), so it is tried again, twice as
// far apart each time up to an hour, until the watch reports the right account.
export const WATCH_RETRY_MS = 30_000
export const WATCH_RETRY_MAX_MS = 60 * 60_000

export function watchHandoffDue(
  watchState: string | null, // what the watch last reported, as JSON; null when there is no watch app
  userId: string | null,     // the phone's account; null when signed out
  tries: number,             // hand-overs made since the watch last had the right account
  lastAt: number,            // when the last one was made
  now: number,
): boolean {
  if (!watchState || !userId) return false
  let user: unknown
  try {
    user = (JSON.parse(watchState) as { user?: unknown } | null)?.user
  } catch {
    return false
  }
  if (typeof user !== 'string' || user === userId) return false
  if (tries === 0) return true
  return now - lastAt >= Math.min(WATCH_RETRY_MS * 2 ** (tries - 1), WATCH_RETRY_MAX_MS)
}

// True when the watch reports this account: the hand-over worked, so the count starts over.
export function watchSignedIn(watchState: string | null, userId: string | null): boolean {
  if (!watchState || !userId) return false
  try {
    return (JSON.parse(watchState) as { user?: unknown } | null)?.user === userId
  } catch {
    return false
  }
}
