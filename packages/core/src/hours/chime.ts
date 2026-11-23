// Chimes: the minutes past every hour when Oras-oras asks where the hour is going. The list
// is a setting of the device (a phone schedules notifications, a browser rings while the page
// is open), so it lives in the meta table and never syncs. An empty list is "off".
import { dayKey, type DayKey } from './day';

// The minutes the screen offers. The setting itself takes any minute from 0 to 59.
export const CHIME_CHOICES: readonly number[] = Array.from({ length: 12 }, (_, i) => i * 5);

// What turning chimes on came to. 'denied': the device will not show notifications, so
// nothing was scheduled. 'sound': a browser that rings but cannot show a notification.
export type ChimeOutcome = 'on' | 'off' | 'denied' | 'sound';

// Whole minutes from 0 to 59, each once, in order. Anything else is dropped.
export function cleanChimes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const minutes = raw.filter((m): m is number => Number.isInteger(m) && m >= 0 && m <= 59);
  return [...new Set(minutes)].sort((a, b) => a - b);
}

// The meta table holds text: "30,55", or "" for off.
export function formatChimes(minutes: readonly number[]): string {
  return cleanChimes([...minutes]).join(',');
}

export function parseChimes(value: string | null | undefined): number[] {
  if (!value) return [];
  return cleanChimes(
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => /^\d{1,2}$/.test(part))
      .map(Number),
  );
}

export function toggleChime(minutes: readonly number[], minute: number): number[] {
  return minutes.includes(minute) ? minutes.filter((m) => m !== minute) : cleanChimes([...minutes, minute]);
}

export function minuteLabel(minute: number): string {
  return `:${String(minute).padStart(2, '0')}`;
}

// The setting in a sentence: the heading over the chooser.
export function chimesSpoken(minutes: readonly number[]): string {
  if (minutes.length === 0) return 'Chimes are off';
  const labels = minutes.map(minuteLabel);
  const last = labels.pop();
  return `Chimes at ${labels.length ? `${labels.join(', ')} and ${last}` : last}`;
}

// The first chime strictly after `now`, or null when chimes are off.
export function nextChime(now: Date, minutes: readonly number[]): Date | null {
  for (const ahead of [0, 1]) {
    for (const minute of cleanChimes([...minutes])) {
      const at = new Date(now);
      at.setHours(now.getHours() + ahead, minute, 0, 0);
      if (at.getTime() > now.getTime()) return at;
    }
  }
  return null;
}

// A chime on the hour asks about the hour that just ended; any other asks about the one
// in progress.
export function chimeTitle(minute: number): string {
  return minute === 0 ? 'Where did the hour go?' : 'Where is this hour going?';
}

// The slot a reply to a chime belongs to, by the same rule. `minute` is the chime's own
// minute, not the moment the notification happened to be delivered.
export function chimeSlot(fired: Date, minute: number): { day: DayKey; hour: number } {
  const at = minute === 0 ? new Date(fired.getTime() - 60 * 60 * 1000) : fired;
  return { day: dayKey(at), hour: at.getHours() };
}

type ChimerDeps = {
  now(): Date;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  fire(at: Date): void;
};

// How late a chime may still ring. A page in the background gets its timers about once a
// minute, and a laptop that slept through a chime should not ring for it on waking.
const LATE_MS = 90_000;
// Never sleep longer than this in one go, so a changed clock or a wake is noticed.
const CHECK_MS = 30_000;

// Rings at the chosen minutes for as long as something keeps it alive: the browser's stand-in
// for a schedule the operating system would hold. Pure: the clock and the timer are handed in.
export function createChimer(deps: ChimerDeps) {
  let minutes: number[] = [];
  let target: Date | null = null;
  let timer: unknown = null;

  const wait = () => {
    if (!target) return;
    const ms = Math.max(0, Math.min(target.getTime() - deps.now().getTime(), CHECK_MS));
    timer = deps.setTimer(check, ms);
  };
  const check = () => {
    timer = null;
    if (!target) return;
    const now = deps.now();
    if (now.getTime() < target.getTime()) return wait();
    if (now.getTime() - target.getTime() <= LATE_MS) deps.fire(target);
    arm();
  };
  const arm = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    target = nextChime(deps.now(), minutes);
    wait();
  };

  return {
    set(next: readonly number[]) {
      minutes = cleanChimes([...next]);
      arm();
    },
    stop() {
      minutes = [];
      arm();
    },
  };
}
