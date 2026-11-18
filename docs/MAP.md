# Where everything is

A map of the HissyPad code: what each folder and file holds, how an edit travels through it, and where to put the next thing. The design and its history are in [PLAN.md](../PLAN.md); run commands and keys are in [README.md](../README.md).

## The shape

Three layers, each only knowing the one below it.

```
apps/web, apps/mobile   draw the pad, catch keys, pointers and gestures
        |  call commands, read the store
packages/state          the store, commands, undo, sync wiring: no DOM, no React Native
        |  run ops on rows
packages/core           pure functions over rows: no React, no storage, no clock of its own
```

One edit, start to finish:

1. A key or a button calls a **command** in `packages/state` (`cmdIndent`, `cmdSortSend`).
2. The command picks its targets from the store and runs a **core op** through `apply` (the pad shown) or `applyAll` (the whole table, for anything that crosses pads).
3. `apply` diffs the rows, pushes one **undo entry** holding only the rows that changed, and writes those rows to the **LocalStore** as dirty.
4. The **sync engine** pushes dirty rows and pulls newer ones. The server keeps whichever row has the later `updated_at`.

A rule that follows from this: if web and the phone would both need a piece of logic, it goes in a package, not in an app.

## packages/core

Pure TypeScript. Every op takes the rows and returns new rows, with only the changed ones replaced.

| file | what is in it |
|---|---|
| `types.ts` | `NodeRow` (one row of the `nodes` table), `normalizeRow` for rows from an older build, `ROW_KEYS` and `sameRow`, `kindOf` |
| `tree.ts` | the tree derived from `parentId` + `rank`: `buildIndex`, `childrenOf`, `flatten`, `descendantIds`, `topmost`, list numbers |
| `rank.ts` | fractional ranks: a rank between two others, re-ranking a run |
| `ops.ts` | every edit to lines: insert, split, set text, done, kind, fold, remove, restore, move, indent, dedent, ungroup, merge, delete done |
| `pads.ts` | several pads in one table: the scoped view (`scopePad`), create, reorder (`movePad`), move lines across, line to pad, Fresh start |
| `drop.ts` | `resolveDrop`: where a dragged line lands, from pointer position and row layout |
| `paste.ts` | text to outline and back: `parseOutline`, `insertOutline`, `toOutline`, `toOutlineHtml` |
| `clock.ts` | the monotonic clock every edit stamps `updated_at` with, and `newUuid` |
| `sync/store.ts` | the `LocalStore` interface, an in-memory one, `changedRows` |
| `sync/engine.ts` | the sync loop: push dirty rows, pull by cursor, merge, status |
| `sync/wire.ts` | a row to and from the table's snake_case columns |
| `sync/fakeRemote.ts` | an in-memory server with last-write-wins, for tests |
| `testing.ts` | `pad('A\n  B')` builds rows from an outline, `shape(rows)` prints them back, `idOf`, `testCtx` |
| `index.ts` | the package's public surface. Export new things here |

## packages/state

The app without a screen. Zustand for the store, plain functions for everything else.

| file | what is in it |
|---|---|
| `store.ts` | the state (`all` rows, the scoped `rows` of the pad shown, `padId`, selection, editing, undo stacks), `apply` and `applyAll`, loading, `openPad`, `setAll`, `importOutline` |
| `history.ts` | `undo` and `redo` |
| `selection.ts` | selecting and editing: `select`, `clickSelect`, `selectRange`, `stepSelection`, `edit`, `targets`, `neighbor` |
| `commands.ts` | the editor commands (`cmd…`): what a key or button does to lines, and where the caret or selection goes after |
| `actions.ts` | the line toolbar as data: `LINE_ACTIONS`, `LINE_KINDS`, `lineAbilities`. Web and the phone both draw from it |
| `pads.ts` | pad commands: new, rename, delete, reorder, move to, make pad from a line, Fresh start |
| `lists.ts` | the Trash and Recently done panels: entries, restore, un-done, day grouping |
| `sort.ts` | Sort: the queue, the two targets, sending a card, the session a sort screen holds, the swipe rule |
| `shake.ts` | shake detection from accelerometer samples |
| `widget.ts` | the home-screen widget's data: the snapshot it draws from, applying the buttons pressed on it, adding a line to a pad |
| `sync.ts` | wires the engine to the store and to Supabase auth; `refresh`, `forceSync`, the status line (`syncLine`) |
| `remote.ts` | the `Remote` the engine talks to, over Supabase |
| `log.ts` | the debug log (`?debug=1`) |
| `sample.ts` | the welcome pad a new device starts with |
| `testing.ts` | `resetStore(outline)` for tests here and in the apps |

