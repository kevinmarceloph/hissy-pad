import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { categoryName, categoryShort, findCategory, type Category } from '@hissypad/core/hours';
import { hourLabel, type HourShown, type SlotState } from '@hissypad/core/hours';

import { Mark } from './Mark';
import { HostedLines } from './HostedLines';
import { StateMark } from './StateMark';
import { Tap } from './Tap';
import { LINE, ROW, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The calendar day this hour is stored under.
  day: string;
  hour: number;
  // What the row says: the first line put in the hour (its words, category and state) and
  // how many more follow, or what an hour with no lines falls back on.
  says: HourShown;
  // Lines crossed out during this hour that were not assigned to it (cleared ones too).
  extra?: number | undefined;
  state: SlotState;
  open: boolean;
  // Every category in order, archived ones included.
  categories: Category[];
  onOpen(): void;
  onClose(): void;
};

// One hour: a row that says what is in it, and, open, a pad scoped to it (Kevin,
// 2026-11-27, "rethink the hour view, round 3"). The hour has nothing of its own to set:
// no state, no summary, no category, no flags (hidden, kept for a later version). Its
// title is its first line and "+N" for the others; its bullet is that line's state. A
// summary for the hour is a line typed into it.
export function HourRow(props: Props) {
  const { hour, says, state, open, categories, extra = 0, onOpen, onClose } = props;
  const theme = useTheme();
  const label = hourLabel(hour);
  const isNow = state === 'now';
  const mark = says.state;
  // An id with no category on this device shows as untagged; the id itself is kept.
  const category = findCategory(categories, says.category);
  // The row has one line, so a category shows by its icon, or by its name when it has none.
  const categoryShown = category ? categoryShort(category) : null;

  // A category id this device does not know, on an hour with no words, reads as untagged.
  const untagged = !category && says.category !== null && !says.title;
  const words = untagged ? 'Untagged' : [categoryShown, says.title || null].filter(Boolean).join(': ');
  // The row says in words what the mark and the counts show.
  const spoken = [
    words || (says.from !== null ? '(blank line)' : state === 'future' ? 'not yet' : 'blank'),
    says.more > 0 ? `and ${says.more} more` : null,
    mark === 'open' ? null : mark,
    extra > 0 ? `${extra} more done` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={[styles.wrap, { borderBottomColor: theme.rule }, open && { backgroundColor: theme.paperRaised }]}>
      <Tap
        onPress={open ? onClose : onOpen}
        aria-expanded={open}
        aria-label={`${label}${isNow ? ', now' : ''}: ${spoken}`}
        style={styles.row}
        activeStyle={{ backgroundColor: theme.paperRaised }}>
        <Text
          style={[
            styles.hour,
            { color: isNow ? theme.accent : theme.inkQuiet },
            isNow && { fontWeight: '700' },
          ]}>
          {label}
        </Text>
        {/* The hour's bullet is its first line's: a dot, a dot in a ring, a cross (first
            item done = hour done). In its category's color; an hour still ahead with
            nothing in it draws its dot faint. It is part of the row's button. */}
        <StateMark
          large
          style={styles.swatch}
          state={mark}
          color={category ? theme.palette[category.color] : state === 'future' && !words && mark === 'open' ? theme.rule : theme.inkSoft}
        />
        {words ? (
          <Text numberOfLines={1} style={[styles.text, styles.note, { color: mark === 'done' ? theme.inkQuiet : theme.ink }]}>
            {(categoryShown || untagged) && <Text style={{ color: theme.inkSoft }}>{categoryShown ?? 'Untagged'}</Text>}
            {categoryShown && says.title ? '  ' : ''}
            {says.title}
          </Text>
        ) : (
          <Text numberOfLines={1} style={[styles.text, styles.note, { color: theme.inkQuiet }]}>
            {isNow ? 'happening now' : state === 'past' && says.from === null ? 'blank' : ''}
          </Text>
        )}
        {says.more > 0 && (
          // The other lines put in the hour, after the one the row shows.
          <Text aria-hidden style={[styles.items, { color: theme.inkSoft }]}>
            +{says.more}
          </Text>
        )}
        {extra > 0 && (
          // The lines crossed out in this hour that were assigned elsewhere or nowhere,
          // cleared ones too: a cross, the pad's mark for a line done, and how many (Kevin,
          // 2026-11-25). The open hour lists them behind "Done in this hour".
          <Text aria-hidden style={[styles.items, { color: theme.inkSoft }]}>
            ✕{extra}
          </Text>
        )}
      </Tap>
      {open && (
        <View style={styles.editor}>
          <HostedLines day={props.day} hour={hour} onClose={onClose} />
        </View>
      )}
    </View>
  );
}

