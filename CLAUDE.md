# CLAUDE.md (hissy-pad)

Guidance for Claude Code in this repo. The shared rules (who Kevin is, writing voice, facts bank) are in `../CLAUDE.md`.

## What this is

HissyPad: a freeform outline, always open, between Google Docs and Hissycal; since 2026-11-02 a few of them ("pads", tabs under the title, with a two-pane Fresh start that moves the leftovers of a pad into a new one). A flat `nodes` table, offline-first, each row synced on its own with last-write-wins on the server. A pad is a root-level row with `pad` set. Since 2026-11-24 the tabs start with three fixed ones: Today, Inbox and Later. Inbox is the root level itself (the old Main); Today and Later are ordinary pad rows found by name. After load and every sync merge the store makes a missing Today or Later, folds a duplicate into the first, and folds any pad named Inbox into the root (`settleFixedPads` in core, `settleFixed` in the store). Tests share `tableShape` (`state/testing.ts`), which leaves out an empty Today and Later; the store shows one pad at a time as a scoped view (`rows`) over the whole table (`all`), see `packages/core/src/pads.ts`. Web (Vite + React 19, PWA) and mobile (Expo) share the same core and state packages. Live at https://hissypad.marcelo.ph (Render static site, auto-deploys from `main`, hosted Supabase behind it). Public repo `kevinmarceloph/hissy-pad`, Kevin's first public one: nothing under NDA, no pad content, no keys.

Since 2026-11-23 it also holds **Hours**: Oras-oras (the hourly self-tracker in `../oras`, left as it is) rebuilt on this stack as a mode of its own, like Sort. One row per hour (a small pad of the lines put in it, a state of open, doing or done, an optional summary), categories, flags, recurring plans, a day start, chimes; plus two things Oras-oras does not have: a line of the pad can be put in an hour of a day (`slot` on the row), and each hour lists the lines crossed out while it ran. See "Hours" below.

- `README.md`: layout, run commands, keys. Read it first.
- `docs/MAP.md`: where everything is, file by file, and where each kind of change goes (a toolbar action, an op, a column, a panel). Keep it current when a file is added, moved or removed.
- `PLAN.md`: the design (data model, sync, editing model), phases and what is pending. Keep its status line and phase notes current when a phase moves; dates are absolute (`2026-10-29`), Manila time.

## Layout

```
packages/core    pure TS, no React: types, tree, ops, rank, drop resolver, paste, pads (scoped view, fresh start), clock, sync engine, LocalStore
packages/state   Zustand store (all rows + the scoped pad), history, selection, commands, the toolbar registry (actions.ts), pads, lists, sort, shake, sync binding, Supabase remote, debug log
packages/ui      screens written once in React Native and drawn by both apps (the web through react-native-web): the Hours mode and the hour picker
apps/web         Vite SPA on :5180: src/app (shell), src/pad (editor, drag), src/pads (tabs, fresh start), src/panels (trash, done, sort), src/platform (IndexedDB, clipboard); Playwright e2e
apps/mobile      Expo SDK 58 shell: expo-sqlite store, screens in src/ui, the same toolbar registry, EAS build/update profiles
supabase/        migrations (nodes, RLS, LWW trigger), pgTAP tests, functions (watch-token: the watch's sign-in), local stack on ports 54421-54429
```

Platform logic goes in `packages/state` or `packages/core`, never in an app. If web and mobile would both need it, it belongs in a package. A toolbar button is an entry in `LINE_ACTIONS` (`packages/state/src/actions.ts`), not markup in either app. Both toolbars draw `lineActions(can)`; an action that belongs only in an open hour in Hours (or only outside one) says so with `offered` and `can.hour`.

## Hours

