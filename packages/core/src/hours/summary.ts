import { sortCategories, type Category } from './categories';
import { DAY_START_DEFAULT, elapsedHours, slotDay, slotState, type DayKey } from './day';
import type { HourState } from './entry';

// One hour as the day counts it: its state, and the category its row shows (its own, or
// its top line's, or the one it falls back on).
export type SummaryHour = { day: DayKey; hour: number; state: HourState; category: string | null };

export type Summary = {
  // Done hours per category, in the user's category order. Categories with none are left
  // out. Archived categories still count: the hours were spent.
  byCategory: { category: Category; hours: number }[];
  // Done hours with no category, or one this device does not know.
  untagged: number;
  done: number;
  // Hours that are over and not marked done: the ones still to confirm.
  open: number;
  elapsed: number;
};

// `day` is a day on the screen: with a day start other than midnight its last hours fall
// on the next calendar day (see daySlots).
export function summarize(
  hours: SummaryHour[],
  day: DayKey,
  now: Date,
  categories: Category[],
  start: number = DAY_START_DEFAULT,
): Summary {
  const elapsed = elapsedHours(day, now, start);
  const known = new Set(categories.map((c) => c.id));
  const counts = new Map<string, number>();
  let untagged = 0;
  let done = 0;
  let doneElapsed = 0;

  for (const h of hours) {
    if (h.day !== slotDay(day, h.hour, start) || h.state !== 'done') continue;
    done += 1;
    if (slotState(h.day, h.hour, now) === 'past') doneElapsed += 1;
    if (h.category === null || !known.has(h.category)) untagged += 1;
    else counts.set(h.category, (counts.get(h.category) ?? 0) + 1);
  }

  return {
    byCategory: sortCategories(categories)
      .filter((c) => counts.has(c.id))
      .map((category) => ({ category, hours: counts.get(category.id)! })),
    untagged,
    done,
    open: elapsed - doneElapsed,
    elapsed,
  };
}
