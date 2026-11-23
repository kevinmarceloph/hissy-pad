// Lines of the pad inside an hour. A line carries the slot it is assigned to (core/slot.ts);
// these are the commands the pad's toolbar and the Hours screen run on it. They go through
// the pad's own store, so each one is an undo step and syncs like any other edit.
import { insertAt, isLive, setDone, setSlot, slotKey, slotLabel, slotLines, todayKey, type NodeRow } from '@hissypad/core';

import { apply, applyAll, usePad } from '../store';
import { targets } from '../selection';

// The pad's toolbar: put the selected lines (or the one being edited) in an hour, or take
// them out of theirs with null. Returns how many lines it was asked about.
export function cmdSetSlot(slot: string | null): number {
  const ids = targets();
  if (ids.length) apply((rows, ctx) => setSlot(rows, ctx, ids, slot), { label: 'cmdSetSlot' });
  return ids.length;
}

// The slot the targets share, null when they have none or differ: what the picker opens on.
export function targetSlot(): string | null {
  const { rows } = usePad.getState();
  const slots = new Set(targets().map((id) => rows[id]?.slot ?? null));
  return slots.size === 1 ? [...slots][0]! : null;
}

// From the Hours screen, where a line may be in any pad: the whole table is the target.
export function cmdSlotDone(id: string, done: boolean) {
  applyAll((all, ctx) => (isLive(all[id]) ? setDone(all, ctx, [id], done) : all), { label: 'cmdSlotDone' });
}

export function cmdSlotClear(id: string) {
  applyAll((all, ctx) => setSlot(all, ctx, [id], null), { label: 'cmdSlotClear' });
}

// A new line typed into an hour: it goes to the top of the pad that is open, already
// assigned. Returns its id ('' for blank text).
export function cmdSlotAdd(day: string, hour: number, text: string): string {
  const clean = text.trim();
  if (!clean) return '';
  const { padId } = usePad.getState();
  let id = '';
  applyAll((all, ctx) => {
    const made = insertAt(all, ctx, { parentId: padId, afterId: null }, clean);
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
let openPicker: (() => void) | null = null;
export function setSlotPickerOpener(open: (() => void) | null) {
  openPicker = open;
}
export function cmdPickSlot() {
  if (targets().length > 0) openPicker?.();
}

// What the picker's answer does, with the line the app shows afterwards.
export function cmdApplySlot(slot: string | null): string {
  const n = cmdSetSlot(slot);
  const lines = `${n} ${n === 1 ? 'line' : 'lines'}`;
  return slot === null ? `Took ${lines} out of ${n === 1 ? 'its' : 'their'} hour.` : `Put ${lines} in ${slotLabel(slot, todayKey())}.`;
}
