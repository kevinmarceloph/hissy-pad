// Lines of the pad inside an hour. A line carries the slot it is assigned to (core/slot.ts);
// these are the commands the pad's toolbar and the Hours screen run on it. They go through
// the pad's own store, so each one is an undo step and syncs like any other edit.
import { slotHoursLabel, fixedPadOf, insertAt, isLive, isTemplate, parseRepeat, repeatSlot, restore, setRepeatSlot, setSlot, slotByPrefix, slotCovers, slotKey, slotLabel, slotLeftovers, slotLines, todayKey, type NodeRow } from '@hissypad/core';
import { DAY_START_DEFAULT, dayOf } from '@hissypad/core/hours';

import { applyAll, setClassifier, usePad } from '../store';
import { hoursIfOpen } from './index';
import { batchSubtree, cmdUnarchive } from '../archive';
import { holdEditing, targets } from '../selection';

// An hour typed in front of a line puts it in that hour of the day on screen (core's
// hourprefix.ts), the day starting at Hours' day start (Kevin, 2026-11-27).
setClassifier((all, ctx, ids) => {
  const start = hoursIfOpen()?.day.getState().start ?? DAY_START_DEFAULT;
  return slotByPrefix(all, ctx, ids, dayOf(new Date(), start), start);
}, 'hour');

// The pad's toolbar: put the selected lines (or the one being edited) in an hour, or take
// them out of theirs with null. Returns how many lines it was asked about.
export function cmdSetSlot(slot: string | null, ids: readonly string[] = targets()): number {
  // The whole table: the line may not be in the view (a new item's card shows only what is under it).
  // A recurring item's template is in no hour itself: its hours are its instances', kept in its rule.
  const start = hoursIfOpen()?.day.getState().start ?? DAY_START_DEFAULT;
  const today = dayOf(new Date(), start);
  if (ids.length) {
    applyAll((all, ctx) => {
      let out = setSlot(all, ctx, ids.filter((id) => !isTemplate(all[id])), slot);
      for (const id of ids) if (isTemplate(all[id])) out = setRepeatSlot(out, ctx, id, slot, today, start);
      return out;
    }, { label: 'cmdSetSlot' });
  }
  return ids.length;
}

// The slot the targets share, null when they have none or differ: what the picker opens on.
export function targetSlot(ids: readonly string[] = targets()): string | null {
  const { all } = usePad.getState();
  // A template's are the hours its next instance goes in (on today, for one whose next day
  // waits on the last being done).
  const today = dayOf(new Date(), hoursIfOpen()?.day.getState().start ?? DAY_START_DEFAULT);
  const ofTemplate = (id: string) => {
    const rule = parseRepeat(all[id]!.repeat)!;
    return repeatSlot(rule, rule.next > today ? rule.next : today);
  };
  const slots = new Set(ids.map((id) => (isTemplate(all[id]) ? ofTemplate(id) : all[id]?.slot ?? null)));
  return slots.size === 1 ? [...slots][0]! : null;
}

// A line found by search, put in this hour from the Hours screen. It may sit in any pad, so
// the whole table is the target; a line in another hour moves to this one.
export function cmdSlotPut(id: string, day: string, hour: number) {
  applyAll((all, ctx) => (isLive(all[id]) ? setSlot(all, ctx, [id], slotKey(day, hour)) : all), { label: 'cmdSlotPut' });
}

// Whether a line is already in an hour: the search that finds lines for an hour says so.
export function inSlot(id: string, slot: string): boolean {
  return slotCovers(usePad.getState().all[id]?.slot, slot);
}

// "Fresh start" on an hour (Kevin, 2026-11-27): every line put in it that is not crossed
// out leaves the hour and is marked with the dot of a line that came back (`fresh`), so it
// shows in its pad as something to place again. A line in other hours too keeps those.
// Crossed-out and archived lines stay: they are what the hour was. One undo step. Returns
// how many lines left.
export function cmdSlotFresh(day: string, hour: number): number {
  const slot = slotKey(day, hour);
  const left = slotLeftovers(usePad.getState().all, slot);
  if (left.length === 0) return 0;
  applyAll((all, ctx) => {
    let out = all;
    for (const { id, slot: rest } of slotLeftovers(all, slot)) {
      out = setSlot(out, ctx, [id], rest);
      out = { ...out, [id]: { ...out[id]!, fresh: true, updatedAt: ctx.now() } };
    }
    return out;
  }, { label: 'cmdSlotFresh' });
  return left.length;
}

