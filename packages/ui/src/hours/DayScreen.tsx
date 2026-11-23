import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CHIME_CHOICES, chimesSpoken, minuteLabel, toggleChime } from '@hissypad/core/hours';
import { dayDate, dayKey, dayOf, daySlots, dayTitle, fromDayKey, hourLabel, HOURS, shiftDay, slotState, type DayKey } from '@hissypad/core/hours';
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

// What is open over the hours: the calendar, the menu, or the settings the menu leads to.
type Panel = 'calendar' | 'menu' | 'settings';

type Props = {
  clock?: (() => Date) | undefined;
  onEditCategories?: (() => void) | undefined;
  onEditFlags?: (() => void) | undefined;
  onEditPlans?: (() => void) | undefined;
};

export function DayScreen({ clock = realClock, onEditCategories, onEditFlags, onEditPlans }: Props) {
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
  const [panel, setPanel] = useState<Panel | null>(null);
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

  // Today opens with the current hour at the top of the list, any other day at its first
  // hour. The list is padded underneath by its own height less one row, so even the last
  // hour of the day can sit at the top. The current hour's place is measured, not counted:
  // a row with several lines is taller than `ROW`.
  const [listHeight, setListHeight] = useState(0);
  const [nowAt, setNowAt] = useState<{ key: string; y: number } | null>(null);
  const placedFor = useRef<string | null>(null);
  const placeKey = `${day}:${start}`;
  useEffect(() => {
    if (status !== 'ready' || listHeight === 0 || placedFor.current === placeKey) return;
    if (day !== today) {
      placedFor.current = placeKey;
      list.current?.scrollTo({ y: 0, animated: false });
    } else if (nowAt?.key === placeKey) {
      placedFor.current = placeKey;
      list.current?.scrollTo({ y: nowAt.y, animated: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, placeKey, listHeight, nowAt]);

  const go = (to: string) => {
    setEditing(null);
    setPanel(null);
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

  const toggle = (which: Panel) => setPanel(panel === which || (which === 'menu' && panel === 'settings') ? null : which);
  const leave = (to: (() => void) | undefined) =>
    to &&
    (() => {
      setPanel(null);
      to();
    });

  return (
    <View style={[styles.screen, { backgroundColor: theme.paper }]}>
      <View style={styles.column}>
        {/* One line: earlier, the day, the calendar, later, and the menu at the far right. */}
        <View role="banner" style={styles.header}>
          <View role="navigation" aria-label="Days" style={styles.days}>
            <Tap aria-label="Earlier" onPress={() => go(shiftDay(day, -1))} style={styles.iconButton} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Chevron color={theme.ink} />
            </Tap>
            <View style={styles.titleRow}>
              <Text role="heading" aria-level={1} numberOfLines={1} style={[styles.title, { color: theme.ink }]}>
                {dayTitle(day, now, start)}
              </Text>
              {dayTitle(day, now, start) !== dayDate(day) && (
                <Text numberOfLines={1} style={[styles.date, { color: theme.inkSoft }]}>
                  {dayDate(day)}
                </Text>
              )}
            </View>
            <Tap
              aria-label="Pick a day"
              aria-expanded={panel === 'calendar'}
              onPress={() => toggle('calendar')}
              style={[styles.iconButton, panel === 'calendar' && { backgroundColor: theme.paperRaised }]}
              activeStyle={{ backgroundColor: theme.paperRaised }}>
              <CalendarIcon color={theme.ink} />
            </Tap>
            <Tap aria-label="Later" onPress={() => go(shiftDay(day, 1))} style={styles.iconButton} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Chevron color={theme.ink} forward />
            </Tap>
          </View>
          <Tap
            aria-label="Hours menu"
            aria-expanded={panel === 'menu' || panel === 'settings'}
            onPress={() => toggle('menu')}
            style={[styles.iconButton, (panel === 'menu' || panel === 'settings') && { backgroundColor: theme.paperRaised }]}
            activeStyle={{ backgroundColor: theme.paperRaised }}>
            <MenuIcon color={theme.ink} />
          </Tap>
        </View>

        <View style={styles.body}>
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
              {/* Always in view, above the hours. What it says in words is its label. */}
              <View style={styles.summary}>
                <DayStrip day={day} start={start} now={now} byHour={shown} summary={summary} categories={categories} />
                {error && (
                  <Text role="alert" style={[styles.count, { color: theme.accent }]}>
                    That change was not saved and has been undone: {error}
                  </Text>
                )}
              </View>

              <PullIndicator list={list} onRefresh={pulled} />
              <ScrollView
                ref={list}
                role="main"
                refreshControl={refreshControl}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                automaticallyAdjustKeyboardInsets
                onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}
                contentContainerStyle={{ paddingBottom: Math.max(48, listHeight - ROW) }}>
                {slots.map(({ day: on, hour, plan }) => {
                  const slot = `${on}T${hour}`;
                  const state = slotState(on, hour, now);
                  // Only an hour that has started can be marked done.
                  const mark = state === 'future' ? null : toggleDone(shown[hour], taken[slot]);
                  // The first write to an hour pins the recurring plan it was showing.
                  const write = (patch: EntryPatch) => void save(hour, pinRecurring(patch, byHour[hour], plan));
                  return (
                    <View
                      key={`${day}-${hour}`}
                      onLayout={
                        state === 'now' && day === today
                          ? (e) => {
                              const y = e.nativeEvent.layout.y;
                              setNowAt((before) => (before?.key === placeKey && before.y === y ? before : { key: placeKey, y }));
                            }
                          : undefined
                      }>
                      <HourRow
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
                    </View>
                  );
                })}
              </ScrollView>
            </>
          )}

          {/* The calendar and the menu open over the hours; a press outside closes them. */}
          {panel && <Pressable aria-hidden onPress={() => setPanel(null)} style={styles.away} />}
          {panel === 'calendar' && (
            <View style={[styles.panel, styles.calendar, { backgroundColor: theme.paperRaised, borderColor: theme.line }]}>
              <DayPicker day={day} today={today} onPick={go} />
            </View>
          )}
          {panel === 'menu' && (
            <Menu
              onEditCategories={leave(onEditCategories)}
              onEditFlags={leave(onEditFlags)}
              onEditPlans={leave(onEditPlans)}
              onSettings={() => setPanel('settings')}
            />
          )}
          {panel === 'settings' && (
            <View style={[styles.panel, styles.settingsPanel, { backgroundColor: theme.paperRaised, borderColor: theme.line }]}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.settings}>
                <Settings
                  start={start}
                  onStart={(hour) => {
                    // The hours are about to be redrawn; the choice is made.
                    setPanel(null);
                    void setStart(hour);
                  }}
                />
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ---- the header's icons, drawn with Views so both apps have them without an icon font ----

function Chevron({ color, forward = false }: { color: string; forward?: boolean }) {
  return (
    <View
      style={{
        width: 9,
        height: 9,
        borderColor: color,
        borderTopWidth: 1.5,
        borderLeftWidth: forward ? 0 : 1.5,
        borderRightWidth: forward ? 1.5 : 0,
        transform: [{ rotate: forward ? '45deg' : '-45deg' }],
        marginLeft: forward ? -4 : 4,
      }}
    />
  );
}

function CalendarIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 17, height: 16, borderWidth: 1.5, borderColor: color, borderRadius: 2.5 }}>
      <View style={{ height: 1.5, marginTop: 3, backgroundColor: color }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', marginTop: 2.5 }}>
        {[0, 1, 2].map((n) => (
          <View key={n} style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: color }} />
        ))}
      </View>
    </View>
  );
}

