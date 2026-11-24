# CLAUDE.md (hissy-pad)

Guidance for Claude Code in this repo. The shared rules (who Kevin is, writing voice, facts bank) are in `../CLAUDE.md`.

## What this is

HissyPad: a freeform outline, always open, between Google Docs and Hissycal; since 2026-11-02 a few of them ("pads", tabs under the title, with a two-pane Fresh start that moves the leftovers of a pad into a new one). A flat `nodes` table, offline-first, each row synced on its own with last-write-wins on the server. A pad is a root-level row with `pad` set. Since 2026-11-24 the tabs start with three fixed pads, Today, Inbox and Later (ordinary pad rows found by name, `settleFixedPads` in core), and the root level is no longer shown: whatever lands there is moved to the top of Inbox after load and after every sync merge (`settleFixed` in the store); the store shows one pad at a time as a scoped view (`rows`) over the whole table (`all`), see `packages/core/src/pads.ts`. Web (Vite + React 19, PWA) and mobile (Expo) share the same core and state packages. Live at https://hissypad.marcelo.ph (Render static site, auto-deploys from `main`, hosted Supabase behind it). Public repo `kevinmarceloph/hissy-pad`, Kevin's first public one: nothing under NDA, no pad content, no keys.

Since 2026-11-23 it also holds **Hours**: Oras-oras (the hourly self-tracker in `../oras`, left as it is) rebuilt on this stack as a mode of its own, like Sort. One row per hour with a plan and what happened, categories, flags, recurring plans, a day start, chimes; plus two things Oras-oras does not have: a line of the pad can be put in an hour of a day (`slot` on the row), and each hour counts its lines done out of all. See "Hours" below.

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

Platform logic goes in `packages/state` or `packages/core`, never in an app. If web and mobile would both need it, it belongs in a package. A toolbar button is an entry in `LINE_ACTIONS` (`packages/state/src/actions.ts`), not markup in either app.

## Hours

- Where it lives: `packages/core/src/hours` (pure logic, imported as `@hissypad/core/hours`), `packages/state/src/hours` (stores, the sync engine for its four tables, the slot commands; `@hissypad/state/hours`), `packages/ui/src/hours` (the screens). The names stay out of the pad's index files on purpose: `Entry`, `MemoryStore`, `syncLine` and others would collide.
- The code came from `../oras` on 2026-11-23 and keeps its style (semicolons, its comments). Its rules still hold and are in `../oras/CLAUDE.md`: `(day, hour)` is the calendar slot, never the day as drawn; `byHour` is what is stored and `shown` is what is drawn; every write from the day screen goes through `pinRecurring`; flags are read and written through `flagChoice` and `setFlagChoice`; a color is a palette key, never a hex; nothing rests on color alone (Kevin is a deuteranope); every control in an open hour takes the `hold` handlers.
- Nothing is seeded (Kevin, 2026-11-23): no default categories, no default flags. `SAMPLE_CATEGORIES` and `SAMPLE_FLAGS` exist for tests only. A new flag still starts with Yes and No as its options.
- Storage: the four hours tables are real tables on the server (`hour_entries`, `hour_categories`, `hour_flags`, `recurring_plans`, `updated_at` in ms as a bigint, no `deleted_at`). On a device they are JSON rows behind `HoursBackend` (`core/hours/store.ts`): one IndexedDB store on web, one SQLite table on the phone. `HoursStore` keeps them all in memory and writes through.
- Sync: a second engine beside the pad's (`state/hours/engine.ts`), started and stopped by the same `bindAuth`. One sign-in, the pad's. `refresh()` syncs both.
- A line in an hour: `NodeRow.slot` is `'YYYY-MM-DDTHH'` (`core/slot.ts`), set by the toolbar's "Hour…" (`LINE_ACTIONS`, behind More on the phone; it opens the shared `SlotPicker` through `setSlotPickerOpener`) or by typing a line into an open hour. Counts are `slotCounts` over the whole table: every pad, blank lines and pad rows left out, a line counted for itself only.
- Web and phone differ in a few wired-up things (chimes, pull to sync, where "Hour…" sits, what was checked by hand): the table is in `PLAN.md` under "Hours". Keep it current when one side catches up.
- Chimes: the web rings from the page (`apps/web/src/platform/chimes.ts`); the phone uses local notifications (`apps/mobile/src/chimes.ts`, expo-notifications, loaded only when the build has it).
- The web app aliases `react-native` to `react-native-web` and dedupes `react` (`vite.config.ts`, `vitest.config.ts`). Hours is loaded on first use (`apps/web/src/panels/Hours.tsx`), so the pad does not carry it.

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

