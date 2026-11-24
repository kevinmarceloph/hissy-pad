import type { DayKey } from './day';
import { cleanFlagIds } from './flags';

// The three states an hour goes through, the same three a line of the pad has: open (a
// dot), doing (a dot in a ring), done (a cross). Done is set by hand: it is how a past
// hour is confirmed to have gone where it should.
export type HourState = 'open' | 'doing' | 'done';

export function cleanHourState(raw: unknown): HourState | null {
  return raw === 'open' || raw === 'doing' || raw === 'done' ? raw : null;
}

// One row per hour slot. (day, hour) is the identity, on the device and on the server, so
// two devices logging the same hour land on the same row and last-write-wins settles it.
// There is no delete: clearing an hour writes an empty row (no note, no category, no plan,
// no flags) with a newer updatedAt, and that empty row is its own tombstone.
export type Entry = {
  day: DayKey;
  hour: number; // 0-23, device local time
  // The hour's summary, in words: a title typed by hand. Blank by default, and the hour
  // then shows the first of the pad's lines put in it.
  note: string;
  // Where the hour went: a category id (src/core/categories.ts). An id the device does not
  // know yet, written by another device before its category row arrived, shows as untagged
  // and is kept.
  category: string | null;
  // Deprecated 2026-11-24 (Kevin: no more planned against actual). Nothing edits these by
  // hand any more. They still carry a recurring plan pinned into the hour, and plans typed
  // before that day, and are read only as the words and category an hour falls back on.
  planned: string | null;
  plannedNote: string;
  // The ids of the flags (src/core/flags.ts) that are on for this hour, sorted.
  flags: string[];
  state: HourState;
  updatedAt: number; // ms since epoch, client clock
};

export type EntryPatch = {
  note?: string;
  category?: string | null;
  planned?: string | null;
  plannedNote?: string;
  flags?: string[];
  state?: HourState;
};

// Something was written on the hour itself: a summary, a category or a flag.
export function isLogged(entry: Pick<Entry, 'note' | 'category' | 'flags'> | undefined): boolean {
  return !!entry && (entry.category !== null || entry.note.trim() !== '' || entry.flags.length > 0);
}

export function hasPlan(entry: Entry | undefined): entry is Entry {
  return !!entry && (entry.planned !== null || entry.plannedNote.trim() !== '');
}

export function hourState(entry: Pick<Entry, 'state'> | undefined): HourState {
  return entry?.state ?? 'open';
}

// A row written before hours had a state (2026-11-24) has none: one that was logged then
// counts as done, which is what its filled box said.
export function withState(row: Omit<Entry, 'state'> & { state?: unknown }): Entry {
  return { ...row, state: cleanHourState(row.state) ?? (isLogged(row) ? 'done' : 'open') };
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

// What an hour's row says: the summary typed for it, or else the line on top of its list,
// or else the words it falls back on (a recurring plan's). The category goes the same way.
export type HourShown = { title: string; category: string | null; from: 'summary' | 'line' | 'plan' | null };

export function hourShown(entry: Entry | undefined, top: { text: string; category: string | null } | undefined): HourShown {
  const summary = firstLine(entry?.note ?? '');
  const line = firstLine(top?.text ?? '');
  const plan = firstLine(entry?.plannedNote ?? '');
  const category = entry?.category ?? top?.category ?? entry?.planned ?? null;
  if (summary) return { title: summary, category, from: 'summary' };
  if (line) return { title: line, category, from: 'line' };
  if (plan || entry?.planned) return { title: plan, category, from: 'plan' };
  return { title: '', category, from: null };
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
    state: patch.state ?? base?.state ?? 'open',
    // Never go backwards: a device with a slow clock still produces a newer write than
    // the row it is editing, or the server's last-write-wins would drop the edit.
    updatedAt: Math.max(now, (base?.updatedAt ?? 0) + 1),
  };
}

// The patch that clears an hour: everything written on it. The pad's lines put in the
// hour are not the hour's to clear.
export const EMPTY: Required<EntryPatch> = { note: '', category: null, planned: null, plannedNote: '', flags: [], state: 'open' };
