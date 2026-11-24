import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { parseSlot, slotCovers, slotKey, slotLabel } from '@hissypad/core';
import { dayDate, dayKey, dayOf, daySlots, dayTitle, hourLabel, shiftDay, type Entry } from '@hissypad/core/hours';
import { usePad } from '@hissypad/state';
import { hoursIfOpen, openHours, type HoursStores } from '@hissypad/state/hours';

import { CalendarIcon, Chevron, DayPicker } from './DayScreen';
import { drawHours } from './drawn';
import { hourBox, Mark } from './Mark';
import { Tap } from './Tap';
import { LINE, ROW, SchemeContext, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The slot the lines are in now, or null: the picker opens on its day.
  value: string | null;
  // How many lines are being placed, for the heading.
  count?: number;
  // An hour or a run of hours was picked, or "No hour" (null).
  onPick(slot: string | null): void;
  onCancel(): void;
  scheme?: 'light' | 'dark' | null;
  clock?: () => Date;
};

// The gap between two hours' boxes. The boxes share the width that is left.
const GAP = 2;
// How far a press moves on the phone before the grid takes it from the cell as a swipe.
const SLOP = 8;
// Web: the swipe is ours, not the page's scroll.
const NO_SCROLL = Platform.OS === 'web' ? ({ touchAction: 'none', userSelect: 'none' } as unknown as ViewStyle) : null;
// Web, mouse: a press on an hour keeps focus where it is. Moving it blurs whatever had it,
// and react-native-web ends a gesture when an ancestor of its view blurs. The dialog holds
// focus as it opens, so without this the first swipe with a mouse died on the press.
const KEEP_FOCUS = Platform.OS === 'web' ? { onMouseDown: (event: { preventDefault(): void }) => event.preventDefault() } : null;

// Puts lines of the pad in an hour of a day: step to the day, tap the hour, or swipe across
// the hours from the first to the last for a run of them. The hours are one line of 24
// boxes, the day screen's strip: they start at the hour the day starts at, and each is
// drawn as that hour stands (see Mark), so what is already in the day shows while picking.
// The pad's toolbar opens it on web and on the phone.
export function SlotPicker({ scheme = null, ...props }: Props) {
  return (
    <SchemeContext.Provider value={scheme}>
      <Picker {...props} />
    </SchemeContext.Provider>
  );
}

// The hours' own stores, which the picker reads outside the Hours screen: the day start,
// the categories, the recurring plans and the hours as stored.
function useHours(): HoursStores | null {
  const [stores, setStores] = useState(hoursIfOpen);
  useEffect(() => {
    let alive = true;
    if (!stores) void openHours().then((opened) => alive && setStores(opened));
    return () => {
      alive = false;
    };
  }, [stores]);
  return stores;
}

