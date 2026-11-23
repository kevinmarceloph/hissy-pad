import { StyleSheet, Text, View } from 'react-native';

import { categoryShort, findCategory, type Category } from '@hissypad/core/hours';
import { daySlots, hourLabel, slotState, type DayKey } from '@hissypad/core/hours';
import { isLogged, planState, type Entry } from '@hissypad/core/hours';
import type { Summary } from '@hissypad/core/hours';

import { Mark, planOutline } from './Mark';
import { serif, useTheme } from './theme';

type Props = {
  day: DayKey;
  // The hour the day starts at: the strip runs from it for 24 hours.
  start: number;
  now: Date;
  byHour: Record<number, Entry>;
  summary: Summary;
  categories: Category[];
};

const plural = (n: number) => (n === 1 ? 'hour' : 'hours');
const hours = (n: number) => `${n}h`;

// The day in words: how much of it is written down, how much of the plan held, and the
// hours by category. Nothing on screen says this any more (2026-11-23, Kevin: the strip
// alone, no text under it), so it is the strip's name for a screen reader.
export function stripWords(summary: Summary): string {
  const accounted = summary.elapsed - summary.blank;
  const { due, kept } = summary.plan;
  const count =
    summary.elapsed === 0
      ? summary.planned > 0
        ? `${summary.planned} ${plural(summary.planned)} planned.`
        : summary.logged > 0
          ? `${summary.logged} ${plural(summary.logged)} logged ahead of time.`
          : 'This day has not started.'
      : summary.logged === 0
        ? 'Nothing logged for this day yet.'
        : `${accounted} of ${summary.elapsed} ${plural(summary.elapsed)} accounted for.`;
  const parts = summary.byCategory.map(
    ({ category, hours: n, planned }) =>
      `${categoryShort(category)} ${n > 0 ? hours(n) : `${hours(planned)} planned`}${n > 0 && planned > 0 ? `, ${hours(planned)} planned` : ''}`,
  );
  if (summary.untagged > 0) parts.push(`Untagged ${hours(summary.untagged)}`);
  if (summary.blank > 0) parts.push(`Blank ${hours(summary.blank)}`);
  return [count, due > 0 ? `${kept} of ${due} planned ${plural(due)} went as planned.` : '', parts.length ? `${parts.join('; ')}.` : '']
    .filter(Boolean)
    .join(' ');
}

// The whole day at a glance: 24 cells, from the day's start hour around the clock. The
// outline of a cell is the plan for that hour and the fill is where it went (see Mark). A
// bar under a cell marks the hour in progress. Under it, only the four hour ticks.
export function DayStrip({ day, start, now, byHour, summary, categories }: Props) {
  const theme = useTheme();

  return (
    <View>
      <View style={styles.strip} role="img" aria-label={stripWords(summary)}>
        {daySlots(day, start).map((slot) => {
          const { hour } = slot;
          const entry = byHour[hour];
          const state = slotState(slot.day, hour, now);
          const done = findCategory(categories, entry?.category);
          const plan = findCategory(categories, entry?.planned);
          return (
            <View key={hour} style={styles.slot}>
              <Mark
                style={styles.cell}
                fill={isLogged(entry) ? (done ? theme.palette[done.color] : theme.ink) : null}
                outline={planOutline(entry, plan, isLogged(entry), theme)}
                kept={planState(entry) === 'kept'}
                faint={state === 'future'}
              />
              <View style={[styles.now, state === 'now' && { backgroundColor: theme.accent }]} />
            </View>
          );
        })}
      </View>
      <View style={styles.ticks}>
        {[0, 6, 12, 18].map((i) => hourLabel((start + i) % 24)).map((label) => (
          <Text key={label} style={[styles.tick, { color: theme.inkQuiet }]}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 2 },
  slot: { flex: 1, gap: 2 },
  cell: { height: 22 },
  now: { height: 3, borderRadius: 1.5 },
  ticks: { flexDirection: 'row', marginTop: 2 },
  tick: { flex: 1, fontFamily: serif, fontSize: 12, lineHeight: 16 },
});
