import type { DayKey } from './day';
import { cleanFlagIds } from './flags';

// One row per hour slot. (day, hour) is the identity, on the device and on the server, so
// two devices logging the same hour land on the same row and last-write-wins settles it.
// There is no delete: clearing an hour writes an empty row (no note, no category, no plan,
// no flags) with a newer updatedAt, and that empty row is its own tombstone.
export type Entry = {
  day: DayKey;
  hour: number; // 0-23, device local time
  // What happened, in words.
  note: string;
  // Where the hour went: a category id (src/core/categories.ts). An id the device does not
  // know yet, written by another device before its category row arrived, shows as untagged
  // and is kept.
  category: string | null;
  // Where the hour was meant to go: also a category id. The screen draws it as an outline
  // and `category` as the fill, so a kept plan and a missed one look different.
  planned: string | null;
  // What was meant to happen, in words. Once the hour starts the editor offers it as the
  // first draft of `note`. Either text can run to several lines.
  plannedNote: string;
  // The ids of the flags (src/core/flags.ts) that are on for this hour, sorted.
  flags: string[];
  updatedAt: number; // ms since epoch, client clock
};

export type EntryPatch = {
  note?: string;
  category?: string | null;
  planned?: string | null;
  plannedNote?: string;
  flags?: string[];
};

// Something was written about what happened. A plan alone is not a log.
export function isLogged(entry: Entry | undefined): entry is Entry {
  return !!entry && (entry.category !== null || entry.note.trim() !== '' || entry.flags.length > 0);
}

export function hasPlan(entry: Entry | undefined): entry is Entry {
  return !!entry && (entry.planned !== null || entry.plannedNote.trim() !== '');
}

// How an hour stands against its plan: 'none' when nothing was planned, 'kept' when it went
// to the category it was meant for, 'missed' when it went to another, 'open' when nothing
// says yet. Only categories are compared: a plan that is words alone stays 'open', because
// two sentences cannot be judged the way two categories can.
export type PlanState = 'none' | 'open' | 'kept' | 'missed';

export function planState(entry: Entry | undefined): PlanState {
  if (!hasPlan(entry)) return 'none';
  if (entry.planned === null || entry.category === null) return 'open';
  return entry.category === entry.planned ? 'kept' : 'missed';
}

// A text can run to several lines. Lists show the first one that says anything, the way a
// commit shows its subject.
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

export function applyPatch(
  base: Entry | undefined,
  day: DayKey,
  hour: number,
  patch: EntryPatch,
  now: number,
): Entry {
  return {
    day,
    hour,
    note: patch.note ?? base?.note ?? '',
    category: patch.category !== undefined ? patch.category : (base?.category ?? null),
    planned: patch.planned !== undefined ? patch.planned : (base?.planned ?? null),
    plannedNote: patch.plannedNote ?? base?.plannedNote ?? '',
    flags: cleanFlagIds(patch.flags ?? base?.flags ?? []),
    // Never go backwards: a device with a slow clock still produces a newer write than
    // the row it is editing, or the server's last-write-wins would drop the edit.
    updatedAt: Math.max(now, (base?.updatedAt ?? 0) + 1),
  };
}

// The patch that clears an hour: what happened and what was planned.
export const EMPTY: Required<EntryPatch> = { note: '', category: null, planned: null, plannedNote: '', flags: [] };

// What clearing an hour that has started takes away: what happened. Its plan is closed
// and stays.
export const DEED_EMPTY: EntryPatch = { note: '', category: null, flags: [] };

// What happened in an hour, apart from its plan.
export type Deed = Pick<Entry, 'note' | 'category' | 'flags'>;

// A tap on the box of an hour that has started: the hour's checkbox. On an hour with
// nothing logged it takes the plan as what happened, words and category both. On a logged
// hour it takes what happened away and leaves the plan. `taken` is what an earlier tap
// took away, if the screen still has it: the next tap puts exactly that back, so a tap by
// mistake costs one more tap and nothing else. Null when there is nothing to do: no plan
// to accept and nothing to put back.
export function toggleDone(entry: Entry | undefined, taken?: Deed): { patch: EntryPatch; taken?: Deed } | null {
  // The guards narrow a blank hour to "no entry", which it is not: it can still carry a plan.
  const logged: boolean = isLogged(entry);
  if (entry && logged) {
    return { patch: DEED_EMPTY, taken: { note: entry.note, category: entry.category, flags: entry.flags } };
  }
  if (taken) return { patch: taken };
  const planned: boolean = hasPlan(entry);
  if (!entry || !planned) return null;
  return { patch: { note: entry.plannedNote, category: entry.planned } };
}