// The archived mark on a line of an open hour: the line comes back where it was in its
// pad, with what was archived under it, as done or as open as it was. One whose parent is
// archived too has no place to come back to and goes to the top of its pad (cmdUnarchive).
export function cmdSlotUnarchive(id: string) {
  const { all } = usePad.getState();
  const row = all[id];
  if (!row || row.deletedAt === null) return;
  if (row.parentId !== null && !isLive(all[row.parentId])) return void cmdUnarchive([id]);
  applyAll((rows, ctx) => restore(rows, ctx, batchSubtree(rows, id)), { label: 'cmdSlotUnarchive' });
}

// The hour's search button: each app's own Search, opened to put the line found in the
// hour instead of going to it. The apps set the opener; the shared screen only asks.
let openFinder: ((slot: string) => void) | null = null;
export function setSlotFinder(open: ((slot: string) => void) | null) {
  openFinder = open;
}
export function cmdFindForSlot(day: string, hour: number) {
  holdEditing();
  openFinder?.(slotKey(day, hour));
}

// A new line typed into an hour: it goes to the top of Today, already assigned (Kevin,
// 2026-11-25: whichever pad is open, an item made for an hour is for today's list). The
// open pad takes it only while there is no Today yet. Returns its id ('' for blank text).
export function cmdSlotAdd(day: string, hour: number, text: string): string {
  const clean = text.trim();
  if (!clean) return '';
  const { padId } = usePad.getState();
  let id = '';
  applyAll((all, ctx) => {
    let today: string | null = padId;
    for (const key in all) {
      const r = all[key]!;
      if (r.pad && isLive(r) && fixedPadOf(all, r.id) === 'Today') today = r.id;
    }
    const made = insertAt(all, ctx, { parentId: today, afterId: null }, clean);
    id = made.newId;
    return setSlot(made.rows, ctx, [id], slotKey(day, hour));
  }, { label: 'cmdSlotAdd' });
  return id;
}

export function linesInSlot(day: string, hour: number): NodeRow[] {
  return slotLines(usePad.getState().all, slotKey(day, hour));
}

// The hour picker is a screen of each app's (the shared SlotPicker in packages/ui, in a
// dialog on web and a modal on the phone). The toolbar's "Hour…" action only asks for it.
// The lines are taken when the picker opens: the line being edited counts as selected, and
// the picker taking focus ends that edit before the answer comes back.
// A caller whose own menu may have ended the edit already (the phone's More) passes the
// lines it had when that menu opened.
let openPicker: ((ids: readonly string[]) => void) | null = null;
let picked: string[] = [];
export function setSlotPickerOpener(open: ((ids: readonly string[]) => void) | null) {
  openPicker = open;
}
// The lines the picker was opened on: its Repeat section works on the one, when there is one.
export function slotPickerLines(): readonly string[] {
  return picked;
}
export function cmdPickSlot(ids: readonly string[] = targets()) {
  if (ids.length === 0 || !openPicker) return;
  holdEditing();
  picked = [...ids];
  openPicker(picked);
}

// What the picker's answer does, with the line the app shows afterwards.
export function cmdApplySlot(slot: string | null): string {
  const ids = picked.length ? picked : targets();
  // A recurring item's template is put in no hour: the hours are for the items made from it.
  const templates = ids.length > 0 && ids.every((id) => isTemplate(usePad.getState().all[id]));
  const n = cmdSetSlot(slot, ids);
  picked = [];
  if (templates) return slot === null ? 'Its items come with no hour.' : `Its items go in ${slotHoursLabel(slot)} of their day.`;
  const lines = `${n} ${n === 1 ? 'line' : 'lines'}`;
  return slot === null ? `Took ${lines} out of ${n === 1 ? 'its' : 'their'} hour.` : `Put ${lines} in ${slotLabel(slot, todayKey())}.`;
}
