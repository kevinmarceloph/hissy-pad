import { useEffect, useLayoutEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { slotKey, slotLabel, slotOutline, stateOf, todayKey, type SlotRow } from '@hissypad/core';
import { usePad } from '@hissypad/state';
import {
  cmdSlotAdd, cmdSlotBreak, cmdSlotClear, cmdSlotDone, cmdSlotErase, cmdSlotPut, cmdSlotShift, cmdSlotState, cmdSlotText, slotFinds,
} from '@hissypad/state/hours';

import { StateMark, StateSwitch } from './StateMark';
import { Tap } from './Tap';
import { ROW, serif, SIZE, SMALL, LINE, useTheme } from './theme';

type Props = {
  // The calendar day and hour of the slot, never the day as drawn.
  day: string;
  hour: number;
  onClose(): void;
};

type Field = ComponentRef<typeof TextInput>;
type Key = { key: string; shiftKey?: boolean };

// How far each level under a line sits to the right of it.
const INDENT = 22;

// The open hour as a small pad: only the lines put in this hour and everything under them.
// A line is typed in place; Return starts a new one under it, Tab and Shift+Tab move it in
// and out, Backspace on an empty one takes it away, and the bullet crosses it out. The
// switch under the list puts the line being typed in one of its three states. A line may
// sit in any pad, and every change here is a change to that pad.
//
// Under it, the field that brings lines in: a new one (it lands at the top of the pad that
// is open) or one found in any pad (the universal search), put in this hour with a tap, or
// with the arrow keys and Return on the web. A line archived from its pad stays listed,
// marked "archived", and can still be crossed out.
export function MiniPad({ day, hour, onClose }: Props) {
  const theme = useTheme();
  const all = usePad((s) => s.all);
  const rows = slotOutline(all, slotKey(day, hour));

  // The line last typed in: the one the switch and the arrows under the list act on.
  const [active, setActive] = useState<string | null>(null);
  const current = rows.find((r) => r.row.id === active);
  // A line to put the caret in once it is drawn: a new one, or one that just moved.
  const [focusOn, setFocusOn] = useState<string | null>(null);
  // The same, with the caret after the line's last word: the line above one just taken away.
  const atEnd = useRef(false);
  const fields = useRef(new Map<string, Field>());
  const carets = useRef(new Map<string, number>());
  useEffect(() => {
    if (!focusOn) return;
    const field = fields.current.get(focusOn);
    field?.focus();
    if (atEnd.current && Platform.OS === 'web') {
      const node = field as unknown as { value?: string; setSelectionRange?(from: number, to: number): void } | undefined;
      node?.setSelectionRange?.(node.value?.length ?? 0, node.value?.length ?? 0);
    }
    atEnd.current = false;
    setFocusOn(null);
  }, [focusOn]);

  const breakLine = ({ row, depth }: SlotRow, caret = carets.current.get(row.id)) => {
    const made = cmdSlotBreak(row.id, depth === 0, caret);
    if (made) setFocusOn(made);
  };
  const shift = ({ row, depth }: SlotRow, dir: 'in' | 'out') => {
    cmdSlotShift(row.id, depth, dir);
    // The line was moved on the page, which takes the caret out of it.
    setFocusOn(row.id);
  };
  const onKey = (e: { nativeEvent: unknown; preventDefault(): void }, at: number) => {
    const entry = rows[at]!;
    const { key, shiftKey } = e.nativeEvent as Key;
    // The web's field says where its caret is; it does not report every move of it. The
    // phone's reports them all (onSelectionChange).
    const here = (e as { target?: { selectionStart?: number | null; selectionEnd?: number | null } }).target;
    const caret = typeof here?.selectionStart === 'number' && here.selectionStart === here.selectionEnd ? here.selectionStart : carets.current.get(entry.row.id);
    if (key === 'Enter' && Platform.OS === 'web' && !shiftKey) {
      e.preventDefault();
      breakLine(entry, caret);
    } else if (key === 'Backspace' && entry.row.text === '' && entry.depth > 0) {
      if (!cmdSlotErase(entry.row.id)) return;
      e.preventDefault();
      atEnd.current = true;
      setFocusOn(rows[at - 1]?.row.id ?? null);
    } else if (key === 'Tab') {
      e.preventDefault();
      shift(entry, shiftKey ? 'out' : 'in');
    } else if (key === 'ArrowUp' && caret === 0 && rows[at - 1]) {
      e.preventDefault();
      setFocusOn(rows[at - 1]!.row.id);
    } else if (key === 'ArrowDown' && caret === entry.row.text.length && rows[at + 1]) {
      e.preventDefault();
      setFocusOn(rows[at + 1]!.row.id);
    } else if (key === 'Escape') {
      onClose();
    }
  };

  // ---- the field that brings lines in ----
  const [draft, setDraft] = useState('');
  // Read with `all` above, so the list follows edits made anywhere.
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
      {rows.length > 0 && (
        <View role="list" aria-label="Lines in this hour">
          {rows.map((entry, i) => (
            <Line
              key={entry.row.id}
              entry={entry}
              active={entry.row.id === active}
              register={(field) => {
                if (field) fields.current.set(entry.row.id, field);
                else fields.current.delete(entry.row.id);
              }}
              onCaret={(caret) => carets.current.set(entry.row.id, caret)}
              onFocus={() => setActive(entry.row.id)}
              onKey={(e) => onKey(e, i)}
              onBreak={() => breakLine(entry)}
            />
          ))}
        </View>
      )}

      {current && (
        // What the line being typed is: open, doing or done, and how far in it sits.
        <View style={styles.bar}>
          <StateSwitch
            label="This line"
            value={stateOf(current.row)}
            onChange={(state) => {
              cmdSlotState(current.row.id, state);
              setFocusOn(current.row.id);
            }}
          />
          <Tap
            aria-label="Move this line out"
            disabled={current.depth < 2}
            onPress={() => shift(current, 'out')}
            style={[styles.shift, { borderColor: theme.line }]}
            activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
            <Text style={[styles.text, { color: theme.ink }]}>←</Text>
          </Tap>
          <Tap
            aria-label="Move this line in"
            disabled={current.depth < 1}
            onPress={() => shift(current, 'in')}
            style={[styles.shift, { borderColor: theme.line }]}
            activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
            <Text style={[styles.text, { color: theme.ink }]}>→</Text>
          </Tap>
        </View>
      )}

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

type LineProps = {
  entry: SlotRow;
  active: boolean;
  register(field: Field | null): void;
  onCaret(caret: number): void;
  onFocus(): void;
  onKey(e: { nativeEvent: unknown; preventDefault(): void }): void;
  onBreak(): void;
};

// One line of the hour: its bullet, its words, and on one of the hour's own lines the way
// out of the hour.
function Line({ entry, active, register, onCaret, onFocus, onKey, onBreak }: LineProps) {
  const theme = useTheme();
  const { row, depth } = entry;
  const archived = row.deletedAt !== null;
  const state = stateOf(row);
  const words = row.text.trim() === '' ? 'An empty line' : row.text;

  const field = useRef<Field | null>(null);
  // The web's field does not grow with its words on its own: it is set to whole lines of
  // text here (a rounded height would be half a pixel off, PLAN.md). The phone's grows.
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = field.current as unknown as { style: { height: string }; scrollHeight: number } | null;
    if (!node?.style) return;
    node.style.height = '0px';
    node.style.height = `${Math.max(1, Math.round(node.scrollHeight / LINE)) * LINE}px`;
  }, [row.text, width]);

  return (
    <View role="listitem" style={[styles.line, { paddingLeft: depth * INDENT }]}>
      <Tap
        role="checkbox"
        aria-checked={row.done}
        aria-label={`${words}${state === 'doing' ? ', doing' : ''}${archived ? ', archived' : ''}`}
        onPress={() => cmdSlotDone(row.id, !row.done)}
        style={styles.bullet}
        activeStyle={{ backgroundColor: theme.paper }}>
        <StateMark state={state} color={state === 'done' ? theme.inkQuiet : active ? theme.accent : theme.inkSoft} />
      </Tap>
      <TextInput
        ref={(node) => {
          field.current = node;
          register(node);
        }}
        multiline
        rows={1}
        editable={!archived}
        value={row.text}
        onChangeText={(next) => cmdSlotText(row.id, next)}
        onFocus={onFocus}
        onKeyPress={onKey}
        onSelectionChange={(e) => onCaret(e.nativeEvent.selection.start)}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        // The phone: Return is a new line of the hour, not a line break in this one.
        submitBehavior="submit"
        onSubmitEditing={Platform.OS === 'web' ? undefined : onBreak}
        scrollEnabled={false}
        accessibilityLabel={`Line: ${words}`}
        style={[
          styles.words,
          { color: row.done ? theme.inkQuiet : theme.ink, outlineWidth: 0 },
          row.done && styles.struck,
          depth === 0 && styles.top,
        ]}
      />
      {archived && <Text style={[styles.small, styles.tag, { color: theme.inkSoft }]}>archived</Text>}
      {depth === 0 && (
        <Tap
          aria-label={`Take “${row.text}” out of this hour`}
          onPress={() => cmdSlotClear(row.id)}
          style={styles.out}
          activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.text, { color: theme.inkSoft }]}>×</Text>
        </Tap>
      )}
    </View>
  );
}

// A line here is as tall as a tap needs on its bullet, and no taller: a pad, not a form.
const LINE_ROW = 36;

const styles = StyleSheet.create({
  group: { gap: 8 },
  line: { flexDirection: 'row', alignItems: 'flex-start', minHeight: LINE_ROW },
  bullet: { width: 36, marginRight: 3, height: LINE_ROW, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  words: {
    flex: 1,
    fontFamily: serif,
    fontSize: SIZE,
    lineHeight: LINE,
    minHeight: LINE,
    marginVertical: (LINE_ROW - LINE) / 2,
    padding: 0,
    borderWidth: 0,
    textAlignVertical: 'top',
  },
  // The hour's own lines are what the hour is about: a little heavier than what is under them.
  top: { fontWeight: '700' },
  tag: { marginTop: (LINE_ROW - 20) / 2, marginLeft: 6 },
  out: { width: LINE_ROW, height: LINE_ROW, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shift: { width: 42, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 18 },
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
