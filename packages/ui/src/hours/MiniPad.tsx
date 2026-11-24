import { useEffect, useLayoutEffect, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { slotKey, slotOutline, stateOf, type SlotRow } from '@hissypad/core';
import { usePad } from '@hissypad/state';
import {
  cmdSlotBreak, cmdSlotClear, cmdSlotErase, cmdSlotShift, cmdSlotText,
} from '@hissypad/state/hours';

import { closeLineDrawer, lineDrawer } from './LineDrawer';
import { SlotAdder } from './SlotAdder';
import { StateMark } from './StateMark';
import { Tap } from './Tap';
import { serif, SIZE, SMALL, LINE, useTheme } from './theme';

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
// and out, and Backspace on an empty one takes it away. A bullet selects its line, as in
// the pad (Kevin, 2026-11-25), and more bullets add to the selection: the drawer at the
// foot of the screen (LineDrawer) acts on what is selected, or on the line being typed.
// A line may sit in any pad, and every change here is a change to that pad.
//
// Under it, the field that brings lines in: a new one (it lands at the top of Today) or
// one found in any pad (the universal search), put in this hour with a tap, or with the
// arrow keys and Return on the web. A line archived from its pad stays listed, marked
// "archived", and can still be selected and crossed out.
export function MiniPad({ day, hour, onClose }: Props) {
  const all = usePad((s) => s.all);
  const rows = slotOutline(all, slotKey(day, hour));

  // The line last typed in, and the lines selected by their bullets. The drawer acts on
  // the selection, or else on the line being typed.
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => {
    // The phone's keyboard would sit over the drawer.
    if (Platform.OS !== 'web') Keyboard.dismiss();
    setSelected((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));
  };
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
  // What the drawer acts on, kept in its store while this hour is open.
  const targets = rows.filter((r) => (selected.length > 0 ? selected.includes(r.row.id) : r.row.id === active && r.row.deletedAt === null));
  const targetsKey = targets.map((t) => `${t.row.id}:${t.depth}`).join(' ');
  useEffect(() => {
    lineDrawer.setState({
      targets: targets.map((t) => ({ id: t.row.id, depth: t.depth })),
      selecting: selected.length > 0,
      clear: () => setSelected([]),
      // A press on the drawer took the caret out of the line being typed, and a move in or
      // out redrew it elsewhere on the page.
      after: () => selected.length === 0 && active && setFocusOn(active),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey, selected.length, active]);
  useEffect(() => closeLineDrawer, []);
  // A selected line that left the hour is no longer selected.
  const listed = rows.map((r) => r.row.id).join(' ');
  useEffect(() => {
    setSelected((was) => (was.every((id) => listed.includes(id)) ? was : was.filter((id) => listed.includes(id))));
  }, [listed]);

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

  return (
    <View style={styles.group}>
      {rows.length > 0 && (
        <View role="list" aria-label="Lines in this hour">
          {rows.map((entry, i) => (
            <Line
              key={entry.row.id}
              entry={entry}
              active={entry.row.id === active && selected.length === 0}
              selected={selected.includes(entry.row.id)}
              onSelect={() => toggle(entry.row.id)}
              register={(field) => {
                if (field) fields.current.set(entry.row.id, field);
                else fields.current.delete(entry.row.id);
              }}
              onCaret={(caret) => carets.current.set(entry.row.id, caret)}
              onFocus={() => {
                // Typing in a line ends a selection, as in the pad.
                setSelected([]);
                setActive(entry.row.id);
              }}
              onKey={(e) => onKey(e, i)}
              onBreak={() => breakLine(entry)}
            />
          ))}
        </View>
      )}

      <SlotAdder day={day} hour={hour} onClose={onClose} />
    </View>
  );
}

type LineProps = {
  entry: SlotRow;
  active: boolean;
  selected: boolean;
  onSelect(): void;
  register(field: Field | null): void;
  onCaret(caret: number): void;
  onFocus(): void;
  onKey(e: { nativeEvent: unknown; preventDefault(): void }): void;
  onBreak(): void;
};

// One line of the hour: its bullet, its words, and on one of the hour's own lines the way
// out of the hour.
function Line({ entry, active, selected, onSelect, register, onCaret, onFocus, onKey, onBreak }: LineProps) {
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
    <View role="listitem" style={[styles.line, { paddingLeft: depth * INDENT }, selected && { backgroundColor: theme.accentSoft }]}>
      {/* The bullet says the line's state and selects it. It does not change it: the
          drawer at the foot of the screen does. */}
      <Tap
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select “${words}”${state === 'open' ? '' : `, ${state}`}${archived ? ', archived' : ''}`}
        onPress={onSelect}
        style={styles.bullet}
        activeStyle={{ backgroundColor: theme.paper }}>
        <StateMark state={state} color={state === 'done' ? theme.inkQuiet : active || selected ? theme.accent : theme.inkSoft} />
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
  line: { flexDirection: 'row', alignItems: 'flex-start', minHeight: LINE_ROW, borderRadius: 4 },
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
  text: { flexShrink: 1, fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  struck: { textDecorationLine: 'line-through' },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
});
