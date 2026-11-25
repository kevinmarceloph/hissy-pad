import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dueLabel } from '@hissypad/core';
import { dayDate, dayOf, shiftDay } from '@hissypad/core/hours';
import { boomerangChoices } from '@hissypad/state';
import { hoursIfOpen, openHours, type HoursStores } from '@hissypad/state/hours';

import { DayPicker } from './DayScreen';
import { Tap } from './Tap';
import { LINE, ROW, SchemeContext, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The day the lines are out until now, or null: lines of a pad have none.
  value: string | null;
  // How many lines are being sent, for the heading.
  count?: number;
  // A day was picked. `today` is the day it was counted from, for the words said back.
  onPick(due: string, today: string): void;
  onCancel(): void;
  scheme?: 'light' | 'dark' | null;
  clock?: () => Date;
};

// Sends lines of the pad out until a later day (a day, no hour): a few days one tap away,
// and a calendar for any other. Tomorrow is the earliest. A day here is a day as Hours has
// it: it starts at the day start, which is when the lines come back to the Inbox. The pad's
// floating Boomerang button opens it on web and on the phone.
export function BoomerangPicker({ scheme = null, ...props }: Props) {
  return (
    <SchemeContext.Provider value={scheme}>
      <Picker {...props} />
    </SchemeContext.Provider>
  );
}

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
  const stores = useHours();
  const start = stores?.day.getState().start ?? 0;
  const today = dayOf(clock(), start);
  const first = shiftDay(today, 1);
  const [chosen, setChosen] = useState<string | null>(null);
  const day = chosen ?? (value && value >= first ? value : first);
  const hour = start === 0 ? 'midnight' : `${start % 12 === 0 ? 12 : start % 12}${start < 12 ? 'am' : 'pm'}`;

  return (
    <View style={[styles.sheet, { backgroundColor: theme.paper }]}>
      <Text role="heading" aria-level={2} style={[styles.title, { color: theme.ink }]}>
        {count === 1 ? 'Until when is this line out?' : `Until when are these ${count} lines out?`}
      </Text>
      <Text aria-live="polite" style={[styles.small, { color: theme.inkSoft }]}>
        {value
          ? `Out until ${dueLabel(value, today)} now. `
          : ''}
        It leaves the pads and comes back to the top of the Inbox when that day starts, at {hour}.
      </Text>
      <View role="group" aria-label="Soon" style={styles.quick}>
        {boomerangChoices(today).map((c) => (
          <Tap
            key={c.label}
            aria-label={`${c.label}, ${dayDate(c.due)}`}
            onPress={() => onPick(c.due, today)}
            style={[styles.choice, { borderColor: theme.line }]}
            activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paperRaised }}>
            <Text style={[styles.body, { color: theme.ink }]}>{c.label}</Text>
            <Text style={[styles.small, { color: theme.inkSoft }]}>{dayDate(c.due)}</Text>
          </Tap>
        ))}
      </View>
      <View style={[styles.calendar, { backgroundColor: theme.paperRaised, borderColor: theme.line }]}>
        <DayPicker day={day} today={today} from={first} onPick={setChosen} />
      </View>
      <View style={styles.actions}>
        <Tap onPress={onCancel} style={[styles.action, { borderColor: theme.line }]} activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paperRaised }}>
          <Text style={[styles.body, { color: theme.ink }]}>Cancel</Text>
        </Tap>
        {/* The pick, in words, on the button that makes it so. */}
        <Tap
          disabled={chosen === null}
          onPress={() => chosen && onPick(chosen, today)}
          style={[styles.action, styles.confirm, { borderColor: theme.ink, backgroundColor: chosen ? theme.ink : 'transparent' }]}
          activeStyle={{ opacity: 0.85 }}>
          <Text numberOfLines={1} style={[styles.body, { color: chosen ? theme.paper : theme.ink, fontWeight: '700' }]}>
            {chosen ? `Out until ${dueLabel(chosen, today)}` : 'Pick a day'}
          </Text>
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
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Two to a row on a phone, four on a wide dialog.
  choice: { flexGrow: 1, flexBasis: 130, minHeight: ROW, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderRadius: 4 },
  calendar: { alignSelf: 'flex-start', width: 300, maxWidth: '100%', padding: 6, borderWidth: 1, borderRadius: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  confirm: { flexGrow: 1, alignItems: 'center' },
  action: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 4 },
});
