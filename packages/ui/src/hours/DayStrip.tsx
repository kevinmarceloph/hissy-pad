import { StyleSheet, Text, View } from 'react-native';

import { findCategory, shortLabel, type Category } from '@hissypad/core/hours';
import { daySlots, hourLabel, slotState, type DayKey } from '@hissypad/core/hours';
import { isLogged, planState, type Entry } from '@hissypad/core/hours';
import type { Summary } from '@hissypad/core/hours';

import { Mark, planOutline } from './Mark';
import { serif, SMALL, useTheme } from './theme';

type Props = {
  day: DayKey;
  // The hour the day starts at: the strip runs from it for 24 hours.
  start: number;
  now: Date;
  byHour: Record<number, Entry>;
  summary: Summary;
  categories: Category[];
};

// The whole day at a glance: 24 cells, from the day's start hour around the clock. The outline of a cell is the
// plan for that hour and the fill is where it went (see Mark). A bar under a cell marks
// the hour in progress.
export function DayStrip({ day, start, now, byHour, summary, categories }: Props) {
  const theme = useTheme();
  const hours = (n: number) => `${n}h`;
  const { due, kept } = summary.plan;

  return (
    <View>
      <View
        style={styles.strip}
        role="img"
        aria-label={
          `${summary.logged} of 24 hours logged, ${summary.blank} blank so far` +
          (summary.planned > 0 ? `, ${summary.planned} planned` : '') +
          (due > 0 ? `, ${kept} of ${due} as planned` : '')
        }>
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

      <View style={styles.legend}>
        {summary.byCategory.map(({ category, hours: n, planned }) => (
          <View key={category.id} style={styles.legendItem}>
            <Mark
              style={styles.swatch}
              fill={n > 0 ? theme.palette[category.color] : null}
              outline={theme.palette[category.color]}
              kept
            />
            <Text style={[styles.legendText, { color: theme.inkSoft }]}>
              {shortLabel(category.label)} {n > 0 ? hours(n) : `${hours(planned)} planned`}
              {n > 0 && planned > 0 ? `, ${hours(planned)} planned` : ''}
            </Text>
          </View>
        ))}
        {summary.untagged > 0 && (
          <View style={styles.legendItem}>
            <Mark style={styles.swatch} fill={theme.ink} />
            <Text style={[styles.legendText, { color: theme.inkSoft }]}>Untagged {hours(summary.untagged)}</Text>
          </View>
        )}
        {summary.blank > 0 && (
          <View style={styles.legendItem}>
            <Mark style={styles.swatch} />
            <Text style={[styles.legendText, { color: theme.inkSoft }]}>Blank {hours(summary.blank)}</Text>
          </View>
        )}
      </View>

      {/* Always here, so the rows below do not jump when the first plan is written. */}
      <Text style={[styles.key, { color: theme.inkSoft }]}>
        Outline: the plan. Fill: what happened. An outline around a different fill: an hour that went elsewhere.
      </Text>
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
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4, marginTop: 10, minHeight: 20 },
  // A long name wraps inside its item instead of running off the screen.
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  legendText: { fontFamily: serif, fontSize: SMALL, lineHeight: 20, flexShrink: 1 },
  swatch: { width: 12, height: 12 },
  key: { fontFamily: serif, fontSize: SMALL, lineHeight: 20, marginTop: 6 },
});
