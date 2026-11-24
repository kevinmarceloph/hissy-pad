import { useRef, useState, type ComponentRef } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { parseSlot, slotCovers, slotKey, slotLabel } from '@hissypad/core';
import { dayDate, dayKey, dayTitle, hourLabel, HOURS, shiftDay } from '@hissypad/core/hours';

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

// The hour cells' size and the gap between them, which the swipe reads positions from.
const CELL = 64;
const GAP = 6;
// How far a press moves on the phone before the grid takes it from the cell as a swipe.
const SLOP = 8;
// Web: the swipe is ours, not the page's scroll.
const NO_SCROLL = Platform.OS === 'web' ? ({ touchAction: 'none', userSelect: 'none' } as unknown as ViewStyle) : null;
// Web, mouse: a press on an hour keeps focus where it is. Moving it blurs whatever had it,
// and react-native-web ends a gesture when an ancestor of its view blurs. The dialog holds
// focus as it opens, so without this the first swipe with a mouse died on the press.
const KEEP_FOCUS = Platform.OS === 'web' ? { onMouseDown: (event: { preventDefault(): void }) => event.preventDefault() } : null;

// Puts lines of the pad in an hour of a day: step to the day, tap the hour, or swipe across
// the hours from the first to the last for a run of them. The pad's toolbar opens it on web
// and on the phone.
export function SlotPicker({ scheme = null, ...props }: Props) {
  return (
    <SchemeContext.Provider value={scheme}>
      <Picker {...props} />
    </SchemeContext.Provider>
  );
}