function MenuIcon({ color }: { color: string }) {
  return (
    <View style={{ gap: 3.5 }}>
      {[0, 1, 2].map((n) => (
        <View key={n} style={{ width: 16, height: 1.5, borderRadius: 1, backgroundColor: color }} />
      ))}
    </View>
  );
}

// ---- the calendar: a month of days, the open day filled and today ringed -------------------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function DayPicker({ day, today, onPick }: { day: DayKey; today: DayKey; onPick(day: DayKey): void }) {
  const theme = useTheme();
  const shownDay = fromDayKey(day);
  const [month, setMonth] = useState({ year: shownDay.getFullYear(), month: shownDay.getMonth() });
  const first = new Date(month.year, month.month, 1);
  const days = new Date(month.year, month.month + 1, 0).getDate();
  const cells: (DayKey | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: days }, (_, i) => dayKey(new Date(month.year, month.month, i + 1))),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const turn = (by: number) => {
    const to = new Date(month.year, month.month + by, 1);
    setMonth({ year: to.getFullYear(), month: to.getMonth() });
  };

  return (
    <View style={styles.picker}>
      <View style={styles.pickerHead}>
        <Tap aria-label="Earlier month" onPress={() => turn(-1)} style={styles.iconButton} activeStyle={{ backgroundColor: theme.paper }}>
          <Chevron color={theme.ink} />
        </Tap>
        <Text role="heading" aria-level={2} style={[styles.pickerTitle, { color: theme.ink }]}>
          {MONTH_NAMES[month.month]} {month.year}
        </Text>
        <Tap aria-label="Later month" onPress={() => turn(1)} style={styles.iconButton} activeStyle={{ backgroundColor: theme.paper }}>
          <Chevron color={theme.ink} forward />
        </Tap>
      </View>
      <View style={styles.week}>
        {WEEKDAY_LETTERS.map((letter, i) => (
          <Text key={i} aria-hidden style={[styles.weekday, { color: theme.inkQuiet }]}>
            {letter}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, w) => (
        <View key={w} style={styles.week}>
          {cells.slice(w * 7, w * 7 + 7).map((cell, i) => {
            if (!cell) return <View key={i} style={styles.dayCell} />;
            const on = cell === day;
            const isToday = cell === today;
            return (
              <Tap
                key={cell}
                aria-label={`${dayDate(cell)}${isToday ? ', today' : ''}`}
                aria-current={on ? 'date' : undefined}
                onPress={() => onPick(cell)}
                style={[styles.dayCell, styles.dayButton, isToday && { borderColor: theme.ink }, on && { backgroundColor: theme.ink, borderColor: theme.ink }]}
                activeStyle={{ borderColor: theme.ink }}>
                <Text style={[styles.dayNumber, { color: on ? theme.paper : theme.ink }, (on || isToday) && { fontWeight: '700' }]}>
                  {fromDayKey(cell).getDate()}
                </Text>
              </Tap>
            );
          })}
        </View>
      ))}
      {day !== today && (
        <Tap onPress={() => onPick(today)} style={styles.menuItem} activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.navText, { color: theme.accent }]}>Back to today</Text>
        </Tap>
      )}
    </View>
  );
}

