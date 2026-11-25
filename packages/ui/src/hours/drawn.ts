import { slotKey, slotProgress, type NodeRow, type Rows, type SlotCount } from '@hissypad/core';
import { findCategory, type Category } from '@hissypad/core/hours';
import type { DayKey } from '@hissypad/core/hours';
import { hourShown, hourState, type Entry, type HourShown } from '@hissypad/core/hours';
import { recurringAt, withRecurring, type RecurringPlan } from '@hissypad/core/hours';

import type { HourCell } from './Mark';
import type { Theme } from './theme';

// One hour as a screen draws it.
export type DrawnHour = {
  // The calendar slot, never the day as drawn.
  day: DayKey;
  hour: number;
  // The recurring plan that covers the hour, pinned into it by its first write.
  plan: RecurringPlan | undefined;
  // The stored hour with that plan, where it has none stored: what is drawn and edited.
  entry: Entry | undefined;
  // The line on top of the hour's list, and what its row counts.
  top: NodeRow | undefined;
  count: SlotCount;
  says: HourShown;
  // Its box in a strip of hours.
  cell: HourCell;
};

// Every hour of a day on the screen, from what is stored (`byHour`, by hour of the day),
// the recurring plans, the pad's lines and the category list. The day screen and the hour
// picker both draw from this, so an hour looks the same in both.
export function drawHours(
  slots: readonly { day: DayKey; hour: number }[],
  byHour: Record<number, Entry>,
  recurring: RecurringPlan[],
  all: Rows,
  categories: Category[],
  palette: Theme['palette'],
): DrawnHour[] {
  return slots.map(({ day, hour }) => {
    const plan = recurringAt(recurring, day, hour);
    const entry = withRecurring(byHour[hour], plan, day, hour);
    const { top, count } = slotProgress(all, slotKey(day, hour));
    const says = hourShown(entry, top);
    const category = findCategory(categories, says.category);
    const cell: HourCell = {
      state: hourState(entry),
      color: category ? palette[category.color] : null,
      icon: category?.icon || null,
      any: says.from !== null || says.category !== null,
    };
    return { day, hour, plan, entry, top, count, says, cell };
  });
}
