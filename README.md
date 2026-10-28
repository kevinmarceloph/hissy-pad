# HissyPad

One freeform outline, always open. The top of the page is what needs attention next. Drag things around in a hierarchy, multi-select, cross things out. Nothing else. Design and roadmap in [PLAN.md](PLAN.md).

```
packages/core   pure TS: node rows, tree, ops, ranks, outline paste/copy, LocalStore, sync engine
apps/web        Vite + React 19 + Zustand, IndexedDB, PWA, Supabase auth + sync
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
```

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

Cmd+Z / Shift+Cmd+Z undo and redo anywhere. Tap a bullet to select it; once something is selected, tapping other bullets toggles them (no modifier, so it works on a phone). Shift+click selects a range. Blank lines show no bullet, done lines show a × like a bullet journal, and "Delete done" removes every crossed-out line (undo brings them back).

## Deploy

`render.yaml` describes a Render static site built from the repo root; set the two `VITE_SUPABASE_*` env vars on the service. The hosted Supabase project needs `supabase db push` for the migration, the site URL `https://hissypad.marcelo.ph` in Auth settings, and the Google provider enabled. The app icon is a placeholder (the letter H in the body serif).

## Status

Phase 3 built: local-first sync against a local Supabase stack. Not yet deployed; no hosted project yet.