type PickerProps = {
  title: string;
  // Hollow or filled swatches (the recurring plans' picker draws its own hollow).
  kind: 'done' | 'plan';
  value: string | null;
  categories: Category[];
  onPick(id: string | null): void;
};

// The recurring plans' dropdown of categories: one closed line that says what is chosen,
// and a list that opens under it. Built from Taps, not a native select, so every option
// keeps its swatch and the same control runs on phones and the web.
export function Picker({ title, kind, value, categories, onPick }: PickerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // The active categories, plus the chosen one if it has since been archived, so it can
  // still be seen and taken off.
  const choices = categories.filter((c) => !c.archived || c.id === value);
  const current = findCategory(categories, value);
  const shown = current ? categoryName(current) : (value ? 'A category not on this device' : 'None');
  const swatch = (color: string | null) => (
    <Mark style={styles.chipSwatch} fill={kind === 'done' ? color : null} outline={kind === 'plan' ? color : null} />
  );
  const pick = (id: string | null) => {
    setOpen(false);
    if (id !== value) onPick(id);
  };

  return (
    <View style={styles.group}>
      <Text style={[styles.label, { color: theme.inkSoft }]}>{title}</Text>
      <Tap
        aria-expanded={open}
        aria-label={`${title}: ${shown}`}
        onPress={() => setOpen(!open)}
        style={[styles.select, { borderColor: open ? theme.ink : theme.line, backgroundColor: theme.paper }]}
        activeStyle={{ borderColor: theme.ink }}>
        {swatch(current ? theme.palette[current.color] : value ? theme.ink : null)}
        <Text numberOfLines={1} style={[styles.selectText, { color: value ? theme.ink : theme.inkSoft }]}>
          {shown}
        </Text>
        <Text aria-hidden style={[styles.caret, { color: theme.ink }]}>
          {open ? '▴' : '▾'}
        </Text>
      </Tap>

      {open && (
        // React Native's Role type has no listbox; the web does, and that is where roles are read.
        <View role={'listbox' as 'list'} aria-label={title} style={[styles.options, { borderColor: theme.ink, backgroundColor: theme.paper }]}>
          {[null, ...choices].map((choice) => {
            const on = (choice?.id ?? null) === value;
            return (
              <Tap
                key={choice?.id ?? 'none'}
                role="option"
                aria-selected={on}
                aria-label={choice ? categoryName(choice) : 'None'}
                onPress={() => pick(choice?.id ?? null)}
                style={[styles.option, { borderTopColor: theme.rule }]}
                activeStyle={{ backgroundColor: theme.paperRaised }}>
                {swatch(choice ? theme.palette[choice.color] : null)}
                <Text style={[styles.selectText, { color: theme.ink }, on && { fontWeight: '700' }]}>
                  {choice ? categoryName(choice) : 'None'}
                </Text>
                {/* A tick, not only bold type, marks the chosen one. */}
                {on && <Text style={[styles.caret, { color: theme.ink }]}>✓</Text>}
              </Tap>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  hour: { width: 46, textAlign: 'right', fontFamily: serif, fontSize: SMALL, lineHeight: LINE },
  swatch: { width: 18, height: 18 },
  text: { flex: 1 },
  note: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  // The open hour is its lines, under the row's words: no box around them, no fields.
  editor: { paddingLeft: 53, paddingRight: 4, paddingBottom: 8 },
  group: { gap: 6 },
  label: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  items: { fontFamily: serif, fontSize: SMALL, lineHeight: 20, fontVariant: ['tabular-nums'] },
  chipSwatch: { width: 14, height: 14 },
  select: {
    minHeight: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 4,
  },
  selectText: { flex: 1, fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  caret: { fontSize: SIZE, lineHeight: LINE },
  options: { borderWidth: 1, borderRadius: 4, overflow: 'hidden' },
  option: {
    minHeight: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
