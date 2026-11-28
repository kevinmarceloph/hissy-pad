# HissyPad for the Mac

The web app in a window of its own. A small Swift shell (AppKit + WKWebView, no dependencies) serves a build of `apps/web` from a folder on the Mac under its own scheme, `app://hissypad/`, so it opens offline. Inside it the page draws a sidebar in place of the top bar (see "The Mac app" in `PLAN.md`).

## Build and install

```bash
apps/mac/build.sh --install
```

That builds the web app, builds the shell (`swift build -c release`), puts both in `apps/mac/build/HissyPad.app`, signs it ad hoc and copies it to `/Applications`. There is no Developer ID certificate here, so the app runs on the Mac that built it. Build from a checkout with `apps/web/.env.local` in place, or the copy inside the app is local-only until the first update.

```bash
cd apps/mac && swift test    # the shell's logic (paths, the build list, links)
```

## What the shell does

| | |
|---|---|
| Serves the page | `Files` in `main.swift` answers `app://hissypad/…` from a build's folder. Paths never leave it (`safePath`). |
| Keeps it current | `Updater` asks the live site for `files.json` (written by the web build) on launch and when the app comes to the front, at most every 10 minutes. A newer build is fetched whole into `~/Library/Application Support/HissyPad/web/<version>` and swapped in when the app is not in front. So a push to `main` reaches the Mac app with no rebuild. HissyPad > Check for Updates… does it now. |
| Signs in | The page sends the email link and Google's page to `hissypad://auth`. The system hands that link to the app, the app hands its tokens to the page (`window.hissypadOpen`, `apps/web/src/platform/mac.ts`). Anything that is not the app's own page opens in the browser. |
| Chimes | The page asks the app to show a notification (`macAsk` in `apps/web/src/platform/os.ts`). The sound is still the page's. Closing the window hides it, so chimes keep ringing; the Dock icon brings it back. |
| Menus | File: New Item (⌘N), Search (⌘K). View: the four modes (⌘1-4), zoom, Reload. The page gets its keys first, so ⌘Z is still its own undo. |
| Theme | The page tells the app Light, Dark or System, and the window follows. |

The page knows it is in the app by `window.hissypadMac`, set before it runs.

A shell change (anything under `apps/mac`) needs `build.sh --install` again. A web change does not.

## Checking it without a screen

```bash
HISSYPAD_PROBE=/tmp/probe apps/mac/build/HissyPad.app/Contents/MacOS/HissyPad
```

Opens the app with no saved data and no update check, waits `HISSYPAD_PROBE_WAIT` seconds (3), runs `HISSYPAD_PROBE_JS` (the body of an async function) in the page, writes what it returned to `probe.json` and the window to `shot.png`, and quits. `HISSYPAD_PROBE_SIZE=1180x780` sizes the window. `HISSYPAD_WEB=<folder>` serves another build, with updates off.