- Where it lives: `packages/core/src/hours` (pure logic, imported as `@hissypad/core/hours`), `packages/state/src/hours` (stores, the sync engine for its four tables and its settings, the slot commands; `@hissypad/state/hours`), `packages/ui/src/hours` (the screens). The names stay out of the pad's index files on purpose: `Entry`, `MemoryStore`, `syncLine` and others would collide.
- The code came from `../oras` on 2026-11-23 and keeps its style (semicolons, its comments). Its rules still hold and are in `../oras/CLAUDE.md`: `(day, hour)` is the calendar slot, never the day as drawn; `byHour` is what is stored and `shown` is what is drawn; every write from the day screen goes through `pinRecurring`; flags are read and written through `flagChoice` and `setFlagChoice`; a color is a palette key, never a hex; nothing rests on color alone (Kevin is a deuteranope). The `hold` handlers are gone here: nothing in an open hour is a draft, every change is written as it is made.
- The hour editor since 2026-11-24 (Kevin): an open hour shows the lines put in it and what is under them (`HostedLines`, `scopeSlot`); a row shows the summary typed for it (`note`, behind the Summary button), or else its top line (`hourShown`), and shows `✕N` for the lines crossed out while it ran that were not put in it, listed in the open hour under "Done in this hour" (`slotDoneElsewhere`; the done-out-of-all count is gone since 2026-11-25); an item typed into an hour goes to the top of Today (`cmdSlotAdd`); an hour is open, doing or done (`state`, set by hand); planned against actual is hidden and deprecated, so nothing edits `planned` or `plannedNote`, which only carry a recurring plan's words and category. An hour is drawn the same on the day screen and in the hour picker through `drawHours`. Details in `PLAN.md` under "Hours". An open hour's lines are drawn by each app's own pad editor, not by these screens: `HostedLines` asks the store to show the hour (`openSlot`, `scopeSlot`; `apply` writes the rows back to the pads they live in through `unscopeSlot`) and draws what the host handed `HoursApp` as `renderLines` (`<Pad embedded />` on the web, `SubRows` with `slot` on the phone). So a change to how a line looks or edits in an hour is a change to the pad. The small pad these screens once had is deleted (2026-11-25); the history is in `PLAN.md` under "Hours joins the pad". An hour keeps no order of its own: its lines go by pad, then down the pad (`lineOrder`).
- Nothing is seeded (Kevin, 2026-11-23): no default categories, no default flags. `SAMPLE_CATEGORIES` and `SAMPLE_FLAGS` exist for tests only. A new flag still starts with Yes and No as its options.
- Storage: the four hours tables are real tables on the server (`hour_entries`, `hour_categories`, `hour_flags`, `recurring_plans`, plus `hour_settings` for the day start and the chime minutes, one row per key; `updated_at` in ms as a bigint, no `deleted_at`). Settings that follow the account go in `hour_settings` through `HoursStore.putSetting`, not in the device's meta. On a device they are JSON rows behind `HoursBackend` (`core/hours/store.ts`): one IndexedDB store on web, one SQLite table on the phone. `HoursStore` keeps them all in memory and writes through.
- Sync: a second engine beside the pad's (`state/hours/engine.ts`), started and stopped by the same `bindAuth`. One sign-in, the pad's. `refresh()` syncs both.
- A line in an hour: `NodeRow.slot` is `'YYYY-MM-DDTHH'` (`core/slot.ts`; `+N` after it for a run of hours, and commas between runs for hours that are apart, so read it through `slotHours`, `slotCovers` and `slotRuns`, never by hand), set by the toolbar's "Hour…" (`LINE_ACTIONS`, a clock icon on the toolbar of both apps; it opens the shared `SlotPicker` through `setSlotPickerOpener`) or by typing a line into an open hour. Counts are `slotCounts` over the whole table: every pad, blank lines and pad rows left out, a line counted for itself only.
- Web and phone differ in a few wired-up things (chimes, pull to sync, what was checked by hand): the table is in `PLAN.md` under "Hours". Keep it current when one side catches up.
- Chimes: the web rings from the page (`apps/web/src/platform/chimes.ts`); the phone uses local notifications (`apps/mobile/src/chimes.ts`, expo-notifications, loaded only when the build has it).
- The web app aliases `react-native` to `react-native-web` and dedupes `react` (`vite.config.ts`, `vitest.config.ts`). Hours is loaded on first use (`apps/web/src/panels/Hours.tsx`), so the pad does not carry it.

