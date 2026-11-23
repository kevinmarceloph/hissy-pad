import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CHIME_CHOICES, chimesSpoken, minuteLabel, toggleChime } from '@hissypad/core/hours';
import { dayDate, dayOf, daySlots, dayTitle, hourLabel, HOURS, shiftDay, slotState } from '@hissypad/core/hours';
import { toggleDone, type Deed, type Entry, type EntryPatch } from '@hissypad/core/hours';
import { pinRecurring, recurringAt, withRecurring } from '@hissypad/core/hours';
import { summarize } from '@hissypad/core/hours';
import { useCategories, useChimes, useDay, useFlags, useRecurring, useSync } from './provider';
import { slotCounts, slotKey } from '@hissypad/core';
import { usePad } from '@hissypad/state';
import { getChimePlatform } from '@hissypad/state/hours';

import { DayStrip } from './DayStrip';
import { HourRow } from './HourRow';
import { PullIndicator, useRefreshControl } from './PullRefresh';
import { Tap } from './Tap';
import { GUTTER, LINE, MAX_WIDTH, ROW, serif, SIZE, SMALL, useTheme } from './theme';

// The clock is a prop so tests can pin it; the app uses the real one, re-read every
// half minute so the "now" row moves on its own.
function useNow(clock: () => Date): Date {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const timer = setInterval(() => setNow(clock()), 30_000);
    return () => clearInterval(timer);
  }, [clock]);
  return now;
}

const realClock = () => new Date();

// On a phone the strip and the day's count scroll away with the hours: fixed above the
// list they left about three rows between themselves and the keyboard (seen in the
// simulator, 2026-11-23). In a browser they stay put, as in Oras-oras.
const SUMMARY_SCROLLS = Platform.OS !== 'web';

type Props = {
  clock?: (() => Date) | undefined;
  onEditCategories?: (() => void) | undefined;
  onEditFlags?: (() => void) | undefined;
  onEditPlans?: (() => void) | undefined;
  // Leaves Hours for the pad.
  onClose?: (() => void) | undefined;
};

