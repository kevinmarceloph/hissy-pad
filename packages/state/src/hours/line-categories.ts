// A line of the pad can carry one of Hours' categories (NodeRow.category, a category id);
// the pad draws it as the category's icon before the text. These are the commands the
// toolbar's "Category…" runs, and the category list the pad reads to draw the icons.
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { classifyByEmoji, iconMap, setCategory } from '@hissypad/core';
import { activeCategories, categoryName, type Category } from '@hissypad/core/hours';

import { applyAll, applyQuiet, getLocalStore, setClassifier, usePad } from '../store';
import { holdEditing, targets } from '../selection';
import { setCopyPrefix, setFieldPrefix } from '../commands';

// ---- the list the pad draws from ----------------------------------------------------------

// Every category by id, archived ones included: a line keeps the icon of a category that
// was archived after it was given. Filled once Hours' store is open (index.ts).
export const lineCategories = createStore(() => ({ list: [] as Category[], byId: {} as Record<string, Category> }));

export function adoptLineCategories(list: Category[]) {
  lineCategories.setState({ list, byId: Object.fromEntries(list.map((c) => [c.id, c])) });
  icons = iconMap(list);
  classifyExistingOnce();
}

// ---- an emoji in front of a line is its category -------------------------------------------

let icons = new Map<string, string>();
setClassifier((all, ctx, ids) => classifyByEmoji(all, ctx, ids, icons));

// And the other way: a copied line carries its category's emoji in front of its text, so
// pasting it back puts it in that category again. A category with no icon adds nothing,
// and neither does a line whose text already starts with the emoji.
setCopyPrefix((row) => {
  const icon = row.category ? lineCategories.getState().byId[row.category]?.icon : undefined;
  if (!icon) return '';
  const bare = (t: string) => t.replace(/\uFE0F/g, '');
  return bare(row.text).startsWith(bare(icon) + ' ') ? '' : `${icon} `;
});

// While a line is edited, its field shows the same icon or code in front (commands.ts,
// fieldPrefix), in a category's own pad and its view too, where the badge is hidden: that is
// where it can be deleted.
setFieldPrefix((row) => {
  const icon = row.category ? lineCategories.getState().byId[row.category]?.icon : undefined;
  return icon ? `${icon} ` : '';
});

// Once per device, the lines already in the table that start with a category's emoji go in
// that category too (Kevin, 2026-11-27). It waits for the pad to load and for at least one
// category with an icon (a fresh device gets them with its first sync), and is not an undo
// step. Two devices doing it make the same change, so the server keeps either.
export const EMOJI_DONE_KEY = 'emoji.classified';
let classifying = false;
export function classifyExistingOnce(): void {
  if (classifying || icons.size === 0) return;
  if (usePad.getState().load !== 'ready') {
    const off = usePad.subscribe((s) => {
      if (s.load !== 'ready') return;
      off();
      classifyExistingOnce();
    });
    return;
  }
  classifying = true;
  const store = getLocalStore();
  void store.getMeta(EMOJI_DONE_KEY).then((done) => {
    if (!done) {
      applyQuiet((all, ctx) => classifyByEmoji(all, ctx, Object.keys(all), icons), 'emoji:classify');
      void store.setMeta(EMOJI_DONE_KEY, '1').catch(() => {});
    }
  }).catch(() => {}).finally(() => { classifying = false; });
}
// For tests: forget that it ran.
export function resetEmojiClassify() {
  classifying = false;
}

// The category a line carries, or undefined while none (or not synced yet).
export function useLineCategory(id: string | null | undefined): Category | undefined {
  return useStore(lineCategories, (s) => (id ? s.byId[id] : undefined));
}

// What the picker offers: the active ones, in order.
export function useCategoryChoices(): Category[] {
  return activeCategories(useStore(lineCategories, (s) => s.list));
}

// A category's icon and a space, to put before a name in a list that can only hold text (a
// select's options, the phone's menus); '' for none, or one with no icon.
export function categoryPrefix(id: string | null | undefined): string {
  const c = id ? lineCategories.getState().byId[id] : undefined;
  return c?.icon ? `${c.icon} ` : '';
}

// ---- commands --------------------------------------------------------------------------------

// Give the selected lines (or the one being edited) a category, or take theirs away with
// null. Returns how many lines it was asked about.
export function cmdSetCategory(category: string | null, ids: readonly string[] = targets()): number {
  // The whole table: the line may not be in the view (a card shows only what is under its line).
  if (ids.length) applyAll((all, ctx) => setCategory(all, ctx, [...ids], category), { label: 'cmdSetCategory' });
  return ids.length;
}

// The category the targets share, null when they have none or differ.
export function targetCategory(ids: readonly string[] = targets()): string | null {
  const { all } = usePad.getState();
  const cats = new Set(ids.map((id) => all[id]?.category ?? null));
  return cats.size === 1 ? [...cats][0]! : null;
}

// Whether any of the targets has a category: "No category" is offered when one does, mixed
// or not (Kevin, 2026-11-27).
export function targetsHaveCategory(ids: readonly string[] = targets()): boolean {
  const { all } = usePad.getState();
  return ids.some((id) => (all[id]?.category ?? null) !== null);
}

// The picker is each app's (the shared CategoryPicker in packages/ui, in a dialog on web
// and a modal on the phone), opened the same way as the hour picker (slots.ts): the lines
// are taken when it opens, since it ends the edit as it takes focus.
let openPicker: ((ids: readonly string[]) => void) | null = null;
let picked: string[] = [];
export function setCategoryPickerOpener(open: ((ids: readonly string[]) => void) | null) {
  openPicker = open;
}
export function cmdPickCategory(ids: readonly string[] = targets()) {
  if (ids.length === 0 || !openPicker) return;
  holdEditing();
  picked = [...ids];
  openPicker(picked);
}

// What the picker's answer does, with the line the app shows afterwards.
export function cmdApplyCategory(category: string | null): string {
  const n = cmdSetCategory(category, picked.length ? picked : targets());
  picked = [];
  const lines = `${n} ${n === 1 ? 'line' : 'lines'}`;
  if (category === null) return `Took the category off ${lines}.`;
  const c = lineCategories.getState().byId[category];
  return `Put ${lines} in ${c ? categoryName(c) : 'that category'}.`;
}
