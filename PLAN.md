# HissyPad: plan

A scratchpad that sits between Google Docs and Hissycal. One freeform outline, always open, where the top of the page is whatever needs attention next. Drag things around in a hierarchy, multi-select, cross things out. Nothing else.

Status (2026-10-28): phases 1-5 built (phase 5 in progress: Expo app runs the shared state package; EAS builds not yet made); phase 3 is verified against the local Supabase stack only (no hosted project yet). Earlier note: phases 1 and 2 built. `packages/core` (51 tests) and `apps/web` (18 tests) typecheck and pass; the web app was clicked through in a browser (typing, Enter/Tab, selection keys, paste import, hide/sweep done, reload persistence, dark, phone width). Not deployed yet: `render.yaml` is ready for a Render static site once the GitHub repo exists.

Decisions (2026-10-28): public repo from day one; login by magic link and Google; domain `hissypad.marcelo.ph`; `collapsed` syncs across devices.

## What it is

- One document ("the pad"), a tree of nodes. No days, divisions, inboxes, blocks or time fields. Urgency is position: what matters is near the top, like the Docs inbox today.
- A node is a line of text with optional children. Blank nodes are allowed and act as spacers, the way blank lines do in Docs. Headings are just nodes with children ("WL:", "Housey:"). No node types.
- Done is a strikethrough that stays in place (item 3 in the screenshot stays crossed out where it was), with a × bullet like a bullet journal. "Delete done" removes every crossed-out line in one go; undo is the safety net. (An earlier "sweep under a Done node" idea was dropped 2026-10-28 in favour of deleting.)
- Collapse and expand per node. Links are auto-linked. Plain text otherwise. No formatting, except that any line can be numbered: a run of consecutive numbered siblings counts 1, 2, 3 and a plain line restarts the count, like a Docs list. Pasting "1." lines keeps them numbered.
- Blank lines are spacers and show no bullet until typed into.
- Paste from Google Docs imports indentation as hierarchy, so the current inbox moves over in one paste. Hissycal's `indentWidth` + `createItemsAfter` already do this for a single day; the same logic ported to the flat model.
- Capture from the phone: share sheet appends to the top of the pad.

What it is not: not a calendar, not a notes app with many documents, not collaborative. One user, several devices.

## Why not just extend Hissycal

Hissycal's model is a nested JSON blob per user, synced by PUT-the-whole-thing with a 409 banner when two devices overlap. That worked for a calendar edited mostly from one device at a time. A scratchpad gets edited from the phone in a queue and the laptop five minutes later, so whole-document conflicts are the normal case, not the edge case. HissyPad flips the model: a flat table of nodes, each row synced on its own, conflicts resolved per node. If it holds up, the Hissycal rewrite starts from this core and adds date and time columns to the same table.

## Data model

One table, `nodes`. Flat, not nested.

| column | type | notes |
|---|---|---|
| id | uuid | generated on the client, so offline inserts need no round trip |
| user_id | uuid | owner, defaults to `auth.uid()` |
| parent_id | uuid or null | null = top level of the pad |
| rank | text | fractional index between siblings, own implementation in `core/rank.ts` with the same integer-plus-fraction shape as the `fractional-indexing` package, so capture at the top stays two or three characters. A move is one row update, never a renumber |
| text | text | plain text, may contain newlines |
| done | boolean | |
| collapsed | boolean | synced on purpose: if I fold "Project Ideas" on the laptop I want it folded on the phone too |
| numbered | boolean | shown as "1." within its run of consecutive numbered siblings |
| updated_at | timestamptz | set by the client that made the change, see sync |
| deleted_at | timestamptz or null | tombstone; rows are never hard-deleted by clients |

The tree is derived: group by `parent_id`, sort by `rank`, tiebreak by `id`. Every edit is a change to one or more rows. Multi-select drag of five nodes is five rank updates.

Hissycal keeps `expanded` out of the synced document as view state. HissyPad syncs `collapsed` and keeps only selection and scroll position local.

## Sync: offline-first, last write wins per row

The learning item here is "offline-first / local-first sync" from tech-to-learn.md: SQLite on device, change log, idempotent sync, conflict resolution. Hand-rolled, because a single user on three devices is the easy case and the point is to understand it. PowerSync or ElectricSQL is the fallback if it turns into a swamp.

