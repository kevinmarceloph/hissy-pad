# Where everything is

A map of the HissyPad code: what each folder and file holds, how an edit travels through it, and where to put the next thing. The design and its history are in [PLAN.md](../PLAN.md); run commands and keys are in [README.md](../README.md).

## The shape

Three layers, each only knowing the one below it.

```
apps/web, apps/mobile   draw the pad, catch keys, pointers and gestures
packages/ui             screens both apps draw from one source (React Native): Hours
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
| `types.ts` | `NodeRow` (one row of the `nodes` table), `normalizeRow` for rows from an older build, `ROW_KEYS` and `sameRow`, `kindOf` (plain, numbered, header, divider) |
| `tree.ts` | the tree derived from `parentId` + `rank`: `buildIndex`, `childrenOf`, `flatten`, `descendantIds`, `topmost`, list numbers (`listNumbers` for a view, `homeNumbers` for a line's number where it lives, used by an open hour), and the counting rule (`isBlank`, `countLines`: a blank line is never counted) |
| `rank.ts` | fractional ranks: a rank between two others, re-ranking a run |
| `ops.ts` | every edit to lines: insert, split, set text, done, the three states (open, doing, done: `setState`, `sharedState`), kind (`setKind`: a section divider's sub items come out beside it, and nothing is moved or indented under one), fold, remove, restore, move, move to top, indent, dedent, ungroup, split off open (`splitOpen`: a copy below takes the open sub items), merge, delete done |
| `inline.ts` | inline marks drawn from the text, never stored: `inlineSpans` (bold, italic, underline, strikethrough, highlight, code, backslash escapes, symbols kept) and the shared `URL_RE` |
| `pads.ts` | several pads in one table: the scoped view (`scopePad`), the same view under any one line (`scopeNode`), create, reorder (`movePad`), move lines across, line to pad, pad to line, the open lines and count of a pad (`padLines`, `padCounts`), sub-pads and places (`isSubPad`, `listSubPads`, `Place`, `moveToPlace`), a pad's category for the lines moved into it (`inheritPadCategory`), the fixed tabs (`FIXED_PADS`: Today and Later are pad rows, `findFixedPad`; Inbox is the root; `settleFixedPads` keeps them so), Fresh start |
| `pins.ts` | pinned lines: the two rules (only a pad's top-level line is pinned, pins rank first) and `settlePins` that keeps them over the table, the Pin action (`togglePinned`), where the rule under the pins goes (`pinDivider`). The ops in `ops.ts` that place lines (move to top, up and down, dedent, a new line at the top, Return beside a pin) know the divider through `lastPinned` |
| `drop.ts` | `resolveDrop`: where a dragged line lands, from pointer position and row layout |
| `paste.ts` | text to outline and back: `parseOutline`, `insertOutline`, `toOutline`, `toOutlineHtml` |
| `ops.ts` (again) | `setCategory`: a line's category, one of Hours' (`NodeRow.category`) |
| `slot.ts` | a line in an hour of a day: the slot's key (`slotKey`, `parseSlot`), the count of done and open lines per slot (`slotCounts`), the lines crossed out during each hour that were not put in it (`slotDoneElsewhere`, `slotDoneExtra`), the lines of one slot in the hour's order (`lineOrder`: by pad, then down the pad), the hour's own lines and what its row counts (`slotTops`, `slotProgress`), an hour as a view of the store and the way back (`scopeSlot`, `unscopeSlot`), how a slot reads in the pad (`slotLabel`), whether its hours are over (`slotPast`) |
| `hourprefix.ts` | an hour typed in front of a line ("3pm ", "10-11pm ") read into a slot of Hours' day and taken off the text (`hourPrefix`, `slotByPrefix`) |
| `hours/` | the Hours mode's logic, from Oras-oras, exported as `@hissypad/core/hours`: `day.ts` (days, hour slots, the day start), `entry.ts` (an hour's plan and deed, `applyPatch`, `toggleDone`), `categories.ts`, `flags.ts`, `recurring.ts`, `chime.ts`, `summary.ts`, `store.ts` (the store interfaces, `HoursBackend`, `HoursStore`, the synced `Setting` rows) |
| `boomerang.ts` | Boomerang: a line out of the pads until a day (`due`), kept under Later: send (`boomerang`), back by hand (`comeBack`), what Later shows as rows in groups by day (`settleBoomerangs` keeps the groups, `dueHeads` places the day headings, `boomerangGroups` lists them), the delivery when a day starts (`deliverDue`, stamped with that moment), the dot (`fresh`, `clearFresh`), a day in words (`dueLabel`); `keepGroups` is the ordering it shares with `schedule.ts` |
| `schedule.ts` | Today's Scheduled section: its top-level lines with an hour sit under the pad's own, in the order of their hours (`settleSchedule`, by rank, run by the store's `commit` and `settleFixed`; `scheduledKey`), where the heading goes (`scheduleHead`), `isTodayPad` |
| `clock.ts` | the monotonic clock every edit stamps `updated_at` with, and `newUuid` |
| `look.ts` | the sizes a line of text is drawn in, for the web's pad, the phone's pad and the shared screens: type 17, a line of 25.5px on the web and 26pt on a phone; and the paper, inks and accent, light and dark (`PAPER_LIGHT`, `PAPER_DARK`) |
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
| `store.ts` | the state (`all` rows, the scoped `rows` of the pad shown, `padId`, `zoomId`: one line shown as a pad, `slotId`: one hour shown as a pad (`openSlot`, `closeSlot`), selection, editing, undo stacks), `apply` and `applyAll` (each edit runs `settlePins` and `inheritPadCategory` on the rows it placed, in the same undo step), Sort's own pad (`setSortMode`: the store swaps `padId` in and out of Sort), loading, `openPad`, `zoomTo`, `setAll`, `importOutline` |
| `history.ts` | `undo` and `redo` |
| `selection.ts` | selecting and editing: `select`, `clickSelect`, `selectRange`, `paintSelect` (a swipe down the bullets), `selectWithSibling` (Shift+Up/Down off a line being edited), `stepSelection`, `edit`, `targets`, `neighbor` |
| `commands.ts` | the editor commands (`cmd…`): what a key or button does to lines, and where the caret or selection goes after |
| `actions.ts` | the line toolbar as data: `LINE_ACTIONS` (each with its icon, `offered` for the ones that belong only in an open hour or only outside one: the toolbars draw `lineActions(can)`, `more` for the ones in the dropdown, `floats` for the ones drawn as floating buttons), `actionFace` (Fold reads Unfold), `LINE_KINDS`, `lineAbilities`. Web and the phone both draw from it |
| `pads.ts` | pad commands: new, rename, delete, reorder, a pad's category (`cmdSetPadCategory`), move to, make pad from a line, fold a pad back into a line, the list of places (`placeList`: pads and "Pad → Sub-pad"), move to a place, jump to a sub-pad, Fresh start; `padList` puts Today, Inbox (the root) and Later first (the store's `settleFixed` keeps Today and Later there and folds a pad named Inbox into the root; tested in `fixed.test.ts`) |
| `lists.ts` | the Recently done panel: entries, un-done; day grouping and a row's pad for the other lists |
| `archive.ts` | the Archive screen: every archived line, newest archive first, with its depth, its number and the pad it was in (`archiveLines`, `sourcePad`), the screen's own selection (`archiveTap`, `archiveCovered`), and `cmdUnarchive` (each line to the top of its pad, with what was archived under it; a pad back as a tab) |
| `search.ts` | Search across every pad: the lines found, grouped by pad with the words marked (`search`), archived lines last in a group of their own when asked, and the jump to a live one (`cmdOpenHit`); an archived hit is opened on the Archive screen by each app |
| `create.ts` | a new item on its card: make the line at the top of a place and zoom into it, set its text, move it to another place, and close the card keeping it or taking it all back |
| `sort.ts` | Sort: the pad being sorted whatever the zoom (`sortRows`), the queue, the two targets (each picked from a cog beside its button), sending a card, the card's Move to… (`cmdSortMoveTo`), the session a sort screen holds, the swipe rule |
| `shake.ts` | shake detection from accelerometer samples |
| `widget.ts` | the home-screen widgets' data: the snapshot they draw from (every pad's lines with their state, each coming hour's lines), applying the buttons pressed on them, adding a line to a pad |
| `watch.ts` | when the phone should hand the Apple Watch a sign-in, and how long to wait before trying again |
| `sync.ts` | wires the engine to the store and to Supabase auth; `refresh`, `forceSync`, the status line (`syncLine`) |
| `remote.ts` | the `Remote` the engine talks to, over Supabase |
| `log.ts` | the debug log (`?debug=1`) |
| `prefs.ts` | per-device preferences, not synced (empty now; it hands over the pad counts a device hid before they synced, `takeLegacyHiddenCounts`): `usePrefs`; each app hands in its storage with `initPrefs` |
| `hours/` | the Hours mode's state, exported as `@hissypad/state/hours`: `index.ts` (opens the store, wires the stores, starts and stops hours sync, `configureHoursBackend`, `configureChimes`), the day, category, flag, recurring plan and chime stores, `engine.ts` and `remote.ts` (sync for the four hours tables and `hour_settings`), `followSettings` and `adoptDeviceSettings` in `index.ts` (settings from another device take effect; settings kept on the device before they synced become rows), `slots.ts` (lines in an hour: assign, cross out, take out, add, find one to put in, the picker's opener), `line-categories.ts` (a line's category: the list the pad draws icons from, a category's emoji in front of a line (the classifier the store runs, and the once-per-device pass), `categoryPrefix`, `useLineCategory`, set it, the picker's opener) |
| `boomerang.ts` | Boomerang's commands (`cmdBoomerang`, `cmdComeBack`, `cmdClearFresh`), the day picker's opener and answer, the picker's quick days (`boomerangChoices`), and the delivery (`deliverBoomerangs`: after load and each merge through the store's `setAfterSettle`, on refresh, and by a timer for the next day start with something due) |
| `sample.ts` | the welcome pad a new device starts with |
| `testing.ts` | `resetStore(outline)` for tests here and in the apps (the outline lands in the Inbox, the root), and `tableShape()`: the whole table as one outline, Inbox first, then each pad as `@Name`, an empty Today or Later left out |

## packages/ui

Screens written once in React Native. The phone draws them natively; the web app draws them through react-native-web (an alias in its Vite config). Only what needs nothing from the DOM belongs here.

| file | what is in it |
|---|---|
| `src/hours/HoursApp.tsx` | the Hours mode, whole: opens the stores, switches between the day and the three list screens |
| `src/hours/DayScreen.tsx` | the day: a one-line header (earlier, the day, the calendar, later, the menu), the 24-cell strip pinned under it, the hour rows (padded so the current hour opens at the top), and the panels over them: the calendar (`DayPicker`), the menu (the lists, Settings, the sync line) and Settings (day start, chimes) |
| `src/hours/HourRow.tsx` | one hour: its row (box, words, the lines' count, flag marks) and its editor |
| `src/hours/HostedLines.tsx` | an open hour drawn by the host's own pad editor: `LinesContext` (the `renderLines` prop of `HoursApp`), opening and closing the store's view of the hour, the hour's archived lines under an "Archived" heading, each with Unarchive. Both apps use it: the web hands in `<Pad embedded />`, the phone `SubRows` |
| `src/hours/SlotAdder.tsx` | the field under an open hour's lines: add a line to the top of Today, or find one in any pad and put it in the hour |
| `src/hours/StateMark.tsx` | the three bullets (open, doing, done) for a line and for an hour, and the switch that sets one |
| `src/hours/drawn.ts` | `drawHours`: each hour of a day as a screen draws it (recurring plan, top line, count, its box in a strip with its category's icon, which `Mark` draws where the box is wide enough: `iconSize`), for the day screen and the hour picker |
| `src/hours/SlotPicker.tsx` | the hour picker the pad's toolbar opens: the day on one line (earlier, the day, a calendar, later: `DayPicker` from `DayScreen.tsx`) over the strip of hours |
| `src/hours/BoomerangPicker.tsx` | the day picker the pad's floating Boomerang button opens: a few days one tap away over the calendar (`DayPicker` with `from`: no day up to today) |
| `src/hours/CategoryPicker.tsx` | the category picker the pad's toolbar opens ("Category…"), with "New category" in place (the form is `NewCategory` from `CategoriesScreen.tsx`) |
| `src/hours/CategoriesScreen.tsx`, `FlagsScreen.tsx`, `RecurringScreen.tsx` | the user's own lists; categories open from the app's top menu through `CategoriesApp` (`HoursApp.tsx`), flags and plans from Hours' menu |
| `src/hours/provider.tsx` | the stores as React context, and `useSync` (signed in or not, the sync line) |
| `src/hours/theme.ts` | paper and ink tokens with the 12 label colors searched for a deuteranope; `SchemeContext` lets the host force light or dark |
| `src/hours/palette.ts` | the 12 label colors' values per scheme and `inkOn` (black or white text on one), with no React Native: the web pad imports it as `@hissypad/ui/palette` |
| `src/hours/CategoryBadge.tsx` | a category as its icon in a squircle of its color (its name in a pill where it has no icon): the picker, the Categories screen and the phone's row prefix |
| `src/hours/Mark.tsx`, `FlagMark.tsx`, `DayStrip.tsx`, `Tap.tsx`, `MoveButtons.tsx`, `ColorField.tsx`, `FlagOptions.tsx`, `PullRefresh.tsx` | the parts |
| `src/testing/` | `rntl.ts` (the tests' events over React Testing Library), `setup.ts` |

## apps/web

Vite, React 19, a PWA. `src/main.tsx` wires the platform (IndexedDB, clipboard, sync wake-ups) into the state package and mounts the app. `src/styles.css` is all the CSS, with the look's dials in its header.

| folder | what is in it |
|---|---|
| `src/app/` | the shell: `App.tsx` (which view is open: pad, Fresh start, Sort, Hours or the Archive), `icons.tsx` (every icon as SVG: the top bar's and the line toolbar's `LineIcon`), `TopBar.tsx` (the mode switcher, the + for a new item, Search, the menu with Done, Archive, Log, Fresh start and the theme, the pad tabs, "Archive N completed"), `Account.tsx` (the footer), `PullToRefresh.tsx`, `toast.ts` |
| `src/pad/` | the editor: `Pad.tsx` (the list and the selection-mode keys), `Row.tsx` (one line and its keys while editing), `SelectionBar.tsx` (the toolbar: icons, the ⋯ menu, and floating above its right end Hour…, Category…, Boomerang…, the Move to… menu, the open / doing / done switch and "done editing"; at phone width two rows that do not scroll), `CatMark.tsx` (a pad's or sub-pad's category in a menu), `useDrag.ts` (pointer drag, of rows and of the floating +, never while editing; a touch swipe down the bullets selecting; scrolling while held at an edge), `categoryColors.ts` (the label palette as `.cat-<key>` CSS variables for the category badge before a line). The floating + itself is in `Pad.tsx`. `Boomerangs.tsx`: the day heading before each group of lines out on a boomerang in Later (`DueHead`) and the Scheduled heading in Today (`ScheduledHead`); the lines themselves are the pad's rows |
| `src/pads/` | `PadTabs.tsx` (tabs, the jump-to-any-pad list at their right end, the pad sheet) and `FreshStart.tsx` |
| `src/panels/` | `Lists.tsx` (Recently done), `Archive.tsx` (the Archive screen, `#archive`: archived lines drawn with the pad's row styles, a chip for the pad each was in, click to select, Unarchive), `Search.tsx` (Cmd+K, the top bar's Search, a text toggle for archived lines; an archived hit opens the Archive at it), `Sort.tsx`, `Create.tsx` (the new item's card: Sort's card in a dialog over the page, with the pad's rows and toolbar for its sub items) and `Hours.tsx` (mounts the shared Hours screens, loaded on first use; the hour picker's and the boomerang day picker's dialogs; the page's light or dark scheme) |
| `src/platform/` | what only a browser has: `idb.ts` (LocalStore on IndexedDB), `clipboard.ts`, `supabase.ts`, `os.ts` (Mac or not, shortcut hints), `chimes.ts` (Hours' chimes in a browser: a timer, a sound, a notification) |
| `e2e/` | Playwright with real pointers and touches: `divider.spec.ts` (a section divider is centered, holds nothing, and the line under it does not indent), `drag.spec.ts`, `sort.spec.ts`, `toolbar.spec.ts` (the Move to… menu is really on screen; at phone width the bar does not scroll and the floating buttons work), `boomerang.spec.ts` (the floating buttons all fit, a line goes out and Later lists it) |
| `test/setup.ts` | jsdom gaps filled in (dialogs) |

## apps/mobile

Expo. `App.tsx` mounts the pad; `src/setup.ts` wires the platform (SQLite, clipboard, AsyncStorage) into the state package.

| file | what is in it |
|---|---|
| `src/ui/Pad.tsx` | the screen: top bar (mode switcher, the + for a new item, Search, the menu), pad chips, "Archive N completed", then the pad's list (long-press drag, pull to sync: the web's line of words on iOS, the platform spinner on Android), Sort or Hours by mode |
| `src/ui/TopIcons.tsx` | the top bar's icons (the + included), drawn with Views (no icon font, no SVG module), and the Pad, Hours, Sort switcher |
| `src/ui/Menu.tsx` | `menu()` (a list of choices, Alert.alert's arguments) and `askText()` (a line of text): the system's alert and prompt on iOS, a sheet of our own on Android drawn by `MenuHost` at the root |
| `src/ui/LineIcons.tsx` | the line toolbar's icons, drawn with Views: the same set as the web's `icons.tsx`, change both together |
| `src/ui/Row.tsx` | one line |
| `src/ui/Toolbar.tsx` | the line toolbar above the keyboard, drawn from `LINE_ACTIONS` as two rows (no sideways scroll); the three dots the actions marked `more` |
| `src/ui/FloatingButtons.tsx` | the round buttons at the bottom right: + when nothing is targeted (tap for a line at the top, drag it onto the pad for a line where it is dropped; the drag itself is `addDrag` in `Pad.tsx`); while editing or selecting, Hour…, Category… and Boomerang… (the actions marked `floats`), Move to… (the tray icon: the pads to move to), a switch of three sides, each a button for its state (• open, a dot in a ring for doing, × crossed out) and a chevron (done editing) |
| `src/ui/Boomerangs.tsx` | Later's section of what is out on a boomerang, by day, with Day… and Back now |
| `src/ui/PadChips.tsx` | the pads as chips, with rename, reorder and delete |
| `src/ui/Lists.tsx` | the Recently done sheet |
| `src/ui/Archive.tsx` | the Archive screen (no mode lit in the switcher): archived lines as the pad draws them, a chip for the pad each was in, tap to select, Unarchive |
| `src/ui/Search.tsx` | the Search sheet, with the same archived-lines toggle |
| `src/ui/Sort.tsx` | the Sort screen (PanResponder swipe); the card's sub items are `SubRows` |
| `src/ui/SubRows.tsx` | the sub items of one line as the pad's own rows, while the store is zoomed into it: Sort's card and the new item's sheet |
| `src/ui/Create.tsx` | the new item's sheet: Sort's card with the place, the hour and the pad icon, and the pad's rows, toolbar and floating buttons for its sub items. The top bar's + opens it, and so do the widget's + and the Add control (`openCreate`) |
| `src/keyboard.ts` | the keyboard's height, for a toolbar that sits right above it |
| `src/ui/Account.tsx` | sign in and the sync line |
| `src/chimes.ts` | Hours' chimes on the phone: local notifications with a text reply (needs a build with `expo-notifications`) |
| `src/shake.ts` | shake to undo (needs a build with `expo-sensors`) |
| `src/local/sqlite.ts` | LocalStore on expo-sqlite, one transaction at a time; adds new columns on open; also the Hours rows (`hours_rows`, JSON) |
| `src/theme.ts` | the paper and ink tokens |
| `src/widget.ts` | the app's end of the widget: writes the snapshot, applies queued presses, handles the widget's links; also signs the watch in and out (`signInWatch`, `signOutWatch`) |
| `targets/widget/` | the iOS widget itself, in Swift (WidgetKit + App Intents): `Shared.swift` (the shared storage and the queue), `Intents.swift` (the pad setting, the send buttons, the bullet's tap), `InboxWidget.swift` (the Inbox widget, the Add control, the bundle), `TodayWidget.swift` (the Today list), `HourWidget.swift` (the Current hour, and the line behind its bullet that Today draws too), `AddControlIntent.swift` (what the Add control runs; also compiled into the app), `expo-target.config.js` (target settings and colors) |
| `targets/watch/` | the Apple Watch app (SwiftUI), which syncs by itself: `Rows.swift` (its copy of the rows, which lines are open in which pad, the merge, a new line and its rank), `Remote.swift` (Supabase over plain HTTPS: session, fetch, cross out, add a line), `PadSync.swift` (sign in, send, fetch, one round at a time), `WatchStore.swift` (what is shown, the file and the keychain, the phone's messages), `HissyPadWatchApp.swift` (pad list and pad screens); `WatchShortcuts.swift` (the watch's own Siri command, "HissyPad inbox": Siri on a watch does not know the phone app's) |
| `targets/_shared/Models.swift` | the JSON shapes (snapshot, pad, item, queued action), compiled into the app, the widget and the watch |
| `native/AppShortcuts.swift` | the Siri / Shortcuts command "Add to Inbox" and the phrases Siri takes for it ("HissyPad inbox" first; an App Intent). Compiled into the app, not the widget |
| `native/SiriSync.swift` | what sends that line to the server from Siri itself: a session of its own in the keychain (the app hands it a sign-in, as it does the watch), a post through the watch's `Remote.swift`, eight seconds at most, the queue when it cannot |
| `native/WatchBridge.swift` | the phone's end of the watch app: passes it the sign-in, notes which account it is on; for a watch with no account, sends the snapshot and queues the lines crossed out or typed on it |
| `plugins/withNativeSources.js` | config plugin: compiles `native/*.swift`, the widget's `Shared.swift` and `AddControlIntent.swift` and the watch's `Remote.swift` and `Rows.swift` into the app target, and starts the watch bridge and Siri's sync from the AppDelegate |
| `plugins/withNoShakeToEdit.js` | config plugin: turns off iOS's own shake prompt |

### The widget and the app

The widget runs in its own process and cannot run any of the JavaScript. The two share an App Group (`group.ph.marcelo.hissypad`) and pass two JSON strings through its UserDefaults:

- `widget.snapshot`: every pad with its top-level lines, each with its state (open, doing, done: a crossed-out line stays listed, and the watch and the Inbox widget's top line take the open ones), and `hours`: each hour from this one on, a week ahead, that has lines put in it, by slot key, with those lines, what is under them (`depth`) and the first line's category as a name and two hex colors. The Current hour widget picks the hour the clock is in and has a timeline entry for the start of each of the next 24, since the app cannot run when the hour turns. The app writes it when the pads or the categories change and tells the widget to redraw. A button on the widget edits it in place, so the widget redraws at once.
- `widget.actions`: what happened outside the app since it was last in front: buttons pressed on the widget (a send, or `{dir: 'state'}` from a bullet, which moves a line on through open, doing and done where it is), and lines added through Siri that Siri could not send itself (which carry the id they were given, so the widget can show the line and act on it before the app has run). The app applies them (`cmdWidgetActions`) and clears the list when it comes to the front. So a press reaches the pad, and sync, only when the app next opens. A Siri add goes to the server at once (`native/SiriSync.swift`) and is taken back out of this list; the app gets the line with its next sync.
- `siri.state`, `siri.handoff`: the account Siri's sender is signed in to, and a sign-in (or `signout`) the app leaves for it. The same pair the watch has (`watch.state`, `watch.handoff`), by the same rule (`state/watch.ts`).

- `widget.open`: a link the Add control leaves for the app to follow as it opens (`add?pad=inbox`). The app clears it.

A widget cannot take typing, so its + opens the app at `hissypad://add?pad=…` on the new item's sheet (`ui/Create.tsx`), set to that pad. The Add control (iOS 18+) does the same through `widget.open`, since a control's intent opens the app and runs inside it. The shapes are defined once in `packages/state/src/widget.ts` and mirrored by the Codable structs in `targets/_shared/Models.swift`: change both together.

### The watch

The watch is a sync client of its own, like the web app and the phone, in Swift. Signed in, it keeps every row in a file, fetches what changed straight from PostgREST (`synced_at` past its cursor, the newer `updated_at` wins) and crosses a line out with a three-column `PATCH` (`done`, `done_at`, `updated_at`), which the server's last-write-wins trigger judges like any other write. It does this on its own network, with the phone nowhere near; with no network, a Done is held in the file and sent on the next sync. A line typed on the watch ("New line" at the top of a pad) is a plain insert of a new row at the top of that pad, held and sent the same way, before any Done. `Rows.swift` repeats four rules from the packages (the tree in `core/tree.ts`, the open lines and the counting rule in `core/pads.ts` and `core/tree.ts`, the merge in `core/sync/engine.ts`, a rank above the first line in `core/rank.ts`): change them together.

It cannot share the phone's session (a refresh token works once) and it has no keyboard for an email, so the phone signs it in:

1. The watch tells the phone which account it is on, `{user}` with `""` for none, as its WatchConnectivity application context. `WatchBridge.swift` keeps that under `watch.state` in the App Group.
2. The app sees it is not its own account (`watchHandoffDue` in `state/watch.ts`, checked when the app comes to the front and every few seconds while it is there) and asks the `watch-token` Edge Function for a one-time sign-in token for the same account.
3. It leaves `{url, key, token, user}` under `watch.handoff`; the bridge sends it to the watch and takes it out.
4. The watch trades the token for a session of its own at `/auth/v1/verify` and keeps it in its keychain.

Signing out on the phone leaves `signout` under `watch.handoff`, and the watch forgets the account and its lines.

A watch whose phone app is not signed in has no server to talk to. It falls back to what it did before: the bridge sends it the widget snapshot over WatchConnectivity, and a line crossed out comes back as `{id, dir: "done"}`, a line typed as `{id, dir: "add", pad, text}`, which the bridge puts in the widget queue.

## supabase

`migrations/` (one file per schema change), `tests/nodes.test.sql` (pgTAP: row-level security and last-write-wins) and one test file per hours table, `config.toml` (local stack on ports 54421-54429), `functions/watch-token/` (the Edge Function that gives a signed-in caller a one-time sign-in token for their own account, for the watch; `supabase functions serve` runs it locally, `supabase functions deploy watch-token` puts it on the hosted project).

## Adding things

**A toolbar action.** Write the command in `packages/state/src/commands.ts` (or `pads.ts` if it is about pads). Add one entry to `LINE_ACTIONS` in `actions.ts`: id, group, label, name, hint, `run`, `enabled` if it can be impossible, an `icon` (add it to `LineIcon` in `actions.ts`, then draw it twice: `apps/web/src/app/icons.tsx` and `apps/mobile/src/ui/LineIcons.tsx`), `flip` if it reads as its opposite for some targets, and `more: true` if it is rare enough to sit in the ⋯ dropdown. It appears on web and the phone. If "can it run" needs a new fact about the selection, add a field to `LineAbilities`. Test it in `actions.test.ts`.

**A new edit to lines.** A pure function in `packages/core/src/ops.ts` (rows in, rows out, `ctx.now()` on every row it changes), exported from `index.ts`, tested in `ops.test.ts` with `pad()` and `shape()`. Then a `cmd…` in state that calls it through `apply`. Anything that moves rows between pads goes through `applyAll` and lives in `pads.ts`.

**A keyboard shortcut (web).** While editing a line: `onKeyDown` in `apps/web/src/pad/Row.tsx`. With lines selected: the window handler in `apps/web/src/pad/Pad.tsx`. Both call the same command. Add it to the keys table in the README, to the action's `keys` if it has a button, and to `Keys.test.tsx`.

**Something that edits the lines under one line.** Zoom the store into it (`zoomTo(id)`, `zoomTo(null)` to leave) and draw the pad's rows and toolbar: every command then works on that subtree only. Write to the line itself through `applyAll`, since it is outside the view. See `state/create.ts`.

**A top-bar panel or view.** A panel is a `<dialog>` opened from `TopBar.tsx` (see `Lists.tsx`). A view that replaces the pad adds a value to the `view` state in `App.tsx` and, if it is a mode, an icon to `MODES` in `TopBar.tsx` and in the phone's `TopIcons.tsx` (see `Sort.tsx`). What is looked at now and then goes in the menu, not on the bar. Its data and commands go in a file of their own in `packages/state/src`, so the phone can draw the same thing from `apps/mobile/src/ui`.

**Something in Hours.** A rule about hours, categories, flags or plans: `core/src/hours`. A new synced column there goes in four places: the type in `core/src/hours`, the wire mapping in `state/src/hours/remote.ts`, a migration with a pgTAP case, and nothing on the device (rows are stored as JSON). A screen change: `packages/ui/src/hours`, once, for both apps.

**A column on a row.** In this order:
1. `NodeRow`, `normalizeRow` and `ROW_FIELDS` in `core/types.ts` (the compiler refuses a `NodeRow` field that is missing from `ROW_FIELDS`).
2. `WireNode`, `toWire` and `fromWire` in `core/sync/wire.ts`, optional on the wire.
3. A new file in `supabase/migrations/` and a pgTAP case in `supabase/tests/`. The hosted project needs `supabase db push`.
4. `apps/mobile/src/local/sqlite.ts`: the `Row` type, `toRow`, the `create table`, an `alter table` for databases made before it, and the upsert.
5. `rowBrief` in `state/log.ts` if the log should show it.
6. If the watch should read it: `WireRow` (and its `columns`) and `Row` in `apps/mobile/targets/watch/Rows.swift`. The watch only ever writes `done`, `done_at` and `updated_at` on a row it did not make, so a column it does not know is safe from it; a row it makes gets the column's default.
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
| `packages/state/src/*.test.ts` | commands, the toolbar registry, selection, undo, pads, sort, search, lists, the archive, sync wiring, the remote, the log | 96% |
| `apps/web/src/**/*.test.tsx` | the app in jsdom: editing, keys, toolbar, pads, Fresh start, Sort, Search, the Archive, top bar, clipboard | 76% |
| `packages/ui/src/**/*.test.tsx` | the Hours screens in jsdom through react-native-web: the day, the lists, lines in an hour, the hour picker, the palette's contrast numbers | not measured |
| `apps/web/e2e` | drag and swipe with real pointer and touch input | not counted |

Tests sit next to the file they test. State and web tests start from `resetStore('A\n  B')` and assert the whole pad as one string with `shape()`. The phone app has no tests of its own: its logic is in the packages, and the screens are checked on a device.

Not covered by unit tests: pointer drag (`useDrag.ts`, covered by Playwright), the IndexedDB and SQLite stores, sign-in, and every phone screen.