- A change counts as done when `pnpm test` and `pnpm typecheck` pass and, for anything visible, it was checked in the browser (or the simulator for mobile).
- Ship every done change without asking, in this order:
  1. Commit on `main` with a one-line message that says what changed, and push. Render rebuilds the web app from `main` on its own.
     From a worktree, never push the branch straight to `origin/main`: that leaves the checkout at the repo root (`/Users/kevin/Personal/hissy-pad`) behind what is live. Instead, fast-forward that checkout first (`git -C /Users/kevin/Personal/hissy-pad merge --ff-only <branch>`, after checking it is on `main` and clean), then push from it. If it will not fast-forward, say so and stop instead of forcing or rebasing it.
  2. If anything under `apps/mobile`, `packages/core` or `packages/state` changed, publish an OTA update so the phone picks it up: `cd apps/mobile && npx eas-cli update --channel preview --environment preview --message "<commit subject>" --non-interactive` (the standalone build on Kevin's iPhone is on `preview`). Publish the same to `development` when the dev client is in use.
  3. A native change (a new dependency with native code, `app.json`, `eas.json`, a config plugin, an Expo SDK bump) cannot ship as an update: run `npx eas-cli build --profile preview --platform ios --non-interactive` instead and say that the phone needs the new build installed.
  Say in the reply what was pushed, updated or built, and skip a step only when its check failed, saying so.
- Schema changes are a new file in `supabase/migrations/` with a pgTAP test, plus the matching column add in the mobile SQLite store (it migrates on open). Rows are never hard-deleted; `deleted_at` is the tombstone.
- The Apple Watch app is a sync client of its own, in Swift (`apps/mobile/targets/watch`): it repeats the tree, open-line and merge rules from the packages, so change `Rows.swift` with them. Siri's add on the phone sends through the same `Remote.swift` and `Rows.swift` (`apps/mobile/native/SiriSync.swift`), compiled into the app. A change under `supabase/functions/` ships with `supabase --workdir /Users/kevin/Personal/hissy-pad functions deploy <name>`.
- Every edit stamps `updated_at` through the clock in core. Undo re-stamps the touched rows so the change syncs.
- A shared screen goes in `packages/ui`, in React Native, only if it needs nothing the DOM has and the phone lacks. The pad's editor stays per app. Its tests run in jsdom through react-native-web (`packages/ui/src/testing/rntl.ts` maps React Native Testing Library's `press` and `changeText`).
- A new column on `nodes` needs `PULL_EPOCH` raised in `core/sync/engine.ts` when it ships: a device still running the old code pulls rows that carry the column, stores them without it and moves its cursor past them (2026-11-23: the phone showed no hour chips for lines given one on the web). Under a new epoch every device reads all rows once more, and the merge takes the server's row over a clean local one of the same `updated_at` that differs. The watch's own merge (`Rows.swift`) was left strictly-newer: it only keeps columns it knows.
- `_repro.test.*` files are scratch reproductions, not part of the suite. Delete them when the bug is fixed.
- Keep the look: paper ground, serif, one accent. Dials in the header of `apps/web/src/styles.css`.

## Gotchas

- A line is 25.5px (17px * 1.5). Anything that copies a rounded `scrollHeight` or `offsetHeight` into a height will be half a pixel off; snap to whole line-heights (see the textarea auto-grow in `apps/web/src/pad/Row.tsx`).
- The bullet is also the drag handle: its tap target grows sideways only, never up or down, or the row below steals the tap.