function Picker({ value, count = 1, onPick, onCancel, clock = () => new Date() }: Omit<Props, 'scheme'>) {
  const theme = useTheme();
  const now = clock();
  const today = dayKey(now);
  const current = parseSlot(value);
  const [day, setDay] = useState(current?.day ?? today);
  // The swipe in progress: the hour it started on and the one under the finger now.
  const [run, setRun] = useState<{ from: number; to: number } | null>(null);

  // Read inside the responder, which is made once: the latest values through refs.
  const live = useRef({ day, onPick });
  live.current.day = day;
  live.current.onPick = onPick;
  const grid = useRef<ComponentRef<typeof View>>(null);
  // Where the grid sits on the page and how wide it is, taken as a press starts.
  const box = useRef<{ x: number; y: number; width: number } | null>(null);
  const swipe = useRef<{ from: number; to: number } | null>(null);

  // The hour under a point on the page, from the grid's place and the cells' fixed size.
  const hourAt = (pageX: number, pageY: number) => {
    const b = box.current!;
    const cols = Math.max(1, Math.floor((b.width + GAP) / (CELL + GAP)));
    const col = Math.min(cols - 1, Math.max(0, Math.floor((pageX - b.x) / (CELL + GAP))));
    const row = Math.max(0, Math.floor((pageY - b.y) / (ROW + GAP)));
    return Math.min(23, Math.max(0, row * cols + col));
  };
  const end = () => {
    swipe.current = null;
    box.current = null;
    setRun(null);
  };

  // A tap is the cell's own: one hour. A press that moves is the grid's, a run of hours.
  // On the phone the grid claims a press once it moves. react-native-web only lets a parent
  // claim a moving press after it leaves the cell, so there the grid takes every press as it
  // starts and leaves a tap to the cell's click (react-native-web presses on click, which a
  // drag across cells never makes).
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => Platform.OS === 'web',
      onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > SLOP,
      onPanResponderGrant: (_, g) => {
        // Where the press is as the grid takes it: where it went down on the web, a few
        // points on from there on the phone, still on the hour it started on.
        const pageX = g.x0;
        const pageY = g.y0;
        grid.current?.measure((_x, _y, width, _h, x, y) => {
          // react-native-web measures in the window but reports a touch on the page.
          const scroll = Platform.OS === 'web' ? { x: window.scrollX, y: window.scrollY } : { x: 0, y: 0 };
          box.current = { x: x + scroll.x, y: y + scroll.y, width };
          const from = hourAt(pageX, pageY);
          swipe.current = { from, to: from };
        });
      },
      onPanResponderMove: (_, g) => {
        if (!swipe.current || !box.current) return;
        const to = hourAt(g.moveX, g.moveY);
        if (to === swipe.current.to) return;
        swipe.current = { ...swipe.current, to };
        setRun(swipe.current);
      },
      onPanResponderRelease: () => {
        const s = swipe.current;
        end();
        if (!s || s.from === s.to) return;
        const first = Math.min(s.from, s.to);
        live.current.onPick(slotKey(live.current.day, first, Math.abs(s.to - s.from) + 1));
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: end,
    }),
  ).current;

  const step = (label: string, name: string, to: string) => (
    <Tap aria-label={name} onPress={() => setDay(to)} style={styles.nav} activeStyle={{ backgroundColor: theme.paperRaised }}>
      <Text style={[styles.body, { color: theme.ink }]}>{label}</Text>
    </Tap>
  );

  return (
    <View style={[styles.sheet, { backgroundColor: theme.paper }]}>
      <Text role="heading" aria-level={2} style={[styles.title, { color: theme.ink }]}>
        {count === 1 ? 'Which hour is this line for?' : `Which hour are these ${count} lines for?`}
      </Text>
      <Text aria-live="polite" style={[styles.small, { color: theme.inkSoft }]}>
        {run
          ? `${slotLabel(slotKey(day, Math.min(run.from, run.to), Math.abs(run.to - run.from) + 1), today)}: let go to pick.`
          : 'Tap an hour, or swipe across several.'}
      </Text>
      <View style={styles.dayRow}>
        <Text aria-live="polite" style={[styles.body, styles.day, { color: theme.ink }]}>
          {dayTitle(day, now)}, {dayDate(day)}
        </Text>
        <View role="navigation" aria-label="Days" style={styles.navs}>
          {step('Earlier', 'The day before', shiftDay(day, -1))}
          {step('Later', 'The day after', shiftDay(day, 1))}
          {day !== today && step('Today', 'Back to today', today)}
        </View>
      </View>
      <View
        role="radiogroup"
        aria-label="Hour"
        ref={grid}
        style={[styles.hours, NO_SCROLL]}
        {...(KEEP_FOCUS as object)}
        {...responder.panHandlers}>
        {HOURS.map((hour) => {
          const on = run
            ? hour >= Math.min(run.from, run.to) && hour <= Math.max(run.from, run.to)
            : slotCovers(value, slotKey(day, hour));
          const isNow = day === today && hour === now.getHours();
          return (
            <Tap
              key={hour}
              role="radio"
              aria-checked={on}
              aria-label={`${hourLabel(hour)}${isNow ? ', now' : ''}`}
              onPress={() => onPick(slotKey(day, hour))}
              style={[styles.hour, { borderColor: on || isNow ? theme.ink : theme.line }, on && { backgroundColor: theme.ink }]}
              activeStyle={{ borderColor: theme.ink }}>
              <Text style={[styles.small, { color: on ? theme.paper : theme.ink }, (on || isNow) && { fontWeight: '700' }]}>
                {on ? '✓ ' : ''}
                {hourLabel(hour)}
              </Text>
              {isNow && <Text style={[styles.tiny, { color: on ? theme.paper : theme.accent }]}>now</Text>}
            </Tap>
          );
        })}
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
  tiny: { fontFamily: serif, fontSize: 11, lineHeight: 12 },
  dayRow: { gap: 2 },
  day: { fontWeight: '700' },
  navs: { flexDirection: 'row', flexWrap: 'wrap', marginLeft: -10 },
  nav: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 4 },
  hours: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  hour: { width: CELL, minHeight: ROW, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 4 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  action: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 4 },
});
