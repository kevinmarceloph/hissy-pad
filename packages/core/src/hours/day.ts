// Days are keyed 'YYYY-MM-DD' in the device's local time: "9am Tuesday" is what was lived,
// whatever the timezone. Everything here takes `now` as an argument so tests can pin it.
export type DayKey = string;

export const HOURS: readonly number[] = Array.from({ length: 24 }, (_, h) => h);

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(date: Date): DayKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDayKey(day: DayKey): Date {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDay(day: DayKey, by: number): DayKey {
  const date = fromDayKey(day);
  date.setDate(date.getDate() + by);
  return dayKey(date);
}

export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? 'am' : 'pm'}`;
}

export type SlotState = 'past' | 'now' | 'future';

// `day` and `hour` here are the calendar ones: where the slot really sits on the clock.
export function slotState(day: DayKey, hour: number, now: Date): SlotState {
  const today = dayKey(now);
  if (day < today) return 'past';
  if (day > today) return 'future';
  if (hour < now.getHours()) return 'past';
  return hour === now.getHours() ? 'now' : 'future';
}

// A day on the screen does not have to start at midnight. With a day start of 6, "Friday"
// runs from 6am Friday to 6am Saturday. Rows are still stored under the calendar day and
// hour they really happened in, so changing the start moves nothing: it only changes
// which 24 slots a day on the screen is made of.
export type Slot = { day: DayKey; hour: number };

export const DAY_START_DEFAULT = 0;

// Anything that is not a whole hour from 0 to 23 reads as midnight.
export function cleanDayStart(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 23 ? n : DAY_START_DEFAULT;
}

// The 24 slots of the day that starts at `start` o'clock on `day`, in order.
export function daySlots(day: DayKey, start: number = DAY_START_DEFAULT): Slot[] {
  const next = shiftDay(day, 1);
  return HOURS.map((i) => {
    const hour = (start + i) % 24;
    return { day: hour >= start ? day : next, hour };
  });
}

// The calendar day a slot of `day` falls on.
export function slotDay(day: DayKey, hour: number, start: number = DAY_START_DEFAULT): DayKey {
  return hour >= start ? day : shiftDay(day, 1);
}

// The day on the screen that `date` belongs to: before the day start it is still yesterday.
export function dayOf(date: Date, start: number = DAY_START_DEFAULT): DayKey {
  return date.getHours() >= start ? dayKey(date) : shiftDay(dayKey(date), -1);
}

// How many slots of `day` are over: 24 for a past day, 0 for a future one, and the
// current hour is not counted until it ends.
export function elapsedHours(day: DayKey, now: Date, start: number = DAY_START_DEFAULT): number {
  const today = dayOf(now, start);
  if (day < today) return 24;
  if (day > today) return 0;
  return (now.getHours() - start + 24) % 24;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayTitle(day: DayKey, now: Date, start: number = DAY_START_DEFAULT): string {
  const today = dayOf(now, start);
  if (day === today) return 'Today';
  if (day === shiftDay(today, -1)) return 'Yesterday';
  if (day === shiftDay(today, 1)) return 'Tomorrow';
  return dayDate(day);
}

export function dayDate(day: DayKey): string {
  const date = fromDayKey(day);
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}