## Boomerang

Since 2026-11-25 a line can be sent out of the pads until a later day (the floating Boomerang button). Details in `PLAN.md` under "Boomerang"; the rules that bite:

- A line that is out has `due` ('YYYY-MM-DD') and sits under the Later pad row. `scopePad` and `padLines` skip a row with `due`, so anything built on them leaves it out for free; anything that walks `all` or `childrenOf(index, later)` itself has to skip it by hand.
- Delivery (`deliverBoomerangs`) is not an edit: it goes through `applyQuiet`, with no undo step, and stamps the row with the moment its day started (not now), so a device that wakes up late does not overwrite newer edits. Keep that stamp if the delivery changes.
- A day here is Hours' day: it starts at the day start setting, read from the hours stores (`openHours().day`).
- `fresh` (the dot on a line that came back) is cleared by `commit` on any edit to the row.
- The watch does not know `due` yet.

## Commands

```bash
pnpm install
pnpm --filter @hissypad/web dev     # http://localhost:5180 (desktop app: launch config "hissypad-web" in .claude/launch.json)
pnpm test                           # every package (Vitest)
pnpm coverage                       # the same, with a per-file coverage table
pnpm typecheck
pnpm --filter @hissypad/web e2e     # Playwright drag tests, desktop + phone profiles
pnpm --filter @hissypad/web build   # apps/web/dist, what Render serves
supabase start && supabase test db  # local stack + pgTAP (RLS, last-write-wins)
```

Mobile commands (Expo, EAS, env pull, update channels) are in `README.md`. The phone cannot reach the local Supabase stack; `apps/mobile/.env.local` holds the hosted values and `.env.local.localstack` the local copy.

## Rules

