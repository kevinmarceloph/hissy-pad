# HissyPad

One freeform outline, always open. The top of the page is what needs attention next. Drag things around in a hierarchy, multi-select, cross things out. Nothing else. Design and roadmap in [PLAN.md](PLAN.md); a map of the code in [docs/MAP.md](docs/MAP.md).

```
packages/core   pure TS: node rows, tree, ops, ranks, pads, drop resolver, outline paste/copy, LocalStore, sync engine
packages/state  the app without a screen: Zustand store, undo, selection, commands, the toolbar registry, pads, sort, lists, sync binding
apps/web        Vite + React 19, IndexedDB, PWA, drag, Playwright
apps/mobile     Expo (SDK 58), expo-sqlite, same state package, EAS profiles
supabase/       migrations (nodes table, RLS, last-write-wins trigger), pgTAP tests
docs/MAP.md     where everything is, file by file, and where each kind of change goes
```

## Run

```bash
corepack enable          # pnpm ships with Node's corepack
pnpm install
pnpm --filter @hissypad/web dev     # http://localhost:5180
pnpm test                # every package
pnpm coverage            # the same, with a coverage table per file
pnpm typecheck
pnpm --filter @hissypad/web build   # apps/web/dist
pnpm --filter @hissypad/web e2e     # Playwright drag and swipe tests (desktop + phone profiles)
```

### Mobile

```bash
cp apps/mobile/.env.example apps/mobile/.env.local    # EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY
cd apps/mobile && npx expo start                       # Expo Go, or a dev client
npx expo run:ios                                       # native build into the simulator
npx eas-cli build --profile development --platform ios # dev client for a registered iPhone (needs Metro or an update)
npx eas-cli build --profile preview --platform ios     # standalone app for the same phone, runs on its own
npx expo start --dev-client                            # then the phone loads code from this Mac
npx eas-cli update --channel development --environment development --message "..."   # JS-only OTA update
```

`npx eas-cli env:pull --environment development` writes the hosted Supabase values into `apps/mobile/.env.local` for Metro (the phone cannot reach a local stack); `.env.local.localstack` keeps the local-stack copy. EAS project `@kevinmarceloph/hissy-pad`. The Supabase URL and publishable key live as EAS environment variables (development, preview, production), not in the repo. Profiles: `development` (phone), `development-simulator`, `preview`, `production`, each on its own EAS Update channel.

The iPhone app has a home-screen widget ("Inbox", medium and large, iOS 17+): one pad's top line with Later, Done and Today buttons, and a + that opens the app to add a line. Long-press the widget and choose Edit Widget to pick the pad. A second widget, "Today" (small, medium and large), lists the open lines of the Today pad with a circle to cross one out. "Add to Inbox" is a Control (iOS 18+) for the Lock Screen, Control Center or the Action button: it opens the app at an "Add to Inbox" prompt. "Add to HissyPad" works in Siri and the Shortcuts app. Both add to the pad named Inbox, made the first time. There is also an Apple Watch app: your pads and their open lines, with a circle to cross one out. It gets its data from the iPhone app and sends each Done back to it, so it needs the phone to sync. The Swift is in `apps/mobile/targets` (`widget`, `watch`, `_shared`) and `apps/mobile/native`, and it all needs a build, not an update.

Sign-in on the phone returns through the `hissypad://auth` deep link, which must be in Supabase's redirect URL list. Press and hold a bullet to drag; Return splits the line; the toolbar sits above the keyboard in two rows. Round buttons float at the top right: + for a new line at the top, and while editing a check (cross out) and a chevron (done editing).

