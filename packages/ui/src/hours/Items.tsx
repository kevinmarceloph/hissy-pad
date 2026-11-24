import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { slotKey, slotLabel, slotLines, todayKey } from '@hissypad/core';
import { usePad } from '@hissypad/state';
import { cmdSlotAdd, cmdSlotClear, cmdSlotDone, cmdSlotPut, slotFinds } from '@hissypad/state/hours';

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
// of the hour, or type a new one, which lands at the top of the pad that is open. A line
// archived from its pad stays here, marked "archived", and can still be ticked. What is
// typed also searches every pad (the universal search): a line found is put in this hour
// with a tap, or with the arrow keys and Return on the web.
export function Items({ day, hour, hold }: Props) {
  const theme = useTheme();
  const all = usePad((s) => s.all);
  const lines = slotLines(all, slotKey(day, hour));
  const [draft, setDraft] = useState('');
  const done = lines.filter((r) => r.done).length;
  // Read with `all` above, so the list follows edits made anywhere.
  const finds = draft.trim() === '' ? [] : slotFinds(day, hour, draft);
  // The find the arrow keys are on; -1 is the field itself, where Return adds a new line.
  const [active, setActive] = useState(-1);
  const at = Math.min(active, finds.length - 1);

  const type = (next: string) => {
    setDraft(next);
    setActive(-1);
  };
  const put = (id: string) => {
    cmdSlotPut(id, day, hour);
    type('');
  };
  const add = () => {
    const chosen = finds[at];
    if (chosen) put(chosen.id);
    else if (cmdSlotAdd(day, hour, draft)) type('');
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
            aria-label={line.deletedAt ? `${line.text}, archived` : line.text}
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
            {line.deletedAt && <Text style={[styles.small, { color: theme.inkSoft }]}>archived</Text>}
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
          onChangeText={type}
          onSubmitEditing={add}
          onKeyPress={(e) => {
            const key = (e.nativeEvent as { key: string }).key;
            if ((key !== 'ArrowDown' && key !== 'ArrowUp') || finds.length === 0) return;
            e.preventDefault();
            const n = finds.length + 1;
            setActive(((at + 1 + (key === 'ArrowDown' ? 1 : n - 1)) % n) - 1);
          }}
          submitBehavior="submit"
          returnKeyType="done"
          accessibilityLabel="Add an item to this hour"
          placeholder="Add an item, or find one in a pad"
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
      {finds.length > 0 && (
        <View role={'listbox' as 'list'} aria-label="Lines found in your pads" style={[styles.finds, { borderColor: theme.line }]}>
          {finds.map((f, i) => {
            const text = f.parts.map((p) => p.text).join('');
            const elsewhere = f.slot ? `, now in ${slotLabel(f.slot, todayKey())}` : '';
            return (
              <Tap
                key={f.id}
                {...hold}
                role="option"
                aria-selected={i === at}
                aria-label={`Put “${text}” in this hour${f.done ? ', crossed out' : ''}${elsewhere}`}
                onPress={() => put(f.id)}
                style={[styles.find, { borderTopColor: theme.rule }, i > 0 && styles.findRule, i === at && { backgroundColor: theme.paper, borderLeftColor: theme.accent }]}
                activeStyle={{ backgroundColor: theme.paper }}>
                <Text numberOfLines={1} style={[styles.text, { color: f.done ? theme.inkQuiet : theme.ink }, f.done && styles.struck]}>
                  {f.parts.map((p, k) => (p.hit ? <Text key={k} style={{ fontWeight: '700' }}>{p.text}</Text> : p.text))}
                </Text>
                <Text numberOfLines={1} style={[styles.small, { color: theme.inkSoft }]}>
                  {f.where}
                  {elsewhere}
                </Text>
              </Tap>
            );
          })}
        </View>
      )}
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
  finds: { borderWidth: 1, borderRadius: 4, overflow: 'hidden' },
  // The bar on the left marks the find the arrow keys are on: a shape, not a shade alone.
  find: { minHeight: ROW, justifyContent: 'center', paddingLeft: 9, paddingRight: 12, paddingVertical: 6, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  findRule: { borderTopWidth: StyleSheet.hairlineWidth },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
});
