import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { slotKey, slotProgress, unscheduledCount, type TodayPart } from '@hissypad/core';
import { dayDate, dayKey, dayTitle, fromDayKey, hourLabel, hourShown, recurringAt, shiftDay, type Slot } from '@hissypad/core/hours';
import { usePad } from '@hissypad/state';

import { Chevron } from './DayScreen';
import { HostedLines, PartLines } from './HostedLines';
import { useDay, useRecurring } from './provider';
import { Tap } from './Tap';
import { GUTTER, LINE, MAX_WIDTH, ROW, serif, SIZE, SMALL, useTheme } from './theme';

// The clock is a prop so tests can pin it; the app re-reads the real one every half
// minute, so the screen moves on to the next hour by itself.
const realClock = () => new Date();
function useNow(clock: () => Date): Date {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 30_000);
    return () => clearInterval(timer);
  }, [clock]);
  return now;
}

// The calendar slot `by` hours from another, over midnight too.
function stepSlot(slot: Slot, by: number): Slot {
  const at = fromDayKey(slot.day);
  at.setHours(slot.hour + by);
  return { day: dayKey(at), hour: at.getHours() };
}
export const sameSlot = (a: Slot, b: Slot) => a.day === b.day && a.hour === b.hour;
export const slotNow = (now: Date): Slot => ({ day: dayKey(now), hour: now.getHours() });

type Props = {
  // The hour on screen, a calendar slot; null follows the clock.
  at: Slot | null;
  clock?: (() => Date) | undefined;
  // The hour line: out to the list of every hour.
  onList(): void;
  // Another hour (null: back to the one the clock is in).
  onGo(slot: Slot | null): void;
  // Today's own lines ("Unscheduled") or its lines with an hour ("Schedule").
  onPart(part: TodayPart): void;
};

