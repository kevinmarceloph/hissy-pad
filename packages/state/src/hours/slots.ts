// Lines of the pad inside an hour. A line carries the slot it is assigned to (core/slot.ts);
// these are the commands the pad's toolbar and the Hours screen run on it. They go through
// the pad's own store, so each one is an undo step and syncs like any other edit.
import { buildIndex, childrenOf, dedent, indent, insertAfter, insertAt, isLive, remove, setDone, setSlot, setState, setText, slotCovers, slotKey, slotLabel, slotLines, slotOutline, splitNode, todayKey, type LineState, type NodeRow } from '@hissypad/core';

import { applyAll, usePad } from '../store';
import { search, type SearchPart } from '../search';
import { holdEditing, targets } from '../selection';

// The pad's toolbar: put the selected lines (or the one being edited) in an hour, or take
// them out of theirs with null. Returns how many lines it was asked about.
export function cmdSetSlot(slot: string | null, ids: readonly string[] = targets()): number {
  // The whole table: the line may not be in the view (a new item's card shows only what is under it).
  if (ids.length) applyAll((all, ctx) => setSlot(all, ctx, [...ids], slot), { label: 'cmdSetSlot' });
  return ids.length;
}

// The slot the targets share, null when they have none or differ: what the picker opens on.
export function targetSlot(ids: readonly string[] = targets()): string | null {
  const { all } = usePad.getState();
  const slots = new Set(ids.map((id) => all[id]?.slot ?? null));
  return slots.size === 1 ? [...slots][0]! : null;
}

// From the Hours screen, where a line may be in any pad: the whole table is the target.
// Hours keeps listing a line after it is archived, so both reach archived lines too.
export function cmdSlotDone(id: string, done: boolean) {
  applyAll((all, ctx) => setDone(all, ctx, [id], done, true), { label: 'cmdSlotDone' });
}

export function cmdSlotClear(id: string) {
  applyAll((all, ctx) => setSlot(all, ctx, [id], null, true), { label: 'cmdSlotClear' });
}

// A line found by search, put in this hour from the Hours screen. It may sit in any pad, so
// the whole table is the target; a line in another hour moves to this one.
export function cmdSlotPut(id: string, day: string, hour: number) {
  applyAll((all, ctx) => (isLive(all[id]) ? setSlot(all, ctx, [id], slotKey(day, hour)) : all), { label: 'cmdSlotPut' });
}

// ---- the hour as a pad of its own -------------------------------------------------------------
// The open hour lists its lines with everything under them, and edits them in place. The
// lines may sit in any pad, so each of these works on the whole table.

// A line's words, typed in the hour. A run of keystrokes on one line is one undo step.
export function cmdSlotText(id: string, text: string) {
  applyAll((all, ctx) => (isLive(all[id]) ? setText(all, ctx, id, text.replace(/\n/g, ' ')) : all), { label: 'cmdSlotText', coalesce: `slot-text:${id}` });
}

// One of the three states, from the hour's switch.
export function cmdSlotState(id: string, state: LineState) {
  applyAll((all, ctx) => setState(all, ctx, [id], state), { label: 'cmdSlotState' });
}

// Return on a line of the hour. On one of the hour's own lines (`top`) the new line goes
// right under it, as its first child: a line beside it would sit outside the hour. On a
// line further in, it splits at the caret like the pad does. Returns the new line's id.
export function cmdSlotBreak(id: string, top: boolean, caret?: number): string {
  let made = '';
  applyAll((all, ctx) => {
    const row = all[id];
    if (!isLive(row)) return all;
    const out = top
      ? insertAt(all, ctx, { parentId: id, afterId: null })
      : caret !== undefined && caret < row.text.length
        ? splitNode(all, ctx, id, caret)
        : insertAfter(all, ctx, id);
    made = out.newId;
    return out.rows;
  }, { label: 'cmdSlotBreak' });
  return made;
}

// Backspace on an empty line with nothing under it takes the line away. Never one of the
// hour's own lines: those leave the hour by their own button.
export function cmdSlotErase(id: string): boolean {
  const { all } = usePad.getState();
  const row = all[id];
  if (!isLive(row) || row.text !== '' || childrenOf(buildIndex(all), id).length > 0) return false;
  applyAll((rows, ctx) => remove(rows, ctx, [id]), { label: 'cmdSlotErase' });
  return true;
}

// Tab and Shift+Tab. A line never moves out from under the hour's own line it belongs to:
// `depth` is how deep it sits in the hour, and a line right under a top one stays there.
export function cmdSlotShift(id: string, depth: number, dir: 'in' | 'out') {
  if (depth < 1 || (dir === 'out' && depth < 2)) return;
  applyAll((all, ctx) => (isLive(all[id]) ? (dir === 'in' ? indent(all, ctx, [id]) : dedent(all, ctx, [id])) : all), { label: 'cmdSlotShift' });
}

export function outlineOfSlot(day: string, hour: number) {
  return slotOutline(usePad.getState().all, slotKey(day, hour));
}

// Lines to offer for an hour while its item field is typed in: the universal search over
// every pad, without pad names, blank lines or lines already in this hour. Open lines
// come before crossed-out ones; within each, search's own order (the open pad first).
export interface SlotFind {
  id: string;
  parts: SearchPart[];
  done: boolean;
  where: string;        // the pad, then the lines it sits under
  slot: string | null;  // the hour it is in now, if another
}
export function slotFinds(day: string, hour: number, query: string, limit = 6): SlotFind[] {
  const { all, padId } = usePad.getState();
  const here = slotKey(day, hour);
  const out: SlotFind[] = [];
  for (const g of search(all, query, padId, 200).groups) {
    for (const h of g.hits) {
      const row = all[h.id];
      if (h.isPad || !row || slotCovers(row.slot, here) || row.text.trim() === '') continue;
      out.push({ id: h.id, parts: h.parts, done: h.done, where: [g.name, ...h.path].join(' › '), slot: row.slot });
    }
  }
  return out.sort((a, b) => Number(a.done) - Number(b.done)).slice(0, limit);
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
// The lines are taken when the picker opens: the line being edited counts as selected, and
// the picker taking focus ends that edit before the answer comes back.
// A caller whose own menu may have ended the edit already (the phone's More) passes the
// lines it had when that menu opened.
let openPicker: ((ids: readonly string[]) => void) | null = null;
let picked: string[] = [];
export function setSlotPickerOpener(open: ((ids: readonly string[]) => void) | null) {
  openPicker = open;
}
export function cmdPickSlot(ids: readonly string[] = targets()) {
  if (ids.length === 0 || !openPicker) return;
  holdEditing();
  picked = [...ids];
  openPicker(picked);
}

// What the picker's answer does, with the line the app shows afterwards.
export function cmdApplySlot(slot: string | null): string {
  const n = cmdSetSlot(slot, picked.length ? picked : targets());
  picked = [];
  const lines = `${n} ${n === 1 ? 'line' : 'lines'}`;
  return slot === null ? `Took ${lines} out of ${n === 1 ? 'its' : 'their'} hour.` : `Put ${lines} in ${slotLabel(slot, todayKey())}.`;
}
