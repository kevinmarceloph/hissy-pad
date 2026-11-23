import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { slotKey, slotLines } from '@hissypad/core';
import { usePad } from '@hissypad/state';
import { cmdSlotAdd, cmdSlotClear, cmdSlotDone } from '@hissypad/state/hours';

import { Tap } from './Tap';
import { ROW, serif, SIZE, SMALL, LINE, useTheme } from './theme';

type Hold = { onPressIn(): void; onPressOut(): void };

type Props = {
  // The calendar day and hour of the slot, never the day as drawn.
  day: string;
  hour: number;
  // The editor's press guard (see HourRow): every control in an open hour takes it.
  hold: Hold;
};

// The pad's lines assigned to this hour: tick one to cross it out in its pad, take it out
// of the hour, or type a new one, which lands at the top of the pad that is open.
export function Items({ day, hour, hold }: Props) {
  const theme = useTheme();
  const all = usePad((s) => s.all);
  const lines = slotLines(all, slotKey(day, hour));
  const [draft, setDraft] = useState('');
  const done = lines.filter((r) => r.done).length;

  const add = () => {
    if (cmdSlotAdd(day, hour, draft)) setDraft('');
  };

  return (
    <View style={styles.group}>
      <Text style={[styles.label, { color: theme.inkSoft }]}>
        {lines.length === 0 ? 'Items' : `Items: ${done} of ${lines.length} done`}
      </Text>
      {lines.map((line) => (
        <View key={line.id} style={styles.line}>
          <Tap
            {...hold}
            role="checkbox"
            aria-checked={line.done}
            aria-label={line.text}
            onPress={() => cmdSlotDone(line.id, !line.done)}
            style={styles.check}
            activeStyle={{ backgroundColor: theme.paper }}>
            <View style={[styles.box, { borderColor: theme.ink }, line.done && { backgroundColor: theme.ink }]}>
              {line.done && <Text style={[styles.boxTick, { color: theme.paper }]}>✓</Text>}
            </View>
            <Text
              numberOfLines={2}
              style={[styles.text, { color: line.done ? theme.inkQuiet : theme.ink }, line.done && styles.struck]}>
              {line.text}
            </Text>
          </Tap>
          <Tap
            {...hold}
            aria-label={`Take “${line.text}” out of this hour`}
            onPress={() => cmdSlotClear(line.id)}
            style={styles.out}
            activeStyle={{ backgroundColor: theme.paper }}>
            <Text style={[styles.text, { color: theme.inkSoft }]}>×</Text>
          </Tap>
        </View>
      ))}
      <View style={styles.line}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          submitBehavior="submit"
          returnKeyType="done"
          accessibilityLabel="Add an item to this hour"
          placeholder="Add an item to this hour"
          placeholderTextColor={theme.inkQuiet}
          style={[styles.input, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.paper, outlineColor: theme.accent }]}
        />
        <Tap
          {...hold}
          disabled={draft.trim() === ''}
          aria-label="Add the item"
          onPress={add}
          style={[styles.add, { borderColor: theme.line }]}
          activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
          <Text style={[styles.small, { color: theme.ink }]}>Add</Text>
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 4 },
  label: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  check: { flex: 1, minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 4, paddingHorizontal: 4 },
  box: { width: 18, height: 18, borderWidth: 1.5, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  boxTick: { fontSize: 13, lineHeight: 15, fontWeight: '700' },
  text: { flexShrink: 1, fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  struck: { textDecorationLine: 'line-through' },
  out: { minWidth: ROW, minHeight: ROW, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  input: { flex: 1, minHeight: ROW, fontFamily: serif, fontSize: SIZE, paddingHorizontal: 12, borderWidth: 1, borderRadius: 4 },
  add: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderRadius: 4 },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
});
