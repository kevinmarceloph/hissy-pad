// A line of the pad can carry one of Hours' categories (NodeRow.category, a category id);
// the pad draws it as the category's icon before the text. These are the commands the
// toolbar's "Category…" runs, and the category list the pad reads to draw the icons.
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { setCategory } from '@hissypad/core';
import { activeCategories, categoryName, type Category } from '@hissypad/core/hours';

import { applyAll, usePad } from '../store';
import { holdEditing, targets } from '../selection';

// ---- the list the pad draws from ----------------------------------------------------------

// Every category by id, archived ones included: a line keeps the icon of a category that
// was archived after it was given. Filled once Hours' store is open (index.ts).
export const lineCategories = createStore(() => ({ list: [] as Category[], byId: {} as Record<string, Category> }));

export function adoptLineCategories(list: Category[]) {
  lineCategories.setState({ list, byId: Object.fromEntries(list.map((c) => [c.id, c])) });
}

// The category a line carries, or undefined while none (or not synced yet).
export function useLineCategory(id: string | null | undefined): Category | undefined {
  return useStore(lineCategories, (s) => (id ? s.byId[id] : undefined));
}

// What the picker offers: the active ones, in order.
export function useCategoryChoices(): Category[] {
  return activeCategories(useStore(lineCategories, (s) => s.list));
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
