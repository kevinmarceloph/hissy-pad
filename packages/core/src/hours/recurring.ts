import { dayKey, fromDayKey, hourLabel, shiftDay, type DayKey } from './day';
import { hasPlan, type Entry, type EntryPatch } from './entry';

// A plan that repeats: "sleep, 2am to 10am, every day", "church, 9am to 11am, Sundays".
// An hour with no plan of its own takes the recurring plan that covers it, so the day comes
// already drawn and the hours only need to be marked done. Like categories and flags these
// are rows the user edits, synced, and never deleted: removing one archives it.
export type RecurringPlan = {
  id: string;
  // What the hours are for: the plan's words and its category, as on an hour.
  note: string;
  category: string | null;
  // The hours it covers: from `from` o'clock up to, not including, `to` o'clock. A `to` at
  // or before `from` falls on the next day (10pm to 6am); the two equal is a whole day.
  from: number; // 0-23
  to: number; // 0-23
  // The weekdays a run starts on, 0 (Sunday) to 6, sorted. All seven is every day. A run
  // that crosses midnight belongs to the day it starts on: Friday 10pm to 3am covers
  // 1am on Saturday. These are calendar days, whatever hour the day on the screen starts at.
  days: number[];
  // The first day it applies to. Days before a plan was made are not redrawn by it.
  since: DayKey;
  // Order on the screen. Gaps and ties are fine; ties break on id.
  position: number;
  archived: boolean;
  updatedAt: number; // ms since epoch, client clock
};

export type RecurringFields = Pick<RecurringPlan, 'note' | 'category' | 'from' | 'to' | 'days'>;
export type RecurringPatch = Partial<RecurringFields & Pick<RecurringPlan, 'position' | 'archived'>>;

export const EVERY_DAY: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const NOTE_MAX = 280;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayName = (day: number) => DAY_NAMES[day];

// A whole hour from 0 to 23, or the fallback.
export function cleanHour(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback;
}

// Weekdays as a sorted set of whole numbers from 0 to 6. Anything else is dropped.
export function cleanDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

export function toggleDay(days: readonly number[], day: number): number[] {
  return cleanDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);
}

// Trims the ends and cuts to NOTE_MAX. Lines inside are kept: it is a plan's text.
export function cleanNote(raw: string): string {
  return raw.trim().slice(0, NOTE_MAX).trim();
}

// How many hours a run lasts: 1 to 24.
export function spanHours(from: number, to: number): number {
  return (to - from + 24) % 24 || 24;
}

// "2am-10am". The same hour twice is the whole day.
export function spanLabel(from: number, to: number): string {
  return from === to ? `all day from ${hourLabel(from)}` : `${hourLabel(from)}-${hourLabel(to)}`;
}

export function daysLabel(days: readonly number[]): string {
  const set = cleanDays(days);
  const key = set.join('');
  if (set.length === 0) return 'no days';
  if (key === '0123456') return 'every day';
  if (key === '12345') return 'weekdays';
  if (key === '06') return 'weekends';
  return set.map(dayName).join(', ');
}

// Why a plan cannot be saved, in words the screen can show, or null when it can.
export function recurringProblem(fields: RecurringFields): string | null {
  if (cleanNote(fields.note) === '' && fields.category === null) return 'Say what the hours are for, or pick a category.';
  if (cleanDays(fields.days).length === 0) return 'Pick at least one day.';
  return null;
}

export function sortRecurring(list: RecurringPlan[]): RecurringPlan[] {
  return [...list].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function newRecurring(list: RecurringPlan[], id: string, fields: RecurringFields, now: Date): RecurringPlan {
  const last = list.reduce((max, p) => Math.max(max, p.position), -1);
  return {
    id,
    note: cleanNote(fields.note),
    category: fields.category,
    from: cleanHour(fields.from, 0),
    to: cleanHour(fields.to, 0),
    days: cleanDays(fields.days),
    since: dayKey(now),
    position: last + 1,
    archived: false,
    updatedAt: now.getTime(),
  };
}

export function patchRecurring(base: RecurringPlan, patch: RecurringPatch, now: number): RecurringPlan {
  return {
    ...base,
    ...patch,
    note: patch.note !== undefined ? cleanNote(patch.note) : base.note,
    from: cleanHour(patch.from, base.from),
    to: cleanHour(patch.to, base.to),
    days: patch.days !== undefined ? cleanDays(patch.days) : base.days,
    // Never go backwards, for the same reason as entries: last write wins on the server.
    updatedAt: Math.max(now, base.updatedAt + 1),
  };
}

// 'r' plus nine base-36 characters, well inside the server's 32-character limit.
export function newRecurringId(random: () => number = Math.random): string {
  let id = 'r';
  while (id.length < 10) id += Math.floor(random() * 36).toString(36);
  return id;
}

// Whether a plan covers a calendar slot. The run the slot would belong to started on this
// day if the hour is at or past `from`, and on the day before otherwise.
export function covers(plan: RecurringPlan, day: DayKey, hour: number): boolean {
  if (plan.archived) return false;
  if ((hour - plan.from + 24) % 24 >= spanHours(plan.from, plan.to)) return false;
  const started = hour >= plan.from ? day : shiftDay(day, -1);
  return started >= plan.since && plan.days.includes(fromDayKey(started).getDay());
}

// The recurring plan for a calendar slot. Where two overlap, the one on fewer days wins
// (a Sunday plan over an every-day one), then the one listed first.
export function recurringAt(list: readonly RecurringPlan[], day: DayKey, hour: number): RecurringPlan | undefined {
  let best: RecurringPlan | undefined;
  for (const plan of list) {
    if (!covers(plan, day, hour)) continue;
    if (
      !best ||
      plan.days.length < best.days.length ||
      (plan.days.length === best.days.length &&
        (plan.position < best.position || (plan.position === best.position && plan.id < best.id)))
    ) {
      best = plan;
    }
  }
  return best;
}

// What a recurring plan lends an hour without being stored on it: its words and category.
export type DrawnPlan = Pick<RecurringPlan, 'note' | 'category'>;

// An hour as the screen shows it: its own plan if it has one, the drawn one if not. An
// hour with no row of its own gets a blank one to carry the plan.
export function withRecurring(entry: Entry | undefined, plan: DrawnPlan | undefined, day: DayKey, hour: number): Entry | undefined {
  // Not the type guard's narrowing: an entry without a plan is still an entry.
  const planned: boolean = hasPlan(entry);
  if (planned || !plan) return entry;
  const base: Entry = entry ?? { day, hour, note: '', category: null, planned: null, plannedNote: '', flags: [], state: 'open', updatedAt: 0 };
  return { ...base, planned: plan.category, plannedNote: plan.note };
}

// A recurring plan is not stored on the hours it covers: change the plan and the hours
// ahead follow. The first write to an hour pins the plan it was showing into the row, so
// an hour that was lived keeps the plan it was lived against. A patch that sets the plan
// itself wins.
export function pinRecurring(patch: EntryPatch, stored: Entry | undefined, plan: DrawnPlan | undefined): EntryPatch {
  const planned: boolean = hasPlan(stored);
  if (planned || !plan) return patch;
  return { planned: plan.category, plannedNote: plan.note, ...patch };
}
