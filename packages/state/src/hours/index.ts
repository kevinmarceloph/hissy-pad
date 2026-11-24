// The Hours mode's state, wired: the local store over a platform backend, the day,
// category, flag, recurring plan and chime stores, and sync for the hours tables and settings.
// Imported as '@hissypad/state/hours'. The screens are in packages/ui.
//
// Sync here is a second engine beside the pad's (state/sync.ts): the same push, pull and
// last-write-wins, over the four hours tables and the settings, with a millisecond `updated_at` as Oras-oras has it.
// The pad's `bindAuth` starts and stops both.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  applyPatch, cleanDayStart, createMemoryBackend, formatChimes, HoursStore, parseChimes,
  type Category, type ChimeOutcome, type ColorKey, type DayKey, type HoursBackend,
} from '@hissypad/core/hours';

import { createCategoryStore, type CategoriesStore } from './category-store';
import { createChimeStore, createStaticChimeStore, type ChimeStore } from './chime-store';
import { createDayStore, type DayStore } from './day-store';
import { createSyncEngine, cursorKey, type Remote, type SyncEngine, type SyncStatus } from './engine';
import { createFlagStore, type FlagsStore } from './flag-store';
import { createRecurringStore, type RecurringPlansStore } from './recurring-store';
import { createSupabaseRemote } from './remote';
import { adoptLineCategories } from './line-categories';

export * from './category-store';
export * from './chime-store';
export * from './day-store';
export * from './flag-store';
export * from './recurring-store';
export * from './slots';
export * from './line-categories';
export { syncLine as hoursSyncLine, type SyncStatus as HoursSyncStatus } from './engine';

// ---- what a platform provides ---------------------------------------------------------

let backend: HoursBackend = createMemoryBackend();
export function configureHoursBackend(b: HoursBackend) {
  backend = b;
}

// How this device rings. Web: a timer in the page, a sound and a notification. Phone:
// local notifications the operating system keeps, with a text reply.
export interface ChimePlatform {
  // Schedules or starts ringing. Called inside the press that asked; may ask for permission.
  apply(minutes: number[]): Promise<ChimeOutcome>;
  // The same without asking for anything: what a saved setting gets when the app opens.
  resume(minutes: number[]): ChimeOutcome;
  // True where a chime only rings while the page is open (a browser).
  needsPageOpen: boolean;
  // Plays the chime now, where the platform has a sound of its own.
  sound: (() => void) | null;
  // Calls back with the slot and the words of a reply typed into a chime.
  listenForReplies?(onReply: (day: DayKey, hour: number, note: string) => void): () => void;
}

let chimePlatform: ChimePlatform | null = null;
export function configureChimes(p: ChimePlatform | null) {
  chimePlatform = p;
}
export function getChimePlatform(): ChimePlatform | null {
  return chimePlatform;
}

// ---- the stores -------------------------------------------------------------------------

// Settings that follow the account: a row each in hour_settings. Until 2026-11-24 they were
// kept on the device only, in meta under the same keys.
const DAY_START_KEY = 'day.start';
const CHIMES_KEY = 'chime.minutes';
const USER_KEY = 'sync.user';

export type HoursSyncStore = StoreApi<{ status: SyncStatus | null }>;

export interface HoursStores {
  store: HoursStore;
  day: DayStore;
  categories: CategoriesStore;
  flags: FlagsStore;
  recurring: RecurringPlansStore;
  chimes: ChimeStore;
  sync: HoursSyncStore;
}

const syncStore: HoursSyncStore = createStore(() => ({ status: null as SyncStatus | null }));

let opened: Promise<HoursStores> | null = null;
// The same stores once they are open, for a screen that draws before it can wait.
let ready: HoursStores | null = null;
export function hoursIfOpen(): HoursStores | null {
  return ready;
}
let engine: SyncEngine | null = null;
// Who is signed in, kept so sync can start once the store is open (or at once if it is).
let signedIn: { remote: Remote; userId: string } | null = null;

// Opens the local rows and reads the lists and this device's settings. One store per run:
// every caller gets the same promise.
export function openHours(): Promise<HoursStores> {
  return (opened ??= (async () => {
    const store = new HoursStore(backend, () => engine?.requestSync());
    await store.open();
    await adoptDeviceSettings(store);
    const day = createDayStore(store, undefined, {
      saveStart: (start) => store.putSetting(DAY_START_KEY, String(start), Date.now()),
    });
    const categories = createCategoryStore(store);
    const flags = createFlagStore(store);
    const recurring = createRecurringStore(store);
    const platform = chimePlatform;
    const chimes = platform
      ? createChimeStore({
          apply: platform.apply,
          resume: platform.resume,
          save: (minutes) => store.putSetting(CHIMES_KEY, formatChimes(minutes), Date.now()),
        })
      : createStaticChimeStore();
    await Promise.all([categories.getState().load(), flags.getState().load(), recurring.getState().load()]);
    // The pad draws a line's category as its icon, so it follows the list wherever it changes.
    adoptLineCategories(categories.getState().list);
    categories.subscribe((s, before) => {
      if (s.list !== before.list) adoptLineCategories(s.list);
    });
    // The day on the screen depends on the day start, so it is read before anything draws.
    day.getState().adoptStart(cleanDayStart(store.getSetting(DAY_START_KEY)));
    chimes.getState().adopt(parseChimes(store.getSetting(CHIMES_KEY)));
    // A reply typed into a chime's notification lands in its hour, then the open day refreshes.
    platform?.listenForReplies?.((slotDay, hour, note) => {
      void (async () => {
        const before = (await store.listDay(slotDay)).find((e) => e.hour === hour);
        await store.put(applyPatch(before, slotDay, hour, { note }, Date.now()));
        await day.getState().refresh();
      })();
    });
    const stores: HoursStores = { store, day, categories, flags, recurring, chimes, sync: syncStore };
    ready = stores;
    if (signedIn) await startEngine(stores, signedIn.remote, signedIn.userId);
    return stores;
  })());
}

