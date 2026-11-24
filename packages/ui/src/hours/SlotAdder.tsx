import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { slotLabel, todayKey } from '@hissypad/core';
import { usePad } from '@hissypad/state';
import { cmdSlotAdd, cmdSlotPut, slotFinds } from '@hissypad/state/hours';

import { Tap } from './Tap';
import { LINE, ROW, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The calendar day and hour of the slot, never the day as drawn.
  day: string;
  hour: number;
  onClose(): void;
};
type Key = { key: string };

// The field under an open hour's lines that brings lines in: a new one (it lands at the top
// of Today, already in the hour) or one found in any pad (the universal search), put in
// this hour with a tap, or with the arrow keys and Return on the web.
export function SlotAdder({ day, hour, onClose }: Props) {
  const theme = useTheme();
  // Read so the finds follow edits made anywhere.
  usePad((s) => s.all);
  const [draft, setDraft] = useState('');
  const finds = draft.trim() === '' ? [] : slotFinds(day, hour, draft);
  // The find the arrow keys are on; -1 is the field itself, where Return adds a new line.
  const [found, setFound] = useState(-1);
  const at = Math.min(found, finds.length - 1);
  const type = (next: string) => {
    setDraft(next);
    setFound(-1);
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
      <View style={styles.adder}>
        <TextInput
          value={draft}
          onChangeText={type}
          onSubmitEditing={add}
          onKeyPress={(e) => {
            const key = (e.nativeEvent as Key).key;
            if (key === 'Escape') return onClose();
            if ((key !== 'ArrowDown' && key !== 'ArrowUp') || finds.length === 0) return;
            e.preventDefault();
            const n = finds.length + 1;
            setFound(((at + 1 + (key === 'ArrowDown' ? 1 : n - 1)) % n) - 1);
          }}
          submitBehavior="submit"
          returnKeyType="done"
          accessibilityLabel="Add an item to this hour"
          placeholder="Add an item, or find one in a pad"
          placeholderTextColor={theme.inkQuiet}
          style={[styles.input, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.paper, outlineColor: theme.accent }]}
        />
        <Tap
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
  group: { gap: 8 },
  adder: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { flexShrink: 1, fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  struck: { textDecorationLine: 'line-through' },
  input: { flex: 1, minHeight: ROW, fontFamily: serif, fontSize: SIZE, paddingHorizontal: 12, borderWidth: 1, borderRadius: 4 },
  add: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderRadius: 4 },
  finds: { borderWidth: 1, borderRadius: 4, overflow: 'hidden' },
  // The bar on the left marks the find the arrow keys are on: a shape, not a shade alone.
  find: { minHeight: ROW, justifyContent: 'center', paddingLeft: 9, paddingRight: 12, paddingVertical: 6, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  findRule: { borderTopWidth: StyleSheet.hairlineWidth },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
});
