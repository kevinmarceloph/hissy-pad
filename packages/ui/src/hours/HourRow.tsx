import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { categoryName, categoryShort, findCategory, type Category } from '@hissypad/core/hours';
import { hourLabel, type SlotState } from '@hissypad/core/hours';
import { EMPTY, hourShown, hourState, isLogged, type Entry, type EntryPatch } from '@hissypad/core/hours';
import { flagChoice, flagOption, setFlagChoice, type Flag } from '@hissypad/core/hours';

import type { NodeRow, SlotCount } from '@hissypad/core';

import { FlagMark } from './FlagMark';
import { Mark } from './Mark';
import { HostedLines, useHostedLines } from './HostedLines';
import { MiniPad } from './MiniPad';
import { StateMark, StateSwitch } from './StateMark';
import { Tap } from './Tap';
import { LINE, ROW, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The calendar day this hour is stored under.
  day: string;
  hour: number;
  // The line on top of the hour's list: what the row says when no summary was typed.
  top?: NodeRow | undefined;
  // What the row counts, crossed out and open: the hour's lines, or the lines right under
  // its one line (slotProgress).
  count?: SlotCount | undefined;
  // Lines crossed out during this hour that were not assigned to it (cleared ones too).
  extra?: number | undefined;
  // The hour as drawn: with the recurring plan that covers it, if it has no words of its own.
  entry: Entry | undefined;
  state: SlotState;
  open: boolean;
  // Every category and every flag in order, archived ones included.
  categories: Category[];
  flags: Flag[];
  onEditFlags?: (() => void) | undefined;
  onOpen(): void;
  onClose(): void;
  onSave(patch: EntryPatch): void;
};

export function HourRow(props: Props) {
  const { hour, entry, state, open, categories, flags, top, count, extra = 0, onOpen, onClose } = props;
  const theme = useTheme();
  const label = hourLabel(hour);
  const isNow = state === 'now';
  const mark = hourState(entry);
  // The summary typed for the hour, or the line on top of its list, or what it falls back on.
  const shown = hourShown(entry, top);
  // An id with no category on this device shows as untagged; the id itself is kept.
  const category = findCategory(categories, shown.category);
  // The row has one line, so a category shows by its icon, or by its name when it has none.
  const categoryShown = category ? categoryShort(category) : null;

  // Each flag answered here, in the flags' own order, with the answer where this device knows
  // it. Flags this device does not know yet are kept on the row and left off the screen.
  const tokens = entry?.flags ?? [];
  const carried = flags.flatMap((flag) => {
    const chosen = flagChoice(tokens, flag.id);
    return chosen === null ? [] : [{ flag, option: flagOption(flag, chosen) }];
  });
  const aside = carried.map(({ flag, option }) => (option ? `${flag.label}: ${option.label}` : flag.label)).join(', ');

  // A category id this device does not know, on an hour with no words, reads as untagged.
  const untagged = !category && shown.category !== null && !shown.title;
  const words = untagged ? 'Untagged' : [categoryShown, shown.title || null].filter(Boolean).join(': ');
  const items = count ? count.done + count.open : 0;
  // The row says in words what the mark, the count and the flag icons show.
  const spoken = [
    words || (mark !== 'open' ? null : state === 'future' ? 'not yet' : 'blank'),
    mark === 'open' ? null : mark,
    aside || null,
    items > 0 ? `${count!.done} of ${items} ${items === 1 ? 'item' : 'items'} done` : null,
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
        {/* The hour's bullet: a dot, a dot in a ring, a cross. In its category's color; an
            hour still ahead with nothing in it draws its dot faint. It is part of the row's
            button and opens the hour like the rest of it (Kevin, 2026-11-25: it used to be
            a checkbox of its own, Oras-oras's). The switch in the open hour sets the state. */}
        <StateMark
          large
          style={styles.swatch}
          state={mark}
          color={category ? theme.palette[category.color] : state === 'future' && !words && mark === 'open' ? theme.rule : theme.inkSoft}
        />
        {words ? (
          <Text numberOfLines={1} style={[styles.text, styles.note, { color: mark === 'done' ? theme.inkQuiet : theme.ink }]}>
            {(categoryShown || untagged) && <Text style={{ color: theme.inkSoft }}>{categoryShown ?? 'Untagged'}</Text>}
            {categoryShown && shown.title ? '  ' : ''}
            {shown.title}
          </Text>
        ) : (
          <Text numberOfLines={1} style={[styles.text, styles.note, { color: theme.inkQuiet }]}>
            {isNow ? 'happening now' : state === 'past' && mark === 'open' ? 'blank' : ''}
          </Text>
        )}
        {(items > 0 || extra > 0) && (
          // Crossed out, out of all. A tick leads when every one is done, so the count never
          // rests on its weight alone. "+N" after it is the lines crossed out in this hour
          // that were assigned elsewhere or nowhere, cleared ones too.
          <Text aria-hidden style={[styles.items, { color: theme.inkSoft }]}>
            {items > 0 && (
              <Text style={[{ color: count!.open === 0 ? theme.ink : theme.inkSoft }, count!.open === 0 && { fontWeight: '700' }]}>
                {count!.open === 0 ? '✓ ' : ''}
                {count!.done}/{items}
              </Text>
            )}
            {items > 0 && extra > 0 ? ' ' : ''}
            {extra > 0 ? `+${extra}` : ''}
          </Text>
        )}
        {carried.length > 0 && (
          // One mark per answered flag, flush right: its icon on the color of the answer.
          <View aria-hidden style={styles.flags}>
            {carried.map(({ flag, option }) => (
              <FlagMark key={flag.id} flag={flag} option={option} />
            ))}
          </View>
        )}
      </Tap>
      {open && <Editor {...props} />}
    </View>
  );
}

