# CLAUDE.md (hissy-pad)

Guidance for Claude Code in this repo. The shared rules (who Kevin is, writing voice, facts bank) are in `../CLAUDE.md`.

## What this is

HissyPad: one freeform outline, always open, between Google Docs and Hissycal. A flat `nodes` table, offline-first, each row synced on its own with last-write-wins on the server. Web (Vite + React 19, PWA) and mobile (Expo) share the same core and state packages. Live at https://hissypad.marcelo.ph (Render static site, auto-deploys from `main`, hosted Supabase behind it). Public repo `kevinmarceloph/hissy-pad`, Kevin's first public one: nothing under NDA, no pad content, no keys.

- `README.md`: layout, run commands, keys. Read it first.
- `PLAN.md`: the design (data model, sync, editing model), phases and what is pending. Keep its status line and phase notes current when a phase moves; dates are absolute (`2026-10-29`), Manila time.

## Layout

```
packages/core    pure TS, no React: types, tree, ops, rank, drop resolver, paste, clock, sync engine, LocalStore
packages/state   Zustand store, commands, per-op undo, debug log, Supabase remote, sync binding
apps/web         Vite SPA on :5180, IndexedDB store, pointer drag, Playwright e2e
apps/mobile      Expo SDK 58 shell: expo-sqlite store, same toolbar, EAS build/update profiles
supabase/        migrations (nodes, RLS, LWW trigger), pgTAP tests, local stack on ports 54421-54429
```

Platform logic goes in `packages/state` or `packages/core`, never in an app. If web and mobile would both need it, it belongs in a package.

## Commands

```bash
pnpm install
pnpm --filter @hissypad/web dev     # http://localhost:5180 (desktop app: launch config "hissypad-web" in .claude/launch.json)
pnpm test                           # every package (Vitest)
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
  2. If anything under `apps/mobile`, `packages/core` or `packages/state` changed, publish an OTA update so the phone picks it up: `cd apps/mobile && npx eas-cli update --channel preview --environment preview --message "<commit subject>" --non-interactive` (the standalone build on Kevin's iPhone is on `preview`). Publish the same to `development` when the dev client is in use.
  3. A native change (a new dependency with native code, `app.json`, `eas.json`, a config plugin, an Expo SDK bump) cannot ship as an update: run `npx eas-cli build --profile preview --platform ios --non-interactive` instead and say that the phone needs the new build installed.
  Say in the reply what was pushed, updated or built, and skip a step only when its check failed, saying so.
- Schema changes are a new file in `supabase/migrations/` with a pgTAP test, plus the matching column add in the mobile SQLite store (it migrates on open). Rows are never hard-deleted; `deleted_at` is the tombstone.
- Every edit stamps `updated_at` through the clock in core. Undo re-stamps the touched rows so the change syncs.
- `_repro.test.*` files are scratch reproductions, not part of the suite. Delete them when the bug is fixed.
- Keep the look: paper ground, serif, one accent. Dials in the header of `apps/web/src/styles.css`.

## Gotchas

- A line is 25.5px (17px * 1.5). Anything that copies a rounded `scrollHeight` or `offsetHeight` into a height will be half a pixel off; snap to whole line-heights (see the textarea auto-grow in `apps/web/src/Row.tsx`).
- The bullet is also the drag handle: its tap target grows sideways only, never up or down, or the row below steals the tap.
