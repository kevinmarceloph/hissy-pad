import type { DayKey } from './day';
import { cleanFlagIds } from './flags';

// The three states a line of the pad has: open (a dot), doing (a dot in a ring), done (a
// cross). An hour has none of its own since 2026-11-27 (Kevin): it is in the state of the
// first line put in it. `state` on a stored row is what was set by hand before that day,
// read only for an hour that has no lines.
export type HourState = 'open' | 'doing' | 'done';

export function cleanHourState(raw: unknown): HourState | null {
  return raw === 'open' || raw === 'doing' || raw === 'done' ? raw : null;
}

// One row per hour slot. (day, hour) is the identity, on the device and on the server, so
// two devices writing the same hour land on the same row and last-write-wins settles it.
// There is no delete.
//
// Since 2026-11-27 (Kevin, "rethink the hour view, round 3") nothing on screen writes one:
// an hour is the lines put in it, and its title, category and state are its first line's.
// The rows stay for what they already hold (a summary, a category and a state typed before
// that day, shown only for an hour with no lines) and for the flags, which are hidden for
// now and kept for a later version. The plan columns (`planned`, `planned_note`) are gone
// from the code; the server still has them, unread.
export type Entry = {
  day: DayKey;
  hour: number; // 0-23, device local time
  // Deprecated: the summary once typed for the hour.
  note: string;
  // Deprecated: the category once chosen for the hour.
  category: string | null;
  // The ids of the flags (src/core/flags.ts) that are on for this hour, sorted. Hidden for now.
  flags: string[];
  // Deprecated: the state once set by hand.
  state: HourState;
  updatedAt: number; // ms since epoch, client clock
};

export type EntryPatch = {
  note?: string;
  category?: string | null;
  flags?: string[];
  state?: HourState;
};

// Something was written on the hour itself: a summary, a category or a flag.
export function isLogged(entry: Pick<Entry, 'note' | 'category' | 'flags'> | undefined): boolean {
  return !!entry && (entry.category !== null || entry.note.trim() !== '' || entry.flags.length > 0);
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

// What an hour's row says: the first line put in it, and how many more there are. With no
// lines, what was written on the hour before 2026-11-27, or else the recurring plan that
// covers it. The category and the state go the same way: the first line's (Kevin: first
// item done = hour done), and never a mix.
export type HourShown = {
  title: string;
  // The other lines put in the hour, after the first: the row says "+2".
  more: number;
  category: string | null;
  state: HourState;
  from: 'line' | 'old' | 'plan' | null;
};
type TopLine = { text: string; category: string | null; done: boolean; doing?: boolean };

export function hourShown(
  top: TopLine | undefined,
  more = 0,
  plan?: { note: string; category: string | null },
  old?: Entry,
): HourShown {
  if (top) {
    return { title: firstLine(top.text), more, category: top.category, state: top.done ? 'done' : top.doing ? 'doing' : 'open', from: 'line' };
  }
  if (old && (old.note.trim() !== '' || old.category !== null)) {
    return { title: firstLine(old.note), more: 0, category: old.category, state: old.state, from: 'old' };
  }
  if (plan) return { title: firstLine(plan.note), more: 0, category: plan.category, state: 'open', from: 'plan' };
  return { title: '', more: 0, category: null, state: 'open', from: null };
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
    flags: cleanFlagIds(patch.flags ?? base?.flags ?? []),
    state: patch.state ?? base?.state ?? 'open',
    // Never go backwards: a device with a slow clock still produces a newer write than
    // the row it is editing, or the server's last-write-wins would drop the edit.
    updatedAt: Math.max(now, (base?.updatedAt ?? 0) + 1),
  };
}