// The open hour is a small pad: the lines put in it and what is under them (MiniPad). Over
// it, the hour's own three states, and a Summary button: behind it, a title for the hour
// and a category, for an hour that is not about its top line. Under it, the flags. Nothing
// here is a draft: every change is written as it is made.
function Editor({ day, hour, entry, top, categories, flags, onEditFlags, onSave, onClose }: Props) {
  const theme = useTheme();
  const at = hourLabel(hour);
  const hosted = useHostedLines() !== null;
  const on = entry?.flags ?? [];
  // The editor asks about the active flags, plus one answered here that has since been archived.
  const asked = flags.filter((f) => !f.archived || flagChoice(on, f.id) !== null);
  const title = entry?.note ?? '';
  // The summary stays out of the way until asked for, unless the hour already has one.
  const [summing, setSumming] = useState(title.trim() !== '' || (entry?.category ?? null) !== null);
  const fallback = findCategory(categories, hourShown({ ...(entry ?? BLANK), category: null }, top).category);

  return (
    <View style={styles.editor}>
      <View style={styles.head}>
        <StateSwitch label={`${at}`} value={hourState(entry)} onChange={(state) => onSave({ state })} />
        <Tap
          aria-label="Summary"
          aria-expanded={summing}
          onPress={() => setSumming(!summing)}
          style={[styles.small, { borderColor: summing ? theme.ink : theme.line }]}
          activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
          <Text style={[styles.chipText, { color: theme.ink }]}>Summary</Text>
        </Tap>
      </View>

      {summing && (
        <>
          <View style={styles.group}>
            <Text nativeID={`t${hour}`} style={[styles.label, { color: theme.inkSoft }]}>
              A title for {at}, in place of its top line
            </Text>
            <TextInput
              autoFocus={title === ''}
              value={title}
              onChangeText={(note) => onSave({ note })}
              onKeyPress={(e) => {
                const key = (e.nativeEvent as { key: string }).key;
                if (key === 'Escape' || key === 'Enter') onClose();
              }}
              aria-labelledby={`t${hour}`}
              accessibilityLabel={`Summary of ${at}`}
              placeholder="proposals, lunch, errands"
              placeholderTextColor={theme.inkQuiet}
              maxLength={280}
              style={[styles.input, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.paper, outlineColor: theme.accent }]}
            />
          </View>
          <Picker title="Category" kind="done" value={entry?.category ?? null} categories={categories} onPick={(category) => onSave({ category })} />
          {(entry?.category ?? null) === null && fallback && (
            <Text style={[styles.label, { color: theme.inkSoft }]}>With none chosen, the hour takes its top line's: {categoryName(fallback)}.</Text>
          )}
        </>
      )}

      {/* The app's own pad editor where the host hands one in; the small pad where not. */}
      {hosted ? <HostedLines day={day} hour={hour} onClose={onClose} /> : <MiniPad day={day} hour={hour} onClose={onClose} />}

      {(asked.length > 0 || onEditFlags) && (
        <View style={styles.group}>
          <Text style={[styles.label, { color: theme.inkSoft }]}>Flags</Text>
          {asked.map((flag) => {
            const chosen = flagChoice(on, flag.id);
            // The flag's own answers, plus an archived one this hour still carries.
            const offered = flag.options.filter((o) => !o.archived || o.id === chosen);
            return (
              <View key={flag.id} style={styles.flagLine}>
                <Text style={[styles.chipText, styles.flagName, { color: theme.ink }]}>
                  {flag.icon ? `${flag.icon} ${flag.label}` : flag.label}
                </Text>
                <View role="radiogroup" aria-label={flag.label} style={styles.chips}>
                  {offered.map((option) => {
                    const checked = option.id === chosen;
                    const color = theme.palette[option.color];
                    return (
                      <Tap
                        key={option.id}
                        role="radio"
                        aria-checked={checked}
                        aria-label={`${flag.label}: ${option.label}`}
                        // Pressing the chosen answer takes it back: unset is a state of its own.
                        onPress={() => onSave({ flags: setFlagChoice(on, flag.id, checked ? null : option.id) })}
                        style={[styles.chip, { borderColor: checked ? theme.ink : theme.line }, checked && { backgroundColor: theme.paper }]}
                        activeStyle={{ borderColor: theme.ink }}>
                        {/* The swatch is the color the row will show. The tick and the bold
                            type, not the color, say which answer is chosen. */}
                        <View style={[styles.tick, { borderColor: color, backgroundColor: color }]}>
                          {checked && <Text style={[styles.tickText, { color: theme.paper }]}>✓</Text>}
                        </View>
                        <Text style={[styles.chipText, { color: theme.ink }, checked && { fontWeight: '700' }]}>
                          {option.label}
                        </Text>
                      </Tap>
                    );
                  })}
                </View>
              </View>
            );
          })}
          {onEditFlags && (
            <Tap role="link" onPress={onEditFlags} style={[styles.editLink, styles.editFlags]} activeStyle={{ backgroundColor: theme.paper }}>
              <Text style={[styles.chipText, styles.underline, { color: theme.inkSoft }]}>Edit flags</Text>
            </Tap>
          )}
        </View>
      )}

      <View style={styles.actions}>
        <Tap
          // What is written on the hour itself. Its lines stay: they are the pad's.
          disabled={!isLogged(entry) && hourState(entry) === 'open'}
          onPress={() => onSave(EMPTY)}
          style={styles.action}
          activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.actionText, { color: theme.inkSoft }]}>Clear this hour</Text>
        </Tap>
        <Tap onPress={onClose} style={[styles.action, styles.done, { borderColor: theme.ink }]} activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.actionText, { color: theme.ink, fontWeight: '700' }]}>Close</Text>
        </Tap>
      </View>
    </View>
  );
}