- Every client keeps a full local copy of its nodes (IndexedDB on web, SQLite on mobile) and renders only from that. The app works with no network at all.
- Every local edit stamps `updated_at` with the client's clock plus a small device offset guard (a hybrid logical clock in one line: never emit a timestamp lower than the last one you saw).
- Push: dirty rows are upserted in batches. A `before insert or update` trigger drops any write whose `updated_at` is not newer than the stored row, so last-write-wins is decided on the server and every device converges whatever the arrival order. Replaying a batch is harmless, so retries are free. A row edited while its push is in flight stays dirty.
- Pull: `select * from nodes where synced_at > :cursor order by synced_at`, cursor stored locally. `synced_at` is stamped by the server on every accepted write, so the cursor is not fooled by client clocks; the client also backs the cursor up ten seconds on each pull so a row that committed slightly out of order is still seen (duplicates are harmless, the merge compares `updated_at`). Tombstones come through the same query.
- Live: a Supabase Realtime subscription on `nodes` filtered by `user_id` nudges a pull, so the laptop sees the phone's capture within a second. Realtime is a hint only; correctness comes from the pull cursor.
- Conflicts: the row with the later `updated_at` wins the whole row. Two devices editing the same node's text within the same offline window is the only real loss, and that is rare on a personal pad. Structural conflicts (one device moves a node, the other edits its text) merge cleanly because rank and text are on the same row only when the same device touched both. Orphans (parent deleted on another device) are re-parented to the root on read, never dropped.

The whole engine is pure TypeScript in the core package behind a `LocalStore` interface with about six methods (`getAll`, `upsertMany`, `dirty`, `markClean`, `getCursor`, `setCursor`). Web and mobile each ship one adapter.

## Stack

| layer | choice | why |
|---|---|---|
| repo | pnpm workspaces + Turborepo | the "monorepo with shared TS core" ask on the Expo line of tech-to-learn.md. Hissycal does this with `file:` deps and no task runner |
| `packages/core` | pure TS: types, tree ops, drop resolution, paste importer, sync engine, `LocalStore` interface | no React, no platform APIs, Vitest only |
| `apps/web` | Vite + React 19 + Zustand + vite-plugin-pwa | a SPA, not Next.js: an outliner has no server-rendered page, and Doorstep already covers Next.js. PWA so it installs on the phone before the native app exists |
| `apps/mobile` | Expo (current SDK) + expo-sqlite + Reanimated + Gesture Handler, EAS Build, EAS Update | Hissycal's mobile stack minus the widget modules. EAS Build and EAS Update are the gaps named in tech-to-learn.md |
| backend | Supabase hosted project: Postgres + RLS + Auth (magic link) + Realtime | the most-requested item on the list by a wide margin. No app server at all; the sync engine talks to PostgREST |
| `supabase/` | migrations, RLS policies, pgTAP tests for the policies, seed | run locally with the Supabase CLI, same as Doorstep |
| CI | GitHub Actions: Vitest, Playwright, `supabase db test` | ticks the GitHub Actions line, and this repo has nothing under NDA |
| web hosting | Render static site | static, so no free-tier sleep. Supabase free tier pauses after a week idle; daily use keeps it awake |

Auth is real even though there is one user. RLS is `user_id = (select auth.uid())` on every policy, with the parenthesised form from the Supabase notes so the planner caches it. That makes the schema a worked RLS example for proposals without pretending HissyPad is multi-tenant.

## Editing model

Simpler than Hissycal's Normal/Edit modes. Always editing, like Workflowy, with a selection mode one keypress away.

- One auto-growing `<textarea>` per node. Enter: new sibling below (splits text at the caret). Shift+Enter: newline inside the node. Backspace at the start of an empty node: delete it and move the caret up.
- Tab / Shift+Tab: indent and outdent. Alt+Up / Alt+Down: move among siblings. Cmd+Enter: toggle done. Cmd+. : collapse and expand.
- Escape: leave the textarea and select the node. Shift+Up/Down extends the selection. Cmd+click toggles, Shift+click ranges. Every keyboard action above works on the selection as a batch. Enter or typing goes back to editing.
- Drag: pointer-based, hand-rolled, no dnd-kit. The pad is a flat list of visible rows, so a drop resolves from pointer y (which gap) and pointer x (which depth, snapped to indent width). That resolver is a pure function in core, `resolveDrop(rows, y, x)`, and both platforms call it. Hissycal's band engine is the same idea with more cases; this one has one list and one axis of depth.
- Mobile: long-press selects, a drag handle on the bullet moves, swipe right marks done. Keyboard shortcuts work with an external keyboard.
- Cross-outs stay visible where they are. "Delete done" removes them all; undo brings them back. Numbered list: Cmd+Shift+7 on a line or a selection.
- Mobile selection: tap a bullet to select, then tap more bullets to add or remove them (no modifier key). The floating toolbar carries every action.

## Repository layout

