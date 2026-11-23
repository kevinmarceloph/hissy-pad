import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { parseSlot, slotKey } from '@hissypad/core';
import { dayDate, dayKey, dayTitle, hourLabel, HOURS, shiftDay } from '@hissypad/core/hours';

import { Tap } from './Tap';
import { LINE, ROW, SchemeContext, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The slot the lines are in now, or null: the picker opens on its day.
  value: string | null;
  // How many lines are being placed, for the heading.
  count?: number;
  // An hour was picked, or "No hour" (null).
  onPick(slot: string | null): void;
  onCancel(): void;
  scheme?: 'light' | 'dark' | null;
  clock?: () => Date;
};

// Puts lines of the pad in an hour of a day: step to the day, tap the hour. The pad's
// toolbar opens it on web and on the phone.
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
      <View role="radiogroup" aria-label="Hour" style={styles.hours}>
        {HOURS.map((hour) => {
          const on = current?.day === day && current.hour === hour;
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
  hours: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hour: { width: 64, minHeight: ROW, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 4 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  action: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 4 },
});