const BLANK: Entry = { day: '', hour: 0, note: '', category: null, planned: null, plannedNote: '', flags: [], state: 'open', updatedAt: 0 };

type PickerProps = {
  title: string;
  // Hollow or filled swatches (the recurring plans' picker draws its own hollow).
  kind: 'done' | 'plan';
  value: string | null;
  categories: Category[];
  onPick(id: string | null): void;
};

// A dropdown of categories: one closed line that says what is chosen, and a list that
// opens under it. Built from Taps, not a native select, so every option keeps its swatch
// and the same control runs on phones and the web.
export function Picker({ title, kind, value, categories, onPick }: PickerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // The active categories, plus this hour's own one if it has since been archived, so it
  // can still be seen and taken off.
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
  flags: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  editor: { paddingLeft: 53, paddingRight: 4, paddingBottom: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  group: { gap: 6 },
  small: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderRadius: 4 },
  label: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  input: {
    fontFamily: serif,
    fontSize: SIZE,
    lineHeight: LINE,
    minHeight: ROW,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 4,
    textAlignVertical: 'top',
  },
  items: { fontFamily: serif, fontSize: SMALL, lineHeight: 20, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // A flag's name, then its answers. The names share a width so the answers line up.
  flagLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 },
  flagName: { minWidth: 100 },
  editFlags: { marginLeft: -8 },
  chip: {
    minHeight: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 4,
  },
  chipSwatch: { width: 14, height: 14 },
  tick: { width: 16, height: 16, borderWidth: 1.5, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  tickText: { fontSize: 12, lineHeight: 14, fontWeight: '700' },
  chipText: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
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
  editLink: { minHeight: ROW, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 8, borderRadius: 4 },
  underline: { textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  action: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 4 },
  done: { borderWidth: 1, paddingHorizontal: 20 },
  actionText: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
});