## apps/web

Vite, React 19, a PWA. `src/main.tsx` wires the platform (IndexedDB, clipboard, sync wake-ups) into the state package and mounts the app. `src/styles.css` is all the CSS, with the look's dials in its header.

| folder | what is in it |
|---|---|
| `src/app/` | the shell: `App.tsx` (which view is open: pad, Fresh start or Sort), `TopBar.tsx`, `Account.tsx` (the footer), `PullToRefresh.tsx`, `toast.ts` |
| `src/pad/` | the editor: `Pad.tsx` (the list and the selection-mode keys), `Row.tsx` (one line and its keys while editing), `SelectionBar.tsx` (the toolbar), `useDrag.ts` (pointer drag) |
| `src/pads/` | `PadTabs.tsx` (tabs, the pad sheet) and `FreshStart.tsx` |
| `src/panels/` | `Lists.tsx` (Trash, Recently done) and `Sort.tsx` |
| `src/platform/` | what only a browser has: `idb.ts` (LocalStore on IndexedDB), `clipboard.ts`, `supabase.ts`, `os.ts` (Mac or not, shortcut hints) |
| `e2e/` | Playwright with real pointers and touches: `drag.spec.ts`, `sort.spec.ts`, `toolbar.spec.ts` (the Move to… menu is really on screen) |
| `test/setup.ts` | jsdom gaps filled in (dialogs) |

## apps/mobile

Expo. `App.tsx` mounts the pad; `src/setup.ts` wires the platform (SQLite, clipboard, AsyncStorage) into the state package.

| file | what is in it |
|---|---|
| `src/ui/Pad.tsx` | the screen: top bar, pad chips, the list, long-press drag, pull to refresh |
| `src/ui/Row.tsx` | one line |
| `src/ui/Toolbar.tsx` | the line toolbar above the keyboard, drawn from `LINE_ACTIONS` as two rows (no sideways scroll); actions marked `more` and Move to… sit behind More |
| `src/ui/FloatingButtons.tsx` | the round buttons at the top right: + (a line at the top) when nothing is targeted; a check (cross out) and a chevron (done editing) while editing or selecting |
| `src/ui/PadChips.tsx` | the pads as chips, with rename, reorder and delete |
| `src/ui/Lists.tsx` | Trash and Recently done sheets |
| `src/ui/Sort.tsx` | the Sort screen (PanResponder swipe) |
| `src/ui/Account.tsx` | sign in and the sync line |
| `src/shake.ts` | shake to undo (needs a build with `expo-sensors`) |
| `src/local/sqlite.ts` | LocalStore on expo-sqlite; adds new columns on open |
| `src/theme.ts` | the paper and ink tokens |
| `src/widget.ts` | the app's end of the widget: writes the snapshot, applies queued presses, handles the widget's links |
| `targets/widget/` | the iOS widget itself, in Swift (WidgetKit + App Intents): `Shared.swift` (the shared storage), `Intents.swift` (the pad setting, the send button), `InboxWidget.swift` (timelines and views for the Inbox widget and the small Add widget), `expo-target.config.js` (target settings and colors) |
| `native/AppShortcuts.swift` | the Siri / Shortcuts command "Add to HissyPad" (an App Intent). Compiled into the app, not the widget |
| `plugins/withAppShortcuts.js` | config plugin: adds `native/AppShortcuts.swift` and the widget's `Shared.swift` to the app target |
| `plugins/withNoShakeToEdit.js` | config plugin: turns off iOS's own shake prompt |

### The widget and the app

The widget runs in its own process and cannot run any of the JavaScript. The two share an App Group (`group.ph.marcelo.hissypad`) and pass two JSON strings through its UserDefaults:

- `widget.snapshot`: every pad with its open top-level lines. The app writes it when the pads change and tells the widget to redraw. A button on the widget edits it in place, so the widget redraws at once.
- `widget.actions`: what happened outside the app since it was last in front: buttons pressed on the widget, and lines added through Siri (which carry the id they were given, so the widget can show the line and act on it before the app has run). The app applies them (`cmdWidgetActions`) and clears the list when it comes to the front. So a press or a Siri add reaches the pad, and sync, only when the app next opens.

