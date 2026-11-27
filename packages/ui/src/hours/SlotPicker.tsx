import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { PanResponder, Platform, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { repeatLink, slotCovers, slotHours, slotHoursLabel, slotKey, slotLabel, slotOfHours, slotRuns } from '@hissypad/core';
import { dayDate, dayKey, dayOf, daySlots, dayTitle, hourLabel, shiftDay, type Entry } from '@hissypad/core/hours';
import { usePad } from '@hissypad/state';
import { hoursIfOpen, openHours, slotPickerLines, type HoursStores } from '@hissypad/state/hours';

import { CalendarIcon, Chevron, DayPicker } from './DayScreen';
import { drawHours } from './drawn';
import { hourBox, Mark } from './Mark';
import { RepeatSection } from './RepeatSection';
import { Tap } from './Tap';
import { LINE, ROW, SchemeContext, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The slot the lines are in now, or null: the picker opens on its day.
  value: string | null;
  // How many lines are being placed, for the heading.
  count?: number;
  // An hour, a run of hours or hours that are apart were picked, or "No hour" (null).
  onPick(slot: string | null): void;
  onCancel(): void;
  // The lines being placed: the ones the toolbar opened the picker on, unless given. With
  // one line the picker has a Repeat section for it under the hours.
  ids?: readonly string[];
  // The Repeat section went to the line's template in Later: close, and show the pad.
  onOpenTemplate?(): void;
  scheme?: 'light' | 'dark' | null;
  clock?: () => Date;
};

// The gap between two hours' boxes. The boxes share the width that is left.
const GAP = 2;
// A window narrower than this draws the hours as four rows of six, each box with its hour
// on it: 24 boxes in one line are about 13pt wide on a phone, too narrow for a finger
// (Kevin, 2026-11-25). The rows are the quarters the line's four ticks mark.
const NARROW = 560;
// How tall one hour is in each layout, and the gap between two rows of them.
const TALL = { line: 48, rows: 66 };
const ROW_GAP = 4;
// How far a press moves on the phone before the grid takes it from the cell as a swipe.
const SLOP = 8;
// Web: the swipe is ours, not the page's scroll.
const NO_SCROLL = Platform.OS === 'web' ? ({ touchAction: 'none', userSelect: 'none' } as unknown as ViewStyle) : null;
// Web, mouse: a press on an hour keeps focus where it is. Moving it blurs whatever had it,
// and react-native-web ends a gesture when an ancestor of its view blurs. The dialog holds
// focus as it opens, so without this the first swipe with a mouse died on the press.
const KEEP_FOCUS = Platform.OS === 'web' ? { onMouseDown: (event: { preventDefault(): void }) => event.preventDefault() } : null;

// Puts lines of the pad in hours of a day: step to the day, then tap each hour (a tap on
// one that is picked takes it out, and the hours need not touch), or swipe across the
// hours from the first to the last for a run of them. The hours are one line of 24
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

function Picker({ value, count = 1, onPick, onCancel, ids, onOpenTemplate, clock = () => new Date() }: Omit<Props, 'scheme'>) {
  const theme = useTheme();
  // The one line the picker is for, if it is for one, and whether its Repeat section is
  // open: open, it has the room of the hours.
  const [lines] = useState(() => ids ?? slotPickerLines());
  const [repeating, setRepeating] = useState(false);
  const now = clock();
  const stores = useHours();
  // The hour a day starts at: a day runs from it to the same hour of the next.
  const start = stores?.day.getState().start ?? 0;
  const today = dayOf(now, start);
  const current = slotRuns(value)[0] ?? null;
  // The day on the screen: the one picked here, or the one the lines are in, or today.
  const [picked, setDay] = useState<string | null>(null);
  // A recurring item's template: the hours picked are for the items made from it, and the
  // picker opens on the day of the next one.
  const [template] = useState(() => {
    const link = lines.length === 1 ? repeatLink(usePad.getState().all, lines[0]!) : null;
    return link?.role === 'template' ? link.rule : null;
  });
  const opens = template && template.next > today ? template.next : today;
  const day = picked ?? (current ? (current.hour < start ? shiftDay(current.day, -1) : current.day) : opens);
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

  // Six boxes to a row on a narrow window, all 24 in one line otherwise.
  // (A width of 0 is a window that has not been measured.)
  const wide = useWindowDimensions().width;
  const cols = wide > 0 && wide < NARROW ? 6 : 24;
  // What was picked here, shown and not yet confirmed: the button under the hours puts
  // the lines in it (Kevin, 2026-11-25: a pick no longer closes the picker).
  // It is a set of single hours, built a tap or a swipe at a time, and may take in hours
  // that are apart or on other days (Kevin, same day). The first pick starts it from
  // nothing, not from the hours the lines are in; with every hour taken out again it is
  // nothing picked.
  const [hoursPicked, setHoursPicked] = useState<string[] | null>(null);
  const chosen = hoursPicked ? slotOfHours(hoursPicked) : null;
  // A tap on an hour puts it in the set, or takes it out.
  const toggle = (key: string) =>
    setHoursPicked((was) => {
      const next = was?.includes(key) ? was.filter((k) => k !== key) : [...(was ?? []), key];
      return next.length ? next : null;
    });
  // A swipe adds its run to the set.
  const add = (keys: string[]) => setHoursPicked((was) => [...new Set([...(was ?? []), ...keys])]);

  // Read inside the responder, which is made once: the latest values through refs.
  const live = useRef({ slots, cols });
  live.current.slots = slots;
  live.current.cols = cols;
  const grid = useRef<ComponentRef<typeof View>>(null);
  // Where the line sits on the page and how wide it is, taken as a press starts.
  const box = useRef<{ x: number; y: number; width: number } | null>(null);
  const swipe = useRef<{ from: number; to: number; moved: boolean } | null>(null);

  // The place in the day under a point on the page: the boxes of a row share its width
  // evenly, and the rows are all one height.
  const placeAt = (pageX: number, pageY: number) => {
    const b = box.current!;
    const n = live.current.cols;
    const col = Math.min(n - 1, Math.max(0, Math.floor(((pageX - b.x) / Math.max(1, b.width)) * n)));
    const row = n === 24 ? 0 : Math.min(24 / n - 1, Math.max(0, Math.floor((pageY - b.y) / (TALL.rows + ROW_GAP))));
    return row * n + col;
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

  // A tap is the box's own: one hour, in or out. A press that moves is the line's: a run of
  // hours, or on the phone one hour too, since a finger slides to find its box. Either way
  // the pick is only shown; the button under the hours confirms it.
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
        const pageY = g.y0;
        grid.current?.measure((_x, _y, width, _h, x, y) => {
          // react-native-web measures in the window but reports a touch on the page.
          const scroll = Platform.OS === 'web' ? { x: window.scrollX, y: window.scrollY } : { x: 0, y: 0 };
          box.current = { x: x + scroll.x, y: y + scroll.y, width };
          const from = placeAt(pageX, pageY);
          swipe.current = { from, to: from, moved: Platform.OS !== 'web' };
          // The phone says which hour is under the finger from the start.
          if (Platform.OS !== 'web') setRun({ from, to: from });
        });
      },
      onPanResponderMove: (_, g) => {
        if (!swipe.current || !box.current) return;
        const to = placeAt(g.moveX, g.moveY);
        if (to === swipe.current.to) return;
        swipe.current = { ...swipe.current, to, moved: true };
        setRun({ from: swipe.current.from, to });
      },
      onPanResponderRelease: () => {
        const s = swipe.current;
        end();
        // The web leaves a press that ends on the box it started on to that box's click.
        if (!s || !s.moved || (Platform.OS === 'web' && s.from === s.to)) return;
        if (s.from === s.to) toggle(slotOf(s.from, s.to));
        else add(slotHours(slotOf(s.from, s.to)));
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
        {repeating ? 'Repeat this line' : template ? 'Which hour are its items for?' : count === 1 ? 'Which hour is this line for?' : `Which hour are these ${count} lines for?`}
      </Text>
      <Text aria-live="polite" style={[styles.small, { color: theme.inkSoft }]}>
        {repeating
          ? 'How often a new one of it is made.'
          : run
          ? `${slotLabel(slotOf(run.from, run.to), today)}: let go to pick.`
          : over !== null
            ? `${slotLabel(slotOf(over, over), today)}.`
            : chosen
              ? `Picked ${slotLabel(chosen, today)}. Tap an hour to add it or take it out.`
              : value && current
                ? `${template ? 'The next one is in' : 'Now in'} ${slotLabel(value, today)}. Tap the hours, or swipe across several.`
                : template
                  ? 'Each new one is put in the hours picked, on its day. Tap the hours, or swipe across several.'
                  : 'Tap the hours, or swipe across several.'}
      </Text>
      {!repeating && (<>
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
          role="group"
          aria-label="Hours"
          ref={grid}
          style={[styles.hours, NO_SCROLL]}
          {...(KEEP_FOCUS as object)}
          {...responder.panHandlers}>
          {Array.from({ length: 24 / cols }, (_, r) => (
            <View key={r} style={styles.hourRow}>
              {hours.slice(r * cols, (r + 1) * cols).map((h, c) => {
                const i = r * cols + c;
                // What was picked here with the run under the finger, or else where the lines are.
                const key = slotKey(h.day, h.hour);
                const on =
                  (run !== null && i >= Math.min(run.from, run.to) && i <= Math.max(run.from, run.to)) ||
                  (hoursPicked ? hoursPicked.includes(key) : run === null && slotCovers(value, key));
                const isNow = h.day === dayKey(now) && h.hour === now.getHours();
                return (
                  <Tap
                    key={h.hour}
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`${hourLabel(h.hour)}${isNow ? ', now' : ''}`}
                    onPress={() => toggle(key)}
                    onHoverIn={() => setOver(i)}
                    onHoverOut={() => setOver((was) => (was === i ? null : was))}
                    ringInside
                    style={[styles.hour, { height: cols === 24 ? TALL.line : TALL.rows }]}
                    activeStyle={{ backgroundColor: theme.paperRaised }}>
                    {/* A bar over a box marks the hours picked; a bar under one, the hour in
                        progress. The box between them is the hour as the day screen draws it.
                        In rows each box has room for its hour over it. */}
                    <View style={[styles.bar, on && { backgroundColor: theme.ink }]} />
                    {cols !== 24 && (
                      <Text aria-hidden numberOfLines={1} style={[styles.name, { color: on || isNow ? theme.ink : theme.inkQuiet }, (on || isNow) && { fontWeight: '700' }]}>
                        {hourLabel(h.hour)}
                      </Text>
                    )}
                    <Mark style={styles.cell} {...hourBox(h.cell, theme.ink)} />
                    <View style={[styles.bar, isNow && { backgroundColor: theme.accent }]} />
                  </Tap>
                );
              })}
            </View>
          ))}
        </View>
        {cols === 24 && (
          <View style={styles.ticks}>
            {[0, 6, 12, 18].map((i) => hourLabel((start + i) % 24)).map((label) => (
              <Text key={label} style={[styles.tick, { color: theme.inkQuiet }]}>
                {label}
              </Text>
            ))}
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <Tap
          disabled={value === null}
          onPress={() => onPick(null)}
          style={[styles.action, { borderColor: theme.line }]}
          activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paperRaised }}>
          <Text style={[styles.body, { color: theme.ink }]}>No hour</Text>
        </Tap>
        <Tap onPress={onCancel} style={[styles.action, { borderColor: theme.line }]} activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paperRaised }}>
          <Text style={[styles.body, { color: theme.ink }]}>Cancel</Text>
        </Tap>
        {/* The pick, in words, on the button that makes it so. */}
        <Tap
          disabled={chosen === null}
          onPress={() => chosen && onPick(chosen)}
          style={[styles.action, styles.confirm, { borderColor: theme.ink, backgroundColor: chosen ? theme.ink : 'transparent' }]}
          activeStyle={{ opacity: 0.85 }}>
          <Text numberOfLines={1} style={[styles.body, { color: chosen ? theme.paper : theme.ink, fontWeight: '700' }]}>
            {chosen ? (template ? `Each one at ${slotHoursLabel(chosen)}` : `Put in ${slotLabel(chosen, today)}`) : 'Pick an hour'}
          </Text>
        </Tap>
      </View>
      </>)}
      {lines.length === 1 && (
        <RepeatSection id={lines[0]!} open={repeating} onToggle={() => setRepeating((was) => !was)} {...(onOpenTemplate ? { onOpenTemplate } : {})} clock={clock} />
      )}
      {repeating && (
        <View style={styles.actions}>
          <Tap onPress={onCancel} style={[styles.action, { borderColor: theme.line }]} activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paperRaised }}>
            <Text style={[styles.body, { color: theme.ink }]}>Done</Text>
          </Tap>
        </View>
      )}
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
  hours: { gap: ROW_GAP },
  hourRow: { flexDirection: 'row', gap: GAP },
  // A column per hour: the picked bar, the box, the now bar. Tall enough for a finger.
  hour: { flex: 1, gap: 2, paddingVertical: 4, borderRadius: 2 },
  name: { fontFamily: serif, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  cell: { height: 30 },
  bar: { height: 3, borderRadius: 1.5 },
  ticks: { flexDirection: 'row', marginTop: 2 },
  tick: { flex: 1, fontFamily: serif, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  // The button that confirms takes the room that is left, or a line of its own.
  confirm: { flexGrow: 1, alignItems: 'center' },
  action: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 4 },
});
