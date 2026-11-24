import { StyleSheet, Text, View } from 'react-native';

import { categoryShort } from '@hissypad/core/hours';
import { daySlots, hourLabel, slotState, type DayKey } from '@hissypad/core/hours';
import type { Summary } from '@hissypad/core/hours';

import { hourBox, Mark, type HourCell } from './Mark';
import { serif, useTheme } from './theme';

type Props = {
  day: DayKey;
  // The hour the day starts at: the strip runs from it for 24 hours.
  start: number;
  now: Date;
  // Each hour as its box is drawn, by hour of the day.
  cells: Record<number, HourCell>;
  summary: Summary;
};

const plural = (n: number) => (n === 1 ? 'hour' : 'hours');
const hours = (n: number) => `${n}h`;

// The day in words: how many of its hours are marked done, and the done hours by category.
// Nothing on screen says this (2026-11-23, Kevin: the strip alone, no text under it), so it
// is the strip's name for a screen reader.
export function stripWords(summary: Summary): string {
  const count =
    summary.elapsed === 0
      ? summary.done > 0
        ? `${summary.done} ${plural(summary.done)} done ahead of time.`
        : 'This day has not started.'
      : summary.done === 0
        ? 'No hour of this day is marked done yet.'
        : `${summary.elapsed - summary.open} of ${summary.elapsed} ${plural(summary.elapsed)} done.`;
  const parts = summary.byCategory.map(({ category, hours: n }) => `${categoryShort(category)} ${hours(n)}`);
  if (summary.untagged > 0) parts.push(`Untagged ${hours(summary.untagged)}`);
  if (summary.open > 0) parts.push(`Not done ${hours(summary.open)}`);
  return [count, parts.length ? `${parts.join('; ')}.` : ''].filter(Boolean).join(' ');
}

// The whole day at a glance: 24 boxes, from the day's start hour around the clock. A box
// is solid once its hour is done, an outline around a core while it is being done, a
// colored outline when something is in it, and a thin grey one when it is empty (see
// Mark). A bar under a box marks the hour in progress. Under it, only the four hour ticks.
export function DayStrip({ day, start, now, cells, summary }: Props) {
  const theme = useTheme();

  return (
    <View>
      <View style={styles.strip} role="img" aria-label={stripWords(summary)}>
        {daySlots(day, start).map((slot) => {
          const { hour } = slot;
          const state = slotState(slot.day, hour, now);
          return (
            <View key={hour} style={styles.slot}>
              <Mark style={styles.cell} {...hourBox(cells[hour], theme.ink)} faint={state === 'future'} />
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