function Picker({ value, count = 1, onPick, onCancel, clock = () => new Date() }: Omit<Props, 'scheme'>) {
  const theme = useTheme();
  const now = clock();
  const stores = useHours();
  // The hour a day starts at: a day runs from it to the same hour of the next.
  const start = stores?.day.getState().start ?? 0;
  const today = dayOf(now, start);
  const current = parseSlot(value);
  // The day on the screen: the one picked here, or the one the lines are in, or today.
  const [picked, setDay] = useState<string | null>(null);
  const day = picked ?? (current ? (current.hour < start ? shiftDay(current.day, -1) : current.day) : today);
  const slots = useMemo(() => daySlots(day, start), [day, start]);
  // The swipe in progress, as places in the line: where it started and where the finger is.
  const [run, setRun] = useState<{ from: number; to: number } | null>(null);
  // The box the pointer is over, where there is one: the boxes carry no words of their own.
  const [over, setOver] = useState<number | null>(null);

  // The day's hours as stored, read when the day changes. They color the boxes.
  const [stored, setStored] = useState<{ day: string; byHour: Record<number, Entry> }>({ day: '', byHour: {} });
  useEffect(() => {
    if (!stores) return;
    let alive = true;
    void Promise.all([stores.store.listDay(day), start === 0 ? [] : stores.store.listDay(shiftDay(day, 1))]).then(([first, next]) => {
      if (!alive) return;
      const rows = [...first.filter((e) => e.hour >= start), ...next.filter((e) => e.hour < start)];
      setStored({ day, byHour: Object.fromEntries(rows.map((e) => [e.hour, e])) });
    });
    return () => {
      alive = false;
    };
  }, [stores, day, start]);
  const all = usePad((s) => s.all);
  const hours = useMemo(
    () =>
      drawHours(
        slots,
        stored.day === day ? stored.byHour : {},
        stores?.recurring.getState().list ?? [],
        all,
        stores?.categories.getState().list ?? [],
        theme.palette,
      ),
    [slots, stored, day, stores, all, theme.palette],
  );

  // Read inside the responder, which is made once: the latest values through refs.
  const live = useRef({ slots, onPick });
  live.current.slots = slots;
  live.current.onPick = onPick;
  const grid = useRef<ComponentRef<typeof View>>(null);
  // Where the line sits on the page and how wide it is, taken as a press starts.
  const box = useRef<{ x: number; width: number } | null>(null);
  const swipe = useRef<{ from: number; to: number; moved: boolean } | null>(null);

  // The place in the line under a point on the page: the boxes share the width evenly.
  const placeAt = (pageX: number) => {
    const b = box.current!;
    return Math.min(23, Math.max(0, Math.floor(((pageX - b.x) / Math.max(1, b.width)) * 24)));
  };
  const end = () => {
    swipe.current = null;
    box.current = null;
    setRun(null);
  };
  // The slot of a run of places: from the earlier one, as many hours as it takes in. A run
  // past midnight carries on into the next calendar day, as a slot does.
  const slotOf = (from: number, to: number) => {
    const first = live.current.slots[Math.min(from, to)]!;
    return slotKey(first.day, first.hour, Math.abs(to - from) + 1);
  };

  // A tap is the box's own: one hour. A press that moves is the line's: a run of hours, or
  // on the phone one hour too, since a finger slides to find a box this narrow.
  // On the phone the line claims a press once it moves. react-native-web only lets a parent
  // claim a moving press after it leaves the box, so there the line takes every press as it
  // starts and leaves a tap to the box's click (react-native-web presses on click, which a
  // drag across boxes never makes).
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => Platform.OS === 'web',
      onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > SLOP,
      onPanResponderGrant: (_, g) => {
        // Where the press is as the line takes it: where it went down on the web, a few
        // points on from there on the phone, still on the hour it started on.
        const pageX = g.x0;
        grid.current?.measure((_x, _y, width, _h, x) => {
          // react-native-web measures in the window but reports a touch on the page.
          box.current = { x: x + (Platform.OS === 'web' ? window.scrollX : 0), width };
          const from = placeAt(pageX);
          swipe.current = { from, to: from, moved: Platform.OS !== 'web' };
          // The phone says which hour is under the finger from the start.
          if (Platform.OS !== 'web') setRun({ from, to: from });
        });
      },
      onPanResponderMove: (_, g) => {
        if (!swipe.current || !box.current) return;
        const to = placeAt(g.moveX);
        if (to === swipe.current.to) return;
        swipe.current = { ...swipe.current, to, moved: true };
        setRun({ from: swipe.current.from, to });
      },
      onPanResponderRelease: () => {
        const s = swipe.current;
        end();
        // The web leaves a press that ends on the box it started on to that box's click.
        if (!s || !s.moved || (Platform.OS === 'web' && s.from === s.to)) return;
        live.current.onPick(slotOf(s.from, s.to));
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: end,
    }),
  ).current;

  // The calendar under the day line, open or not.
  const [calendar, setCalendar] = useState(false);
  const step = (name: string, to: string, forward: boolean) => (
    <Tap aria-label={name} onPress={() => setDay(to)} style={styles.iconButton} activeStyle={{ backgroundColor: theme.paperRaised }}>
      <Chevron color={theme.ink} forward={forward} />
    </Tap>
  );

  return (
    <View style={[styles.sheet, { backgroundColor: theme.paper }]}>
      <Text role="heading" aria-level={2} style={[styles.title, { color: theme.ink }]}>
        {count === 1 ? 'Which hour is this line for?' : `Which hour are these ${count} lines for?`}
      </Text>
      <Text aria-live="polite" style={[styles.small, { color: theme.inkSoft }]}>
        {run
          ? `${slotLabel(slotOf(run.from, run.to), today)}: let go to pick.`
          : over !== null
            ? `${slotLabel(slotOf(over, over), today)}.`
            : value && current
            ? `Now in ${slotLabel(value, today)}. Tap an hour, or swipe across several.`
            : 'Tap an hour, or swipe across several.'}
      </Text>
      {/* One line, as on the Hours screen: earlier, the day, the calendar, later. */}
      <View role="navigation" aria-label="Days" style={styles.days}>
        {step('The day before', shiftDay(day, -1), false)}
        <View aria-live="polite" style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.body, styles.day, { color: theme.ink }]}>
            {dayTitle(day, now, start)}
          </Text>
          {dayTitle(day, now, start) !== dayDate(day) && (
            <Text numberOfLines={1} style={[styles.body, styles.date, { color: theme.inkSoft }]}>
              {dayDate(day)}
            </Text>
          )}
        </View>
        <Tap
          aria-label="Pick a day"
          aria-expanded={calendar}
          onPress={() => setCalendar((open) => !open)}
          style={[styles.iconButton, calendar && { backgroundColor: theme.paperRaised }]}
          activeStyle={{ backgroundColor: theme.paperRaised }}>
          <CalendarIcon color={theme.ink} />
        </Tap>
        {step('The day after', shiftDay(day, 1), true)}
      </View>
      {calendar && (
        <View style={[styles.calendar, { backgroundColor: theme.paperRaised, borderColor: theme.line }]}>
          <DayPicker
            day={day}
            today={today}
            onPick={(to) => {
              setDay(to);
              setCalendar(false);
            }}
          />
        </View>
      )}
      <View>
        <View
          role="radiogroup"
          aria-label="Hour"
          ref={grid}
          style={[styles.hours, NO_SCROLL]}
          {...(KEEP_FOCUS as object)}
          {...responder.panHandlers}>
          {hours.map((h, i) => {
            const on = run
              ? i >= Math.min(run.from, run.to) && i <= Math.max(run.from, run.to)
              : slotCovers(value, slotKey(h.day, h.hour));
            const isNow = h.day === dayKey(now) && h.hour === now.getHours();
            return (
              <Tap
                key={h.hour}
                role="radio"
                aria-checked={on}
                aria-label={`${hourLabel(h.hour)}${isNow ? ', now' : ''}`}
                onPress={() => onPick(slotKey(h.day, h.hour))}
                onHoverIn={() => setOver(i)}
                onHoverOut={() => setOver((was) => (was === i ? null : was))}
                ringInside
                style={styles.hour}
                activeStyle={{ backgroundColor: theme.paperRaised }}>
                {/* A bar over a box marks the hours picked; a bar under one, the hour in
                    progress. The box between them is the hour as the day screen draws it. */}
                <View style={[styles.bar, on && { backgroundColor: theme.ink }]} />
                <Mark style={styles.cell} {...hourBox(h.cell, theme.ink)} />
                <View style={[styles.bar, isNow && { backgroundColor: theme.accent }]} />
              </Tap>
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
      <View style={styles.actions}>
        <Tap
          disabled={value === null}
          onPress={() => onPick(null)}
          style={[styles.action, { borderColor: theme.line }]}
          activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paperRaised }}>
          <Text style={[styles.body, { color: theme.ink }]}>No hour</Text>
        </Tap>
        <Tap onPress={onCancel} style={[styles.action, { borderColor: theme.ink }]} activeStyle={{ backgroundColor: theme.paperRaised }}>
          <Text style={[styles.body, { color: theme.ink }]}>Cancel</Text>
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 20, gap: 12, width: '100%' },
  title: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, fontWeight: '700' },
  body: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  days: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -10 },
  titleRow: { flexShrink: 1, flexDirection: 'row', alignItems: 'baseline', columnGap: 8, paddingHorizontal: 4 },
  day: { fontWeight: '700', flexShrink: 0 },
  date: { flexShrink: 1 },
  iconButton: { width: 40, height: ROW, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  calendar: { alignSelf: 'flex-start', width: 300, maxWidth: '100%', padding: 6, borderWidth: 1, borderRadius: 6 },
  hours: { flexDirection: 'row', gap: GAP },
  // A column per hour: the picked bar, the box, the now bar. Tall enough for a finger.
  hour: { flex: 1, gap: 2, paddingVertical: 4, borderRadius: 2 },
  cell: { height: 30 },
  bar: { height: 3, borderRadius: 1.5 },
  ticks: { flexDirection: 'row', marginTop: 2 },
  tick: { flex: 1, fontFamily: serif, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  action: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 4 },
});