### Sync (optional)

Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` the app is local-only. For local sync:

```bash
supabase start                      # local stack on ports 54421-54429 (beside Doorstep's 543xx)
supabase test db                    # pgTAP: RLS + last-write-wins
cp apps/web/.env.example apps/web/.env.local   # paste the anon key `supabase status` prints
```

Sign in from the footer (magic link lands in Mailpit at http://127.0.0.1:54424, or Google once the provider is configured). Every device keeps a full copy; rows sync one by one, newest `updated_at` wins, deletes are tombstones. See PLAN.md, "Sync".

## Keys

| in a line | |
|---|---|
| Enter / Shift+Enter | new line / newline inside the line |
| Tab / Shift+Tab | nest / unnest |
| Alt+Up / Alt+Down | move among siblings |
| Cmd+Enter (or Ctrl) | cross out |
| Cmd+. | fold / unfold |
| Cmd+Shift+7 | numbered list on / off (a run of numbered siblings counts 1, 2, 3) |
| toolbar · / # / 1. | line type: bullet, header (bold, # bullet) or numbered |
| Backspace at the start | join with the line above |
| Cmd+Shift+Backspace | delete the line (children too) |
| Esc | select the line |
| paste multi-line text | becomes nested lines (indentation kept) |

| with lines selected | |
|---|---|
| Up / Down, Shift+Up / Shift+Down | move / extend the selection |
| Enter | edit |
| Tab, Alt+arrows, Cmd+Enter, Cmd+., Cmd+Shift+7 | as above, on the whole selection |
| Backspace / Delete | delete |
| Cmd+C / Cmd+X / Cmd+V | copy as outline / cut / paste after |
| Cmd+A | select all |
| Esc | clear |

| top bar | |
|---|---|
| Delete done | remove every crossed-out line (undo brings them back) |
| Paste in… / Copy all | import an outline / copy the whole pad |
| Done | "Recently done": crossed-out lines, newest first, with an Undone button each |
| Trash | lines deleted in the last 30 days, grouped by the delete that removed them, with a Restore button each |
| Fresh start… | two panes: send across what stays, and everything left behind moves to a new pad |
| Sort… | the pad's top-level lines one card at a time: left for Later, right for Today, up for Today and crossed out, down to skip. Swipe, arrow keys or buttons. The card's text and sub items can be edited first, and each side can point at any pad, Main or a new one |

| toolbar (a line being edited, or lines selected) | |
|---|---|
| Done, · / # / 1. | cross out, line type |
| + above / + below | a new line beside the selection |
| ← → ↑ ↓ | outdent, indent, move among siblings |
| Fold / Ungroup | fold the line, or bring its sub items out to its own level |
| Copy / Move to… | copy as an outline, send to another pad |
| Make pad | the line becomes a pad: its text is the name, its sub items the lines |
| Delete | delete, children too |

| pads (the tabs under the title) | |
|---|---|
| + | a new pad |
| click the open tab | rename it, move it left or right, or delete it. Main stays first |

Cmd+S syncs right now (and never opens the browser's save dialog); on a phone, pull down at the top of the page to do the same, in the web app and the Expo app alike. Drag a bullet to move a line (press and hold on a phone); move right to nest under the line above, left to climb out. If the dragged line is part of a selection, the whole selection moves. Cmd+Z / Shift+Cmd+Z undo and redo anywhere; on the phone, shake to undo. Tap a bullet to select it; once something is selected, tapping other bullets toggles them (no modifier, so it works on a phone). Shift+click selects a range. Blank lines show no bullet, done lines show a × like a bullet journal, and "Delete done" removes every crossed-out line (undo brings them back).

Deleting is soft everywhere: a deleted line is a tombstone (`deleted_at`) that keeps syncing, so the Trash panel can list it for 30 days and put it back where it was, children included, on any device. Restoring a child whose parent is still deleted lands it at the top level. Crossing a line out stamps `done_at`, which is what the Done panel sorts by (lines crossed out before that column existed sort by their last edit). Nothing is purged from the server yet.

## Debugging

Open the app with `?debug=1` (sticks until `?debug=0`). A Log button appears in the top bar with every op (label, before/after of each touched row, undo depth), undo and redo, selection and editing changes, drag begin/target/drop, and sync status. `window.hissypad.log()` returns the same text. Undo is per op: it restores only the rows that op touched, stamped fresh so the undo syncs, and never reverts rows that arrived from another device in between.

## Deploy

Live at https://hissypad.marcelo.ph (Render static site `hissypad`, auto-deploys from `main`; `render.yaml` is the blueprint, built from the repo root). The two `VITE_SUPABASE_*` env vars on the service point at the hosted Supabase project. A new migration needs `supabase db push` against that project; Auth settings carry the site URL and the Google provider. The app icon is a placeholder (the letter H in the body serif).

## Status

Phases 1-5 and 7 built, plus Sort, Trash, Recently done and shake to undo on the phone. Web is deployed and syncing against the hosted Supabase project; the Expo app runs on Kevin's iPhone from EAS builds. See [PLAN.md](PLAN.md) for what is pending.