// ---- the menu: the ways out to the user's own lists, the settings, and where the log lives ----

type MenuProps = Pick<Props, 'onEditCategories' | 'onEditFlags' | 'onEditPlans'> & { onSettings(): void };

function Menu({ onEditCategories, onEditFlags, onEditPlans, onSettings }: MenuProps) {
  const theme = useTheme();
  const sync = useSync();
  const item = (name: string, label: string, onPress: () => void, role: 'link' | 'button' = 'link') => (
    <Tap role={role} aria-label={name} onPress={onPress} style={styles.menuItem} activeStyle={{ backgroundColor: theme.paper }}>
      <Text style={[styles.navText, { color: theme.ink }]}>{label}</Text>
    </Tap>
  );
  return (
    <View role="menu" aria-label="Hours menu" style={[styles.panel, styles.menu, { backgroundColor: theme.paperRaised, borderColor: theme.line }]}>
      {onEditCategories && item('Edit categories', 'Categories', onEditCategories)}
      {onEditFlags && item('Edit flags', 'Flags', onEditFlags)}
      {onEditPlans && item('Edit recurring plans', 'Recurring plans', onEditPlans)}
      {item('Settings', 'Settings', onSettings, 'button')}
      <Text role="status" style={[styles.count, styles.syncLine, { color: theme.inkSoft, borderTopColor: theme.line }]}>
        {sync.line}
      </Text>
    </View>
  );
}

// The device's settings: the hour a day starts at, and the chimes.
function Settings({ start, onStart }: { start: number; onStart(hour: number): void }) {
  const theme = useTheme();
  const chimesNeedThePageOpen = getChimePlatform()?.needsPageOpen ?? false;
  const soundChime = getChimePlatform()?.sound ?? null;
  const chimes = useChimes((s) => s.minutes);
  const chimesSupported = useChimes((s) => s.supported);
  const chimeOutcome = useChimes((s) => s.outcome);
  const setChimes = useChimes((s) => s.set);

  return (
        <>
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
                    onPress={() => onStart(hour)}
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
        </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingHorizontal: GUTTER },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 4, marginHorizontal: -10 },
  days: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  titleRow: { flexShrink: 1, flexDirection: 'row', alignItems: 'baseline', columnGap: 8, paddingHorizontal: 4 },
  title: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, fontWeight: '700', flexShrink: 0 },
  date: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, flexShrink: 1 },
  iconButton: { width: 40, height: ROW, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  navText: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  body: { flex: 1 },
  status: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, marginTop: 24 },
  problem: { alignItems: 'flex-start', gap: 12 },
  retry: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 4 },
  summary: { marginTop: 4, paddingBottom: 8, gap: 8 },
  count: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  // Over the hours: the press-away layer, then the calendar, the menu or the settings.
  away: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 5 },
  panel: {
    position: 'absolute', top: 0, zIndex: 6, padding: 6, borderWidth: 1, borderRadius: 6,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  calendar: { left: 0, width: 300, maxWidth: '100%' },
  menu: { right: 0, minWidth: 220 },
  menuItem: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 4 },
  syncLine: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  settingsPanel: { left: 0, right: 0, maxHeight: '100%', padding: 0 },
  settings: { gap: 20, padding: 14 },
  picker: { gap: 2 },
  pickerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerTitle: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, fontWeight: '700' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontFamily: serif, fontSize: 12, lineHeight: 20 },
  dayCell: { flex: 1, height: 38, margin: 1 },
  dayButton: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent', borderRadius: 4 },
  dayNumber: { fontFamily: serif, fontSize: SMALL, lineHeight: 20, fontVariant: ['tabular-nums'] },
  setting: { gap: 8 },
  settingTitle: { fontFamily: serif, fontSize: SMALL, lineHeight: 20, fontWeight: '700' },
  footerButton: { paddingHorizontal: 10 },
  footerText: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  hear: { alignSelf: 'flex-start' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { minWidth: 56, minHeight: ROW, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 4 },
});
