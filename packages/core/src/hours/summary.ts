import { sortCategories, type Category } from './categories';
import { DAY_START_DEFAULT, elapsedHours, slotDay, slotState, type DayKey } from './day';
import { hasPlan, isLogged, planState, type Entry } from './entry';

export type Summary = {
  // Hours per category, in the user's category order: `hours` is where the day went,
  // `planned` where it was meant to go. Categories with neither are left out. Archived
  // categories still count: the hours were spent.
  byCategory: { category: Category; hours: number; planned: number }[];
  // Hours with a note but no category, or a category this device does not know.
  untagged: number;
  logged: number;
  // Hours that are over and have nothing written: the part of the day that got away.
  blank: number;
  elapsed: number;
  // Hours with a plan, whether or not they have happened yet.
  planned: number;
  // Hours planned for a category that can be judged: over, or already tagged. `kept` of
  // them went where the plan said. A plan that is words alone is never judged.
  plan: { due: number; kept: number };
};

// `day` is a day on the screen: with a day start other than midnight its last hours fall
// on the next calendar day (see daySlots).
export function summarize(
  entries: Entry[],
  day: DayKey,
  now: Date,
  categories: Category[],
  start: number = DAY_START_DEFAULT,
): Summary {
  const elapsed = elapsedHours(day, now, start);
  const known = new Set(categories.map((c) => c.id));
  const done = new Map<string, number>();
  const meant = new Map<string, number>();
  const bump = (counts: Map<string, number>, id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  let untagged = 0;
  let logged = 0;
  let loggedElapsed = 0;
  let planned = 0;
  let due = 0;
  let kept = 0;

  for (const entry of entries) {
    if (entry.day !== slotDay(day, entry.hour, start)) continue;
    const over = slotState(entry.day, entry.hour, now) === 'past';

    if (hasPlan(entry)) planned += 1;
    if (entry.planned !== null) {
      const state = planState(entry);
      if (known.has(entry.planned)) bump(meant, entry.planned);
      if (state !== 'open' || over) due += 1;
      if (state === 'kept') kept += 1;
    }

    if (!isLogged(entry)) continue;
    logged += 1;
    if (over) loggedElapsed += 1;
    if (entry.category === null || !known.has(entry.category)) untagged += 1;
    else bump(done, entry.category);
  }

  return {
    byCategory: sortCategories(categories)
      .filter((c) => done.has(c.id) || meant.has(c.id))
      .map((category) => ({
        category,
        hours: done.get(category.id) ?? 0,
        planned: meant.get(category.id) ?? 0,
      })),
    untagged,
    logged,
    blank: elapsed - loggedElapsed,
    elapsed,
    planned,
    plan: { due, kept },
  };
}