// Hours' home (Kevin, 2026-11-27, round 4: "focus mode"): one hour, and nothing of the
// day around it. Top to bottom: the hour line (a tap goes to the list of every hour, and a
// tap on an hour there comes back here on it), the hour's pad with its foot (find, the
// count, the lines done in it, Fresh start), the hours before and after with the start of
// what each holds, then the ways to Today's two sections.
export function FocusScreen({ at, clock = realClock, onList, onGo, onPart }: Props) {
  const theme = useTheme();
  const now = useNow(clock);
  const start = useDay((s) => s.start);
  const recurring = useRecurring((s) => s.list);
  const all = usePad((s) => s.all);

  const current = slotNow(now);
  const slot = at ?? current;
  const isNow = sameSlot(slot, current);
  const label = hourLabel(slot.hour);
  // The day as Hours draws it: an hour before the day start belongs to the day before.
  const day = slot.hour < start ? shiftDay(slot.day, -1) : slot.day;
  const title = dayTitle(day, now, start);
  const date = dayDate(day);
  // What the hour line says beside the hour (Kevin, 2026-11-27): "Right now"; for another
  // hour of the day the clock is in, how far off it is ("2 hours ago", "In 3 hours"); for
  // an hour of another day, the day ("Yesterday", "Tomorrow", or its date).
  const at0 = fromDayKey(slot.day);
  at0.setHours(slot.hour);
  const from = fromDayKey(current.day);
  from.setHours(current.hour);
  const away = Math.round((at0.getTime() - from.getTime()) / 3_600_000);
  const hours = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`;
  const when = isNow ? 'Right now' : title === 'Today' ? (away < 0 ? `${hours(-away)} ago` : `In ${hours(away)}`) : title;

  // What an hour beside this one holds, cut to a line: its first line, or its recurring plan.
  const says = (s: Slot) => {
    const { top, more } = slotProgress(all, slotKey(s.day, s.hour));
    return hourShown(top, more, recurringAt(recurring, s.day, s.hour)).title;
  };
  const before = stepSlot(slot, -1);
  const after = stepSlot(slot, 1);
  const go = (to: Slot) => onGo(sameSlot(to, slotNow(clock())) ? null : to);
  const waiting = unscheduledCount(all);

  return (
    <View style={[styles.screen, { backgroundColor: theme.paper }]}>
      <View style={styles.column}>
        <Tap
          aria-label={`${label}, ${when === date ? date : `${when}, ${date}`}. Show every hour`}
          onPress={onList}
          style={styles.head}
          activeStyle={{ backgroundColor: theme.paperRaised }}>
          <Text style={[styles.hour, { color: isNow ? theme.accent : theme.ink }]}>{label}</Text>
          <View style={styles.when}>
            <Text numberOfLines={1} style={[styles.day, { color: theme.ink }]}>
              {when}
            </Text>
            <Text numberOfLines={1} style={[styles.date, { color: theme.inkSoft }]}>
              {date}
            </Text>
          </View>
          <ListIcon color={theme.inkSoft} />
        </Tap>

        <ScrollView role="main" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.body}>
          <View style={[styles.pad, { borderColor: theme.rule }]}>
            {/* A new hour is a new pad: its own done list, closed. */}
            <HostedLines key={slotKey(slot.day, slot.hour)} day={slot.day} hour={slot.hour} roomy />
          </View>

          <View role="navigation" aria-label="Hours" style={styles.nav}>
            <Tap aria-label={`Previous hour, ${hourLabel(before.hour)}${says(before) ? `: ${says(before)}` : ''}`} onPress={() => go(before)} style={styles.step} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Chevron color={theme.inkSoft} />
              <Text style={[styles.small, { color: theme.inkSoft }]}>{hourLabel(before.hour)}</Text>
              <Text numberOfLines={1} style={[styles.small, styles.cut, { color: theme.inkQuiet }]}>
                {says(before)}
              </Text>
            </Tap>
            {!isNow && (
              <Tap aria-label="Back to the hour it is now" onPress={() => onGo(null)} style={styles.nowLink} activeStyle={{ backgroundColor: theme.paperRaised }}>
                <Text style={[styles.small, { color: theme.accent, fontWeight: '700' }]}>Right now</Text>
              </Tap>
            )}
            <Tap aria-label={`Next hour, ${hourLabel(after.hour)}${says(after) ? `: ${says(after)}` : ''}`} onPress={() => go(after)} style={[styles.step, styles.stepNext]} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Text numberOfLines={1} style={[styles.small, styles.cut, styles.right, { color: theme.inkQuiet }]}>
                {says(after)}
              </Text>
              <Text style={[styles.small, { color: theme.inkSoft }]}>{hourLabel(after.hour)}</Text>
              <Chevron color={theme.inkSoft} forward />
            </Tap>
          </View>

          <View style={[styles.links, { borderTopColor: theme.rule }]}>
            <Tap aria-label={`Unscheduled: ${waiting} ${waiting === 1 ? 'line' : 'lines'} of Today with no hour`} onPress={() => onPart('own')} style={[styles.linkBox, { borderColor: theme.line }]} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Text style={[styles.link, { color: theme.ink }]}>Unscheduled</Text>
              <Text style={[styles.count, { color: waiting > 0 ? theme.ink : theme.inkQuiet }]}>{waiting}</Text>
            </Tap>
            <Tap aria-label="Schedule: Today's lines with an hour" onPress={() => onPart('scheduled')} style={[styles.linkBox, { borderColor: theme.line }]} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Text style={[styles.link, { color: theme.ink }]}>Schedule</Text>
              <Chevron color={theme.inkSoft} forward />
            </Tap>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

type PartProps = { part: TodayPart; onBack(): void };

// One of Today's two sections, inside Hours: "its version of the Today pad". Unscheduled is
// Today's own lines, pins included; Schedule is its lines with an hour, in hour order (for
// now the same thing the list of hours shows, another way: Kevin is weighing the two).
// The host's own pad editor draws it, so every pad command works.
export function PartScreen({ part, onBack }: PartProps) {
  const theme = useTheme();
  const name = part === 'own' ? 'Unscheduled' : 'Schedule';
  return (
    <View style={[styles.screen, { backgroundColor: theme.paper }]}>
      <View style={styles.column}>
        <Tap aria-label={`${name}. Back to the hour`} onPress={onBack} style={styles.head} activeStyle={{ backgroundColor: theme.paperRaised }}>
          <View style={styles.back}>
            <Chevron color={theme.inkSoft} />
          </View>
          <View style={styles.when}>
            <Text role="heading" aria-level={1} style={[styles.day, { color: theme.ink }]}>
              {name}
            </Text>
            <Text numberOfLines={1} style={[styles.date, { color: theme.inkSoft }]}>
              {part === 'own' ? 'Today, with no hour yet' : 'Today, by the hour'}
            </Text>
          </View>
        </Tap>
        <ScrollView role="main" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.body}>
          <PartLines part={part} />
        </ScrollView>
      </View>
    </View>
  );
}

// Three lines with a dot before each: a list. Drawn with Views, like the other icons here.
function ListIcon({ color }: { color: string }) {
  return (
    <View style={{ gap: 3.5 }}>
      {[0, 1, 2].map((n) => (
        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: color }} />
          <View style={{ width: 12, height: 1.5, borderRadius: 1, backgroundColor: color }} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingHorizontal: GUTTER },
  // The hour line: the hour large, the day beside it, and the list it leads to at the right.
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 4, borderRadius: 4 },
  hour: { fontFamily: serif, fontSize: 30, lineHeight: 38, fontWeight: '700', fontVariant: ['tabular-nums'] },
  when: { flex: 1 },
  day: { fontFamily: serif, fontSize: SIZE, lineHeight: 22, fontWeight: '700' },
  date: { fontFamily: serif, fontSize: SMALL, lineHeight: 18 },
  back: { width: 28, alignItems: 'center' },
  // Room under the last control for the pad's toolbar and floating buttons.
  body: { paddingTop: 4, paddingBottom: 200 },
  pad: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingBottom: 4 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: ROW, marginTop: 4 },
  step: { flex: 1, minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, borderRadius: 4 },
  stepNext: { justifyContent: 'flex-end' },
  cut: { flexShrink: 1 },
  right: { textAlign: 'right' },
  nowLink: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 4 },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  links: { flexDirection: 'row', gap: 10, marginTop: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  linkBox: { flex: 1, minHeight: ROW, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, borderWidth: 1, borderRadius: 4 },
  link: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  count: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, fontVariant: ['tabular-nums'] },
});