- Work in a worktree, never in the checkout at the repo root. Sessions started from the phone over Remote Control open in `/Users/kevin/Personal/hissy-pad` itself, on `main`, with no worktree, and several of them at once would edit the same files. So if the working directory is that root (not under `.claude/worktrees/`), call `EnterWorktree` with a short name for the task before editing any file; a read-only question needs none. Shipping from the worktree then follows the steps below.
- A change counts as done when `pnpm test` and `pnpm typecheck` pass and, for anything visible, it was checked in the browser (or the simulator for mobile).
- Ship every done change without asking, in this order:
  1. Commit on `main` with a one-line message that says what changed, and push. Render rebuilds the web app from `main` on its own.
     From a worktree, never push the branch straight to `origin/main`: that leaves the checkout at the repo root (`/Users/kevin/Personal/hissy-pad`) behind what is live. Instead, fast-forward that checkout first (`git -C /Users/kevin/Personal/hissy-pad merge --ff-only <branch>`, after checking it is on `main` and clean), then push from it. If it will not fast-forward, say so and stop instead of forcing or rebasing it.
  2. If anything under `apps/mobile`, `packages/core` or `packages/state` changed, publish an OTA update so the phone picks it up: `cd apps/mobile && npx eas-cli update --channel preview --environment preview --message "<commit subject>" --non-interactive` (the standalone build on Kevin's iPhone is on `preview`). Publish the same to `development` when the dev client is in use.
  3. A native change (a new dependency with native code, `app.json`, `eas.json`, a config plugin, an Expo SDK bump) cannot ship as an update: run `npx eas-cli build --profile preview --platform ios --non-interactive` instead and say that the phone needs the new build installed.
  4. Watch CI (`.github/workflows/ci.yml`: typecheck, Vitest, build, Playwright e2e, pgTAP). A push is not done until the `ci` run for its commit finishes: `gh run list --commit <sha>`, then `gh run watch <id> --exit-status` (in the background; it runs a few minutes). If it fails, read `gh run view <id> --log-failed`, fix it in the same session and ship the fix the same way, even when the break is not from your change (a flaky test, a slow runner, a pinned tool). Before starting, `gh run list --limit 3` on `main`: if it is already red, fix that first or say so.
  Say in the reply what was pushed, updated or built and how CI came out, and skip a step only when its check failed, saying so.
- Schema changes are a new file in `supabase/migrations/` with a pgTAP test, plus the matching column add in the mobile SQLite store (it migrates on open). Rows are never hard-deleted; `deleted_at` is the tombstone.
- The Apple Watch app is a sync client of its own, in Swift (`apps/mobile/targets/watch`): it repeats the tree, open-line and merge rules from the packages, so change `Rows.swift` with them. Siri's add on the phone sends through the same `Remote.swift` and `Rows.swift` (`apps/mobile/native/SiriSync.swift`), compiled into the app. A change under `supabase/functions/` ships with `supabase --workdir /Users/kevin/Personal/hissy-pad functions deploy <name>`.
- Every edit stamps `updated_at` through the clock in core. Undo re-stamps the touched rows so the change syncs.
- A shared screen goes in `packages/ui`, in React Native, only if it needs nothing the DOM has and the phone lacks. The pad's editor stays per app. Its tests run in jsdom through react-native-web (`packages/ui/src/testing/rntl.ts` maps React Native Testing Library's `press` and `changeText`).
- A new column on `nodes` needs `PULL_EPOCH` raised in `core/sync/engine.ts` when it ships: a device still running the old code pulls rows that carry the column, stores them without it and moves its cursor past them (2026-11-23: the phone showed no hour chips for lines given one on the web). Under a new epoch every device reads all rows once more, and the merge takes the server's row over a clean local one of the same `updated_at` that differs. The watch's own merge (`Rows.swift`) was left strictly-newer: it only keeps columns it knows.
- The store can zoom into one line (`zoomId`, `zoomTo` in `state/store.ts`): `rows` is then what is under that line, and every command works there. The new item's card and Sort's card use it (`state/create.ts`, `state/sort.ts`). Anything that must see the pad while zoomed reads `scopePad(all, padId)` (`sortRows`), not `rows`. While zoomed, only one set of pad rows may be on screen: the web unmounts the pad behind the dialog, the phone's pad screen keeps the rows it last had, with nothing being edited. A write to the zoomed line itself goes through `applyAll`.
- `_repro.test.*` files are scratch reproductions, not part of the suite. Delete them when the bug is fixed.
- Keep the look: paper ground, serif, one accent. Dials in the header of `apps/web/src/styles.css`. The colors and text sizes are one set for the web, the phone and Hours: `packages/core/src/look.ts` (the stylesheet repeats them and `apps/web/src/look.test.ts` holds it to them), so change them there and in the stylesheet together.

## Gotchas

- `pnpm --filter @hissypad/web e2e` reuses whatever answers on port 5181. Another session's dev server there means the tests run against that session's code, not yours: copy `playwright.config.ts` with another port and `reuseExistingServer: false` and run `playwright test -c` on the copy.
- Metro started with `CI=1` does not watch files: it keeps serving the first bundle. Start it without `CI`, with stdin from `/dev/null`.
- A line is 25.5px (17px * 1.5) on the web and 26pt on a phone; the numbers are in `packages/core/src/look.ts`, which the phone's theme and Hours' import and a test holds the stylesheet to. Anything that copies a rounded `scrollHeight` or `offsetHeight` into a height will be half a pixel off; snap to whole line-heights (see the textarea auto-grow in `apps/web/src/pad/Row.tsx`).
- Android (started 2026-11-25, see `PLAN.md` under "Android"): builds need `JAVA_HOME` set to Android Studio's JDK (`/Applications/Android Studio.app/Contents/jbr/Contents/Home`) and `ANDROID_HOME=~/Library/Android/sdk`. Android's TextInput ignores `lineHeight` in its own style; give it a Text child that carries it (`Row.tsx`). The Android builds are on no update channel, so step 2 of shipping does not reach them.
- The bullet is also the drag handle: its tap target grows sideways only, never up or down, or the row below steals the tap.