export function DayScreen({ clock = realClock, onEditCategories, onEditFlags, onEditPlans, onClose }: Props) {
  const theme = useTheme();
  const now = useNow(clock);

  const day = useDay((s) => s.day);
  const start = useDay((s) => s.start);
  const setStart = useDay((s) => s.setStart);
  const today = dayOf(now, start);
  const status = useDay((s) => s.status);
  const error = useDay((s) => s.error);
  const byHour = useDay((s) => s.byHour);
  const open = useDay((s) => s.open);
  const save = useDay((s) => s.save);
  const categories = useCategories((s) => s.list);
  const flags = useFlags((s) => s.list);
  const recurring = useRecurring((s) => s.list);
  // Pulling the hours down syncs now and re-reads the day, signed in or not.
  const { syncNow } = useSync();
  // The pad's lines assigned to an hour, counted by slot across every pad.
  const all = usePad((s) => s.all);
  const counts = slotCounts(all);
  const refreshDay = useDay((s) => s.refresh);
  const pulled = async () => {
    await syncNow();
    await refreshDay();
  };
  const refreshControl = useRefreshControl(pulled);

  const [editing, setEditing] = useState<number | null>(null);
  // What a tap on an hour's box took away, by calendar slot, until the app closes: the next
  // tap on that box puts it back as it was.
  const [taken, setTaken] = useState<Record<string, Deed>>({});
  const remember = (slot: string, deed: Deed | undefined) =>
    setTaken((before) => {
      if (!deed && !(slot in before)) return before;
      const { [slot]: _gone, ...rest } = before;
      return deed ? { ...rest, [slot]: deed } : rest;
    });
  const list = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    void open(day);
    // Load once on mount; day changes go through go().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Today opens with the current hour in view instead of at midnight.
  // On a phone the summary scrolls with the hours (see SUMMARY_SCROLLS), so the hours start
  // below it: its height is added once it has been measured.
  const summaryHeight = useRef(0);
  const placedFor = useRef<string | null>(null);
  const place = () => {
    const rows = day === today ? Math.max(0, ((now.getHours() - start + 24) % 24) - 2) * ROW : 0;
    const y = SUMMARY_SCROLLS ? (rows > 0 ? rows + summaryHeight.current : 0) : rows;
    list.current?.scrollTo({ y, animated: false });
  };
  useEffect(() => {
    if (status !== 'ready') return;
    if (SUMMARY_SCROLLS) placedFor.current = null; // placed when the summary is measured
    else place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, day, start]);

  const go = (to: string) => {
    setEditing(null);
    void open(to);
  };

  // Each hour as the screen shows it: its own plan, or the recurring plan that covers it.
  // `byHour` stays what is stored; `shown` is what is drawn, counted and edited.
  const slots = daySlots(day, start).map((slot) => ({ ...slot, plan: recurringAt(recurring, slot.day, slot.hour) }));
  const shown: Record<number, Entry> = {};
  for (const { day: on, hour, plan } of slots) {
    const entry = withRecurring(byHour[hour], plan, on, hour);
    if (entry) shown[hour] = entry;
  }

  const summary = summarize(Object.values(shown), day, now, categories, start);
  const accounted = summary.elapsed - summary.blank;
  const { due, kept } = summary.plan;

  // The strip, its key and the day's count. Only drawn once the day is read.
  const summaryBlock = (
    <View
      style={styles.summary}
      onLayout={(e) => {
        summaryHeight.current = e.nativeEvent.layout.height;
        const key = `${day}:${start}`;
        if (SUMMARY_SCROLLS && placedFor.current !== key) {
          placedFor.current = key;
          place();
        }
      }}>
      <DayStrip day={day} start={start} now={now} byHour={shown} summary={summary} categories={categories} />
      {/* One paragraph, two sentences: how much of the day is written down, and how
          much of the plan held. */}
      <Text style={[styles.count, { color: theme.inkSoft }]}>
        <Text>
          {summary.elapsed === 0
            ? summary.planned > 0
              ? `${summary.planned} ${plural(summary.planned)} planned.`
              : summary.logged > 0
                ? `${summary.logged} ${plural(summary.logged)} logged ahead of time.`
                : 'This day has not started. You can plan it: tap an hour.'
            : summary.logged === 0
              ? 'Nothing logged for this day yet. Tap an hour and say where it went.'
              : `${accounted} of ${summary.elapsed} ${plural(summary.elapsed)} accounted for.`}
        </Text>
        {due > 0 && ' '}
        {due > 0 && (
          <Text>
            {kept} of {due} planned {plural(due)} went as planned.
          </Text>
        )}
      </Text>
      {error && (
        <Text role="alert" style={[styles.count, { color: theme.accent }]}>
          That change was not saved and has been undone: {error}
        </Text>
      )}
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.paper }]}>
      <View style={styles.column}>
        <View role="banner" style={styles.header}>
          <View style={styles.titleRow}>
            <Text role="heading" aria-level={1} style={[styles.title, { color: theme.ink }]}>
              {dayTitle(day, now, start)}
            </Text>
            <Text style={[styles.date, { color: theme.inkSoft }]}>{dayDate(day)}</Text>
            {onClose && (
              <Tap role="link" aria-label="Back to the pad" onPress={onClose} style={[styles.navButton, styles.close]} activeStyle={{ backgroundColor: theme.paperRaised }}>
                <Text style={[styles.navText, { color: theme.ink }]}>Pad</Text>
              </Tap>
            )}
          </View>
          <View role="navigation" aria-label="Days" style={styles.nav}>
            <Tap onPress={() => go(shiftDay(day, -1))} style={styles.navButton} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Text style={[styles.navText, { color: theme.ink }]}>Earlier</Text>
            </Tap>
            <Tap onPress={() => go(shiftDay(day, 1))} style={styles.navButton} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Text style={[styles.navText, { color: theme.ink }]}>Later</Text>
            </Tap>
            {day !== today && (
              <Tap onPress={() => go(today)} style={styles.navButton} activeStyle={{ backgroundColor: theme.paperRaised }}>
                <Text style={[styles.navText, { color: theme.accent }]}>Back to today</Text>
              </Tap>
            )}
          </View>
        </View>

        {status === 'loading' && (
          <Text aria-live="polite" style={[styles.status, { color: theme.inkSoft }]}>
            Opening {dayDate(day)}.
          </Text>
        )}

        {status === 'error' && (
          <View role="alert" style={styles.problem}>
            <Text style={[styles.status, { color: theme.ink }]}>
              Could not read {dayDate(day)}: {error}
            </Text>
            <Tap onPress={() => go(day)} style={[styles.retry, { borderColor: theme.ink }]} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Text style={[styles.navText, { color: theme.ink }]}>Try again</Text>
            </Tap>
          </View>
        )}

        {status === 'ready' && (
          <>
            {!SUMMARY_SCROLLS && summaryBlock}

            <PullIndicator list={list} onRefresh={pulled} />
            <ScrollView
              ref={list}
              role="main"
              refreshControl={refreshControl}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={styles.list}>
              {SUMMARY_SCROLLS && summaryBlock}
              {slots.map(({ day: on, hour, plan }) => {
                const slot = `${on}T${hour}`;
                const state = slotState(on, hour, now);
                // Only an hour that has started can be marked done.
                const mark = state === 'future' ? null : toggleDone(shown[hour], taken[slot]);
                // The first write to an hour pins the recurring plan it was showing.
                const write = (patch: EntryPatch) => void save(hour, pinRecurring(patch, byHour[hour], plan));
                return (
                  <HourRow
                    key={`${day}-${hour}`}
                    day={on}
                    hour={hour}
                    count={counts[slotKey(on, hour)]}
                    entry={shown[hour]}
                    recurring={shown[hour] !== byHour[hour]}
                    state={state}
                    open={editing === hour}
                    categories={categories}
                    flags={flags}
                    onEditFlags={onEditFlags}
                    onOpen={() => setEditing(hour)}
                    onClose={() => setEditing(null)}
                    onSave={(patch) => {
                      // An edit made by hand is newer than anything a tap took away.
                      remember(slot, undefined);
                      write(patch);
                    }}
                    onMark={
                      mark
                        ? () => {
                            remember(slot, mark.taken);
                            write(mark.patch);
                          }
                        : undefined
                    }
                  />
                );
              })}
              <Footer
                start={start}
                onStart={(hour) => void setStart(hour)}
                onEditCategories={onEditCategories}
                onEditFlags={onEditFlags}
                onEditPlans={onEditPlans}
              />
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

const plural = (n: number) => (n === 1 ? 'hour' : 'hours');

type FooterProps = Pick<Props, 'onEditCategories' | 'onEditFlags' | 'onEditPlans'> & {
  start: number;
  onStart(hour: number): void;
};

// Everything under the hours: the ways out to the other screens, then where the log lives
// right now. Two lines of buttons: the three lists that are the user's own (categories,
// flags, recurring plans), then the device's settings. The account is the pad's.
function Footer({ start, onStart, onEditCategories, onEditFlags, onEditPlans }: FooterProps) {
  const theme = useTheme();
  const sync = useSync();
  const chimesNeedThePageOpen = getChimePlatform()?.needsPageOpen ?? false;
  const soundChime = getChimePlatform()?.sound ?? null;
  const chimes = useChimes((s) => s.minutes);
  const chimesSupported = useChimes((s) => s.supported);
  const chimeOutcome = useChimes((s) => s.outcome);
  const setChimes = useChimes((s) => s.set);
  const [settings, setSettings] = useState(false);

  const link = (name: string, label: string, onPress: () => void) => (
    <Tap
      role="link"
      aria-label={name}
      onPress={onPress}
      style={[styles.retry, styles.footerButton, { borderColor: theme.ink }]}
      activeStyle={{ backgroundColor: theme.paperRaised }}>
      <Text style={[styles.footerText, { color: theme.ink }]}>{label}</Text>
    </Tap>
  );

  return (
    <View style={styles.footer}>
      <View style={styles.footerButtons}>
        {onEditCategories && link('Edit categories', 'Categories', onEditCategories)}
        {onEditFlags && link('Edit flags', 'Flags', onEditFlags)}
        {onEditPlans && link('Edit recurring plans', 'Recurring plans', onEditPlans)}
      </View>
      <View style={styles.footerButtons}>
        <Tap
          aria-expanded={settings}
          aria-label="Settings"
          onPress={() => setSettings(!settings)}
          style={[styles.retry, styles.footerButton, { borderColor: theme.ink }]}
          activeStyle={{ backgroundColor: theme.paperRaised }}>
          <Text style={[styles.footerText, { color: theme.ink }]}>Settings</Text>
        </Tap>
      </View>
      {settings && (
        <View style={styles.settings}>
          <View style={styles.setting}>
            <Text role="heading" aria-level={2} style={[styles.settingTitle, { color: theme.ink }]}>
              Day starts at {hourLabel(start)}
            </Text>
            <Text style={[styles.count, { color: theme.inkSoft }]}>
              A day runs from this hour to the same hour the next day.
            </Text>
            <View role="radiogroup" aria-label="Day starts at" style={styles.choices}>
              {HOURS.map((hour) => {
                const on = hour === start;
                return (
                  <Tap
                    key={hour}
                    role="radio"
                    aria-checked={on}
                    aria-label={hourLabel(hour)}
                    onPress={() => {
                      // The hours above are about to be redrawn; the choice is made.
                      setSettings(false);
                      onStart(hour);
                    }}
                    style={[styles.choice, { borderColor: on ? theme.ink : theme.line }, on && { backgroundColor: theme.ink }]}
                    activeStyle={{ borderColor: theme.ink }}>
                    <Text style={[styles.count, { color: on ? theme.paper : theme.ink }, on && { fontWeight: '700' }]}>
                      {hourLabel(hour)}
                    </Text>
                  </Tap>
                );
              })}
            </View>
          </View>
          {chimesSupported && (
            <View style={styles.setting}>
              <Text role="heading" aria-level={2} style={[styles.settingTitle, { color: theme.ink }]}>
                {chimesSpoken(chimes)}
              </Text>
              <Text style={[styles.count, { color: theme.inkSoft }]}>
                Minutes past every hour to chime. Pick as many as you like.
                {chimesNeedThePageOpen ? ' A browser can only chime while this page is open.' : ''}
              </Text>
              <View role="group" aria-label="Chime at" style={styles.choices}>
                {CHIME_CHOICES.map((minute) => {
                  const on = chimes.includes(minute);
                  return (
                    <Tap
                      key={minute}
                      role="checkbox"
                      aria-checked={on}
                      aria-label={minuteLabel(minute)}
                      onPress={() => void setChimes(toggleChime(chimes, minute))}
                      style={[styles.choice, { borderColor: on ? theme.ink : theme.line }, on && { backgroundColor: theme.ink }]}
                      activeStyle={{ borderColor: theme.ink }}>
                      <Text style={[styles.count, { color: on ? theme.paper : theme.ink }, on && { fontWeight: '700' }]}>
                        {on ? '\u2713 ' : ''}
                        {minuteLabel(minute)}
                      </Text>
                    </Tap>
                  );
                })}
              </View>
              {chimeOutcome === 'sound' && (
                <Text role="status" style={[styles.count, { color: theme.inkSoft }]}>
                  This browser is not showing notifications for HissyPad, so a chime is a sound only.
                </Text>
              )}
              {chimeOutcome === 'denied' && (
                <Text role="alert" style={[styles.count, { color: theme.accent }]}>
                  Notifications are turned off for HissyPad. Allow them in Settings, then try again.
                </Text>
              )}
              {soundChime && (
                <Tap
                  onPress={soundChime}
                  style={[styles.retry, styles.footerButton, styles.hear, { borderColor: theme.ink }]}
                  activeStyle={{ backgroundColor: theme.paperRaised }}>
                  <Text style={[styles.footerText, { color: theme.ink }]}>Hear it</Text>
                </Tap>
              )}
            </View>
          )}
        </View>
      )}
      <Text role="status" style={[styles.count, { color: theme.inkSoft }]}>
        {sync.line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingHorizontal: GUTTER },
  header: { paddingTop: 20, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 12 },
  title: { fontFamily: serif, fontSize: 32, lineHeight: 40, fontWeight: '700' },
  date: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  nav: { flexDirection: 'row', flexWrap: 'wrap', marginLeft: -10 },
  navButton: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 4 },
  close: { marginLeft: 'auto' },
  navText: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  status: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, marginTop: 24 },
  problem: { alignItems: 'flex-start', gap: 12 },
  retry: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 4 },
  summary: { marginTop: 12, paddingBottom: 12, gap: 8 },
  count: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  list: { paddingBottom: 48 },
  footer: { marginTop: 32, gap: 8 },
  // Each line of buttons has to fit a phone's width, so the type is the small size, and
  // the day start and the chimes share the one Settings button.
  footerButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  footerButton: { paddingHorizontal: 10 },
  footerText: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  settings: { gap: 20, marginTop: 4 },
  setting: { gap: 8 },
  settingTitle: { fontFamily: serif, fontSize: SMALL, lineHeight: 20, fontWeight: '700' },
  hear: { alignSelf: 'flex-start' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { minWidth: 56, minHeight: ROW, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 4 },
});
