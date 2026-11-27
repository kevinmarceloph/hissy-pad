import { slotKey, slotProgress, type NodeRow, type Rows, type SlotCount } from '@hissypad/core';
import { findCategory, type Category } from '@hissypad/core/hours';
import type { DayKey } from '@hissypad/core/hours';
import { hourShown, type Entry, type HourShown } from '@hissypad/core/hours';
import { recurringAt, type RecurringPlan } from '@hissypad/core/hours';

import type { HourCell } from './Mark';
import type { Theme } from './theme';

// One hour as a screen draws it.
export type DrawnHour = {
  // The calendar slot, never the day as drawn.
  day: DayKey;
  hour: number;
  // The line on top of the hour's list, and how many more of its own lines follow.
  top: NodeRow | undefined;
  more: number;
  // Its own lines, crossed out and open: the row says "1/3".
  count: SlotCount;
  // What its row says: the first line's words, category and state, or what an hour with
  // no lines falls back on (hourShown).
  says: HourShown;
  // Its box in a strip of hours.
  cell: HourCell;
};

// Every hour of a day on the screen, from the pad's lines, the recurring plans, the
// category list and what is stored on the hour from before 2026-11-27 (`byHour`, by hour
// of the day; read only). The day screen and the hour picker both draw from this, so an
// hour looks the same in both.
export function drawHours(
  slots: readonly { day: DayKey; hour: number }[],
  byHour: Record<number, Entry>,
  recurring: RecurringPlan[],
  all: Rows,
  categories: Category[],
  palette: Theme['palette'],
): DrawnHour[] {
  return slots.map(({ day, hour }) => {
    const { top, more, count } = slotProgress(all, slotKey(day, hour));
    const says = hourShown(top, more, recurringAt(recurring, day, hour), byHour[hour]);
    const category = findCategory(categories, says.category);
    const cell: HourCell = {
      state: says.state,
      color: category ? palette[category.color] : null,
      icon: category?.icon || null,
      any: says.from !== null,
    };
    return { day, hour, top, more, count, says, cell };
  });
}