A widget cannot take typing, so its + opens the app at `hissypad://add?pad=…` with a prompt. The shapes are defined once in `packages/state/src/widget.ts` and mirrored by the Codable structs in `Shared.swift`: change both together.

## supabase

`migrations/` (one file per schema change), `tests/nodes.test.sql` (pgTAP: row-level security and last-write-wins), `config.toml` (local stack on ports 54421-54429).

## Adding things

**A toolbar action.** Write the command in `packages/state/src/commands.ts` (or `pads.ts` if it is about pads). Add one entry to `LINE_ACTIONS` in `actions.ts`: id, group, label, name, hint, `run`, `enabled` if it can be impossible, and `more: true` if it is rare enough to sit behind the phone's More button. It appears on web and the phone. If "can it run" needs a new fact about the selection, add a field to `LineAbilities`. Test it in `actions.test.ts`.

**A new edit to lines.** A pure function in `packages/core/src/ops.ts` (rows in, rows out, `ctx.now()` on every row it changes), exported from `index.ts`, tested in `ops.test.ts` with `pad()` and `shape()`. Then a `cmd…` in state that calls it through `apply`. Anything that moves rows between pads goes through `applyAll` and lives in `pads.ts`.

**A keyboard shortcut (web).** While editing a line: `onKeyDown` in `apps/web/src/pad/Row.tsx`. With lines selected: the window handler in `apps/web/src/pad/Pad.tsx`. Both call the same command. Add it to the keys table in the README, to the action's `keys` if it has a button, and to `Keys.test.tsx`.

**A top-bar panel or view.** A panel is a `<dialog>` opened from `TopBar.tsx` (see `Lists.tsx`). A view that replaces the pad adds a value to the `view` state in `App.tsx` (see `Sort.tsx`). Its data and commands go in a file of their own in `packages/state/src`, so the phone can draw the same thing from `apps/mobile/src/ui`.

**A column on a row.** In this order:
1. `NodeRow`, `normalizeRow` and `ROW_FIELDS` in `core/types.ts` (the compiler refuses a `NodeRow` field that is missing from `ROW_FIELDS`).
2. `WireNode`, `toWire` and `fromWire` in `core/sync/wire.ts`, optional on the wire.
3. A new file in `supabase/migrations/` and a pgTAP case in `supabase/tests/`. The hosted project needs `supabase db push`.
4. `apps/mobile/src/local/sqlite.ts`: the `Row` type, `toRow`, the `create table`, an `alter table` for databases made before it, and the upsert.
5. `rowBrief` in `state/log.ts` if the log should show it.
The web's IndexedDB store keeps rows as objects and needs nothing.

**Something native on iOS (a widget, an extension).** A folder under `apps/mobile/targets/` with an `expo-target.config.js` (the `@bacons/apple-targets` plugin turns it into an Xcode target on prebuild). Its data rules go in `packages/state` as plain functions with tests; the Swift side only draws and records. It needs a new build, not an update, and anything the app calls from JS must tolerate a build that does not have it.

**Something only one platform has.** Web: `apps/web/src/platform/`. Phone: `apps/mobile/src/`. Register it with the state package the way `main.tsx` and `setup.ts` register the clipboard and the LocalStore.

## Tests

```bash
pnpm test                           # Vitest, every package
pnpm coverage                       # the same with a coverage table per file
pnpm typecheck
pnpm --filter @hissypad/web e2e     # Playwright, desktop and phone profiles
supabase test db                    # pgTAP against the local stack
```

| where | what it covers | lines covered (2026-11-17) |
|---|---|---|
| `packages/core/src/*.test.ts` | every op, ranks, the tree, paste, pads, the sync engine against a fake server, property tests | 98% |
| `packages/state/src/*.test.ts` | commands, the toolbar registry, selection, undo, pads, sort, lists, sync wiring, the remote, the log | 96% |
| `apps/web/src/**/*.test.tsx` | the app in jsdom: editing, keys, toolbar, pads, Fresh start, Sort, top bar, clipboard | 76% |
| `apps/web/e2e` | drag and swipe with real pointer and touch input | not counted |

Tests sit next to the file they test. State and web tests start from `resetStore('A\n  B')` and assert the whole pad as one string with `shape()`. The phone app has no tests of its own: its logic is in the packages, and the screens are checked on a device.

Not covered by unit tests: pointer drag (`useDrag.ts`, covered by Playwright), the IndexedDB and SQLite stores, sign-in, and every phone screen.