```
hissy-pad/
  package.json              pnpm workspaces, turbo
  turbo.json
  packages/core/
    src/types.ts            Node, NodeRow, TreeIndex
    src/tree.ts             index from rows, children, visible rows, depth
    src/ops.ts              insertAfter, split, indent, dedent, moveSibling, moveTo, setDone, remove
    src/rank.ts             fractional index helpers, tiebreak
    src/drop.ts             resolveDrop(rows, y, x)
    src/paste.ts            indented text to rows
    src/sync/engine.ts      push, pull, realtime nudge, clock
    src/sync/store.ts       LocalStore interface
  apps/web/
    src/store.ts            Zustand: rows, selection, derived tree
    src/local/idb.ts        LocalStore on IndexedDB
    src/Pad.tsx, Row.tsx, SelectionBar.tsx
    e2e/                    Playwright
  apps/mobile/
    src/local/sqlite.ts     LocalStore on expo-sqlite
    src/Pad.tsx, DragList.tsx (Reanimated)
    app.config.ts, eas.json
  supabase/
    migrations/0001_nodes.sql
    tests/rls.sql           pgTAP
    seed.sql
  .github/workflows/ci.yml
```

## Phases

Each phase ends with something usable. Phase 2 is the point where the Docs inbox moves over.

1. **Core** (done 2026-10-28). Types, tree index, ops, rank helpers, paste importer, clock. Vitest, including a property test that any sequence of ops keeps ranks unique and the tree acyclic. No UI. See `packages/core/README.md`.
2. **Web, local only** (built 2026-10-28, deploy pending). Editor with the keyboard model, done, collapse, IndexedDB store, PWA manifest, undo/redo, Paste-in dialog, Copy all. Deploy to Render static, then paste the Google Docs inbox in and start using it. Sync is a stub (`LocalStore` already tracks dirty rows for phase 3).
3. **Supabase + sync** (built 2026-10-28). Migration with a last-write-wins trigger and a server-stamped `synced_at` pull cursor, RLS with pgTAP tests (13), magic link + Google sign-in, sync engine push/pull/realtime with ten two-device tests (`packages/core/src/sync/engine.test.ts`). Pending: a hosted Supabase project, `supabase db push`, env vars on Render.
4. **Drag and multi-select** (built 2026-10-28). `resolveDrop` in core (gap by row midpoints, depth by x, clamped to what the gap allows) with tests; pointer drag on web with long-press on touch, live reorder (the dragged rows render where they would land and the list reflows, chosen 2026-10-29 from a five-option demo at /drop-demo.html), ghost, autoscroll, Escape to cancel; a selection drags as a block. Playwright E2E with real mouse and CDP touch coordinates on desktop and Pixel profiles, run in CI.
5. **Mobile** (started 2026-10-28). The platform-neutral app logic moved out of `apps/web` into `packages/state` (store, commands, per-op undo, log, Supabase remote, sync binding), so `apps/mobile` is a thin Expo shell: an expo-sqlite `LocalStore`, AsyncStorage-backed auth with the `hissypad://auth` deep link for magic links and Google, a ScrollView of rows with a multiline TextInput for the edited line, the same toolbar above the keyboard, and long-press drag through core's `resolveDrop`. Verified in the iOS Simulator through Expo Go (typing, Return splitting, toolbar indent, long-press drag). Pending: EAS Build to the phone, EAS Update, the share-sheet capture (needs a dev client and a config plugin).
6. **Polish**. Search (`Cmd+K` jumps to a node). Dark mode, Delete done and numbered lists landed in phase 2; undo became per-op (only the touched rows, stamped fresh so it syncs) with a debug log (`?debug=1`) on 2026-10-28.

Later, not planned: multiple pads as top-level tabs, a Hissycal rewrite that adds `date`, `start_time`, `end_time` and `division` columns to `nodes` and renders days as filtered views over the same table.

## tech-to-learn.md items this ticks

Tick these in the list once the phase that covers them is built, not before.

- Supabase: RLS, Auth, Realtime, PostgREST upserts, pgTAP policy tests (phase 3).
- Offline-first / local-first sync: SQLite on device, idempotent push, cursor pull, LWW conflicts (phases 3 and 5).
- Expo: EAS Build, EAS Update, expo-sqlite, recent SDK, monorepo with shared TS core via pnpm + Turborepo (phase 5).
- Zustand (phase 2). Playwright E2E with drag (phase 4). PWA installable + offline (phase 2).
- GitHub Actions on a public repo, which would also be the first public repo on github.com/kevinmarceloph (phase 2 onward, if HissyPad goes public).

Not ticked on purpose: Next.js, tRPC/Drizzle, TanStack Query. None of them earn their place in an outliner.

## Decided

- Public repo from day one. Nothing in it is client work; the pad content itself never lives in the repo. This becomes the first public repo on github.com/kevinmarceloph.
- Login: magic link and Google.
- Domain: `hissypad.marcelo.ph`.
- `collapsed` syncs across devices, unlike Hissycal's device-local `expanded`.

## Blog post

One post when phase 3 lands: "Syncing a scratchpad without a server", the flat-table-plus-LWW design, what broke in testing with two simulated devices, and why the calendar app's whole-blob sync was the wrong shape. Add it to the ideas list in `personal-site/README.md` when the time comes.
