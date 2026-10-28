# HissyPad

One freeform outline, always open. The top of the page is what needs attention next. Drag things around in a hierarchy, multi-select, cross things out. Nothing else. Design and roadmap in [PLAN.md](PLAN.md).

```
packages/core   pure TS: node rows, tree, ops, ranks, drop resolver, outline paste/copy, LocalStore, sync engine
packages/state  the app: Zustand store, commands, per-op undo, debug log, Supabase remote + sync binding
apps/web        Vite + React 19, IndexedDB, PWA, drag, Playwright
apps/mobile     Expo (SDK 58), expo-sqlite, same state package, EAS profiles
supabase/       migration (nodes table, RLS, last-write-wins trigger), pgTAP tests
```

## Run

```bash
corepack enable          # pnpm ships with Node's corepack
pnpm install
pnpm --filter @hissypad/web dev     # http://localhost:5180
pnpm test                # every package
pnpm typecheck
pnpm --filter @hissypad/web build   # apps/web/dist
pnpm --filter @hissypad/web e2e     # Playwright drag tests (desktop + phone profiles)
```

### Mobile

```bash
cp apps/mobile/.env.example apps/mobile/.env.local    # EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY
cd apps/mobile && npx expo start                       # Expo Go, or a dev client
npx expo run:ios                                       # native build into the simulator
npx eas-cli build --profile development --platform ios # dev client for a registered iPhone
npx expo start --dev-client                            # then the phone loads code from this Mac
npx eas-cli update --channel development --environment development --message "..."   # JS-only OTA update
```

`npx eas-cli env:pull --environment development` writes the hosted Supabase values into `apps/mobile/.env.local` for Metro (the phone cannot reach a local stack); `.env.local.localstack` keeps the local-stack copy. EAS project `@kevinmarceloph/hissy-pad`. The Supabase URL and publishable key live as EAS environment variables (development, preview, production), not in the repo. Profiles: `development` (phone), `development-simulator`, `preview`, `production`, each on its own EAS Update channel.

Sign-in on the phone returns through the `hissypad://auth` deep link, which must be in Supabase's redirect URL list. Press and hold a bullet to drag; Return splits the line; the toolbar sits above the keyboard.

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
| Backspace at the start | join with the line above |
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

Cmd+S syncs right now (and never opens the browser's save dialog). Drag a bullet to move a line (press and hold on a phone); move right to nest under the line above, left to climb out. If the dragged line is part of a selection, the whole selection moves. Cmd+Z / Shift+Cmd+Z undo and redo anywhere. Tap a bullet to select it; once something is selected, tapping other bullets toggles them (no modifier, so it works on a phone). Shift+click selects a range. Blank lines show no bullet, done lines show a × like a bullet journal, and "Delete done" removes every crossed-out line (undo brings them back).

## Debugging

Open the app with `?debug=1` (sticks until `?debug=0`). A Log button appears in the top bar with every op (label, before/after of each touched row, undo depth), undo and redo, selection and editing changes, drag begin/target/drop, and sync status. `window.hissypad.log()` returns the same text. Undo is per op: it restores only the rows that op touched, stamped fresh so the undo syncs, and never reverts rows that arrived from another device in between.

## Deploy

`render.yaml` describes a Render static site built from the repo root; set the two `VITE_SUPABASE_*` env vars on the service. The hosted Supabase project needs `supabase db push` for the migration, the site URL `https://hissypad.marcelo.ph` in Auth settings, and the Google provider enabled. The app icon is a placeholder (the letter H in the body serif).

## Status

Phase 3 built: local-first sync against a local Supabase stack. Not yet deployed; no hosted project yet.