// A category made from the pad's category picker, in place: the same as adding one on the
// categories screen. Null when it could not be saved.
export async function cmdAddCategory(label: string, icon: string, color: ColorKey): Promise<Category | null> {
  return (await openHours()).categories.getState().add(label, icon, color);
}

// ---- settings -----------------------------------------------------------------------------

// A device that kept its settings before they synced: each becomes a row stamped 0, so it
// reaches an account that has none yet and gives way to one set on any other device.
export async function adoptDeviceSettings(store: HoursStore) {
  for (const key of [DAY_START_KEY, CHIMES_KEY]) {
    const value = await store.sync.getMeta(key).catch(() => null);
    if (value === null) continue;
    if (store.getSetting(key) === null) await store.putSetting(key, value, 0);
    await store.sync.setMeta(key, null);
  }
}

// Settings pulled from another device take effect here: the day moves to the new start,
// and the chimes are taken up the way a saved setting is at open, with no permission prompt.
export function followSettings(stores: Pick<HoursStores, 'store' | 'day' | 'chimes'>) {
  const start = cleanDayStart(stores.store.getSetting(DAY_START_KEY));
  const day = stores.day.getState();
  if (start !== day.start) {
    day.adoptStart(start);
    void stores.day.getState().open(stores.day.getState().day);
  }
  const minutes = parseChimes(stores.store.getSetting(CHIMES_KEY));
  if (formatChimes(minutes) !== formatChimes(stores.chimes.getState().minutes)) stores.chimes.getState().adopt(minutes);
}

// ---- sync ---------------------------------------------------------------------------------

// This device's rows belong to whoever signs in. The first account gets them as they are
// (every row starts dirty). A different account later gets all of them again, and the
// cursors from the old account are dropped: they point into someone else's rows.
async function claimFor(stores: HoursStores, user: string) {
  const local = stores.store.sync;
  const last = await local.getMeta(USER_KEY);
  if (last === user) return;
  if (last !== null) {
    await local.entries.markAllDirty();
    await local.categories.markAllDirty();
    await local.flags.markAllDirty();
    await local.recurring.markAllDirty();
    await local.settings.markAllDirty();
    for (const table of ['entries', 'categories', 'flags', 'recurring', 'settings']) await local.setMeta(cursorKey(table), null);
  }
  await local.setMeta(USER_KEY, user);
}

async function startEngine(stores: HoursStores, remote: Remote, userId: string) {
  engine?.stop();
  engine = null;
  await claimFor(stores, userId);
  // Signed out, or signed in as someone else, while the claim was being written.
  if (signedIn?.userId !== userId) return;
  engine = createSyncEngine({
    local: stores.store.sync,
    remote,
    onPulled: () => {
      followSettings(stores);
      void stores.categories.getState().refresh();
      void stores.flags.getState().refresh();
      void stores.recurring.getState().refresh();
      void stores.day.getState().refresh();
    },
    onStatus: (status) => syncStore.setState({ status }),
  });
  syncStore.setState({ status: engine.status() });
  engine.start();
}

// A session exists: sync the hours tables for this user. `makeRemote` is for tests.
export function startHoursSync(client: SupabaseClient, userId: string, makeRemote: (c: SupabaseClient, u: string) => Remote = createSupabaseRemote) {
  if (signedIn?.userId === userId && engine) return;
  signedIn = { remote: makeRemote(client, userId), userId };
  // The rows are opened even if the Hours screen never is: a phone that only ever shows
  // the pad still pushes a reply typed into a chime.
  void openHours().then((stores) => {
    if (signedIn?.userId === userId && !engine) return startEngine(stores, signedIn.remote, userId);
  });
}

export function stopHoursSync() {
  signedIn = null;
  engine?.stop();
  engine = null;
  syncStore.setState({ status: null });
}

// Sync now and resolve when the round is done. Resolves at once when local-only.
export function refreshHours(): Promise<void> {
  return engine?.sync() ?? Promise.resolve();
}

// Tests: forget the opened store so the next openHours starts from the configured backend.
export function resetHours() {
  stopHoursSync();
  opened = null;
  ready = null;
}
