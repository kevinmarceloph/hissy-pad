import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { findCategory, shortLabel, type Category } from '@hissypad/core/hours';
import { hourLabel, type SlotState } from '@hissypad/core/hours';
import { DEED_EMPTY, EMPTY, firstLine, hasPlan, isLogged, planState, type Entry, type EntryPatch } from '@hissypad/core/hours';
import { flagChoice, flagOption, setFlagChoice, type Flag } from '@hissypad/core/hours';

import type { SlotCount } from '@hissypad/core';

import { FlagMark } from './FlagMark';
import { Items } from './Items';
import { Mark, planOutline } from './Mark';
import { Tap } from './Tap';
import { LINE, ROW, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The calendar day this hour is stored under.
  day: string;
  hour: number;
  // The pad's lines assigned to this hour: how many are crossed out and how many are open.
  count?: SlotCount | undefined;
  entry: Entry | undefined;
  // The plan in `entry` is a recurring one, drawn on this hour and not stored on it.
  recurring?: boolean;
  state: SlotState;
  open: boolean;
  // Every category and every flag in order, archived ones included.
  categories: Category[];
  flags: Flag[];
  onEditFlags?: (() => void) | undefined;
  onOpen(): void;
  onClose(): void;
  onSave(patch: EntryPatch): void;
  // A press on the box: marks the hour done as planned, or not done. Absent where the box
  // has nothing to do (an hour still ahead, or one with no plan and nothing logged).
  onMark?: (() => void) | undefined;
};

export function HourRow(props: Props) {
  const { hour, entry, state, open, categories, flags, count, onOpen, onClose, onMark } = props;
  const theme = useTheme();
  const label = hourLabel(hour);
  const logged = isLogged(entry);
  const isNow = state === 'now';
  // An id with no category on this device shows as untagged; the id itself is kept.
  const category = findCategory(categories, entry?.category);
  // The row has one line, so a category shows by its short name: the part before an em dash.
  const categoryName = category ? shortLabel(category.label) : null;
  // A text can run to many lines. The list shows the first, like the subject of a commit.
  const note = firstLine(entry?.note ?? '');

  // The plan in words, so a kept or missed hour never rests on telling two colors apart.
  const plan = findCategory(categories, entry?.planned);
  const planned = hasPlan(entry);
  const planWords = firstLine(entry?.plannedNote ?? '');
  const planLabel = plan ? shortLabel(plan.label) : entry?.planned ? 'a category not on this device' : null;
  const against = planState(entry);
  // Beside a logged hour there is room for one short thing; an hour with only a plan shows all of it.
  const planShort = !planned ? null : against === 'kept' ? 'as planned' : `planned ${planLabel ?? planWords}`;
  const planFull = planned ? `planned ${[planLabel, planWords].filter(Boolean).join(': ')}` : null;

  // Each flag answered here, in the flags' own order, with the answer where this device knows
  // it. Flags this device does not know yet are kept on the row and left off the screen.
  const tokens = entry?.flags ?? [];
  const carried = flags.flatMap((flag) => {
    const chosen = flagChoice(tokens, flag.id);
    return chosen === null ? [] : [{ flag, option: flagOption(flag, chosen) }];
  });
  // The row shows one line. Flags and how the hour stands against its plan are still said
  // in words to a screen reader; on the screen the flags are icons and the box says the rest.
  const aside = [...carried.map(({ flag, option }) => (option ? `${flag.label}: ${option.label}` : flag.label)), planShort]
    .filter(Boolean)
    .join(', ');

  const main = logged
    ? [categoryName ?? (note ? null : 'Untagged'), note || null].filter(Boolean).join(': ')
    : planFull
      ? state === 'past'
        ? `blank, ${planFull}`
        : planFull
      : state === 'future'
        ? 'not yet'
        : 'blank';
  const items = count ? count.done + count.open : 0;
  const itemsSpoken = items > 0 ? `, ${count!.done} of ${items} ${items === 1 ? 'item' : 'items'} done` : '';
  const spoken = (logged && aside ? `${main}, ${aside}` : main) + itemsSpoken;

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
        <Mark
          style={styles.swatch}
          fill={logged ? (category ? theme.palette[category.color] : theme.ink) : null}
          outline={planOutline(entry, plan, logged, theme)}
          kept={against === 'kept'}
          faint={state === 'future'}
        />
        {logged ? (
          <Text numberOfLines={1} style={[styles.text, styles.note, { color: theme.ink }]}>
            {(category || !note) && <Text style={{ color: theme.inkSoft }}>{categoryName ?? 'Untagged'}</Text>}
            {category && note ? '  ' : ''}
            {note}
          </Text>
        ) : planned ? (
          // Nothing is logged, so the one text on the row is the plan. Italics, and the
          // hollow box beside it, say it is a plan and not a deed.
          <Text numberOfLines={1} style={[styles.text, styles.note, styles.italic, { color: theme.ink }]}>
            {planLabel && <Text style={{ color: theme.inkSoft }}>{planLabel}</Text>}
            {planLabel && planWords ? '  ' : ''}
            {planWords}
          </Text>
        ) : (
          <Text numberOfLines={1} style={[styles.text, styles.note, { color: theme.inkQuiet }]}>
            {isNow ? 'happening now' : state === 'past' ? 'blank' : ''}
          </Text>
        )}
        {items > 0 && (
          // The pad's lines in this hour: done out of all. A tick leads when every one is done,
          // so the count never rests on its weight alone.
          <Text aria-hidden style={[styles.items, { color: count!.open === 0 ? theme.ink : theme.inkSoft }, count!.open === 0 && { fontWeight: '700' }]}>
            {count!.open === 0 ? '✓ ' : ''}
            {count!.done}/{items}
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
      {onMark && !open && (
        // The box is the hour's checkbox. It sits over the row as its own control, beside
        // the row's button and not inside it, and takes the box and the gaps around it.
        <Tap
          role="checkbox"
          aria-checked={logged}
          aria-label={logged ? `${label} done` : `${label} done as planned`}
          onPress={onMark}
          ringInside
          style={styles.mark}
          // A frame, not a fill: the box itself is drawn under this, in the row.
          activeStyle={{ borderColor: theme.line }}>
          {null}
        </Tap>
      )}

      {open && <Editor {...props} logged={logged} />}
    </View>
  );
}

type EditorProps = Omit<Props, 'open' | 'onOpen' | 'onMark'> & { logged: boolean };

// Before its hour, an hour can only be planned: one text and one category. Once the hour
// has started the editor asks what happened, starting from the plan's own words. The plan
// is then shown to be read, and a small Edit button opens it, so the hour in progress (or
// one already gone) can still be given a plan or have its plan corrected.
function Editor({ day, hour, entry, recurring, state, logged, categories, flags, onEditFlags, onSave, onClose }: EditorProps) {
  const theme = useTheme();
  const ahead = state === 'future' && !logged;
  const savedNote = entry?.note ?? '';
  const savedPlan = entry?.plannedNote ?? '';
  // An hour that has started with nothing written yet opens with the plan in the field.
  const prefilled = !ahead && !logged && savedPlan.trim() !== '';
  const [note, setNote] = useState(prefilled ? savedPlan : savedNote);
  const [planWords, setPlanWords] = useState(savedPlan);
  // The prefill is a suggestion: it is saved by Done or by any other choice made here, not
  // by merely opening the hour and leaving it.
  const [touched, setTouched] = useState(false);
  // Ahead of the hour the plan is all there is to edit. After that it opens on request. An
  // editor that was opened ahead keeps the plan's fields when the hour starts under it, or
  // the words being typed there would go with them.
  const [openedAhead] = useState(ahead);
  const [editingPlan, setEditingPlan] = useState(false);
  const planOpen = ahead || editingPlan || openedAhead;

  // The hour can change under an open editor: another device's edit lands, or a recurring
  // plan is made or changed. A draft that still holds what was saved follows the new value;
  // without this the next blur would write the old words back over the newer ones. A draft
  // with typing in it is left alone.
  const [seen, setSeen] = useState({ note: savedNote, plan: savedPlan });
  if (seen.note !== savedNote || seen.plan !== savedPlan) {
    setSeen({ note: savedNote, plan: savedPlan });
    if (planWords === seen.plan) setPlanWords(savedPlan);
    if (seen.note !== savedNote) {
      if (!touched || note === seen.note) setNote(savedNote);
    } else if (prefilled && !touched && seen.plan.trim() !== '' && note === seen.plan) {
      // The field held the plan's words as a suggestion: it holds the new plan's.
      setNote(savedPlan);
    }
  }

  // Like the words, the planned category is offered as where the hour went: an hour that
  // has started with nothing logged opens with it chosen, in italics. It is saved by Done
  // or by anything else that logs the hour, and choosing in the list (None included)
  // settles it either way.
  const [categoryChosen, setCategoryChosen] = useState(false);
  const suggested = !ahead && !logged && !categoryChosen ? (entry?.planned ?? null) : null;

  const at = hourLabel(hour);
  const past = state === 'past';
  const on = entry?.flags ?? [];
  // The editor asks about the active flags, plus one answered here that has since been archived.
  const asked = flags.filter((f) => !f.archived || flagChoice(on, f.id) !== null);
  const plan = findCategory(categories, entry?.planned);

  // What is typed and not yet saved. `always` is Done or another choice in the editor; a
  // field merely losing focus leaves an untouched prefill alone.
  const unsaved = (always: boolean): EntryPatch => {
    const noteRides = !ahead && note !== savedNote && (always || touched || !prefilled);
    return {
      ...(noteRides ? { note } : {}),
      // The planned category goes with whatever logs the hour, unless another was chosen.
      // Done alone logs it too, except while the plan is being edited: planning the hour
      // in progress is not logging it.
      ...(suggested !== null && (noteRides || (always && !editingPlan)) ? { category: suggested } : {}),
      ...(planOpen && planWords !== savedPlan ? { plannedNote: planWords } : {}),
    };
  };
  // The texts ride along with any other change made while they are still unsaved.
  const withTexts = (patch: EntryPatch): EntryPatch => ({ ...unsaved(true), ...patch });
  const save = (always: boolean) => {
    const patch = unsaved(always);
    if (Object.keys(patch).length > 0) onSave(patch);
  };
  const confirm = () => save(true);
  // Written when a field is left, not on every keystroke.
  const commit = () => save(false);

  // Leaving a field by pressing a control must not save on the way: the save redraws the
  // summary above the list, the rows move a few pixels between press and release, and the
  // browser drops the click. So a blur that happens under a press is skipped. The press
  // itself carries the texts, and if it is cancelled they are saved as it ends.
  const pressing = useRef(false);
  const alive = useRef(true);
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const hold = {
    onPressIn: () => {
      pressing.current = true;
    },
    onPressOut: () => {
      pressing.current = false;
      setTimeout(() => alive.current && latest.current(), 0);
    },
  };
  const leave = () => {
    if (!pressing.current) commit();
  };

  const field = (
    id: string,
    question: string,
    value: string,
    onChange: (next: string) => void,
    options: { placeholder: string; italic: boolean; focus: boolean },
  ) => (
    <View style={styles.group}>
      <Text nativeID={`${id}${hour}`} style={[styles.label, { color: theme.inkSoft }]}>
        {question}
      </Text>
      <TextInput
        autoFocus={options.focus}
        multiline
        rows={Math.min(8, Math.max(2, value.split('\n').length))}
        value={value}
        onChangeText={onChange}
        onBlur={leave}
        onKeyPress={(e) => {
          const key = e.nativeEvent as { key: string; metaKey?: boolean; ctrlKey?: boolean };
          if (key.key === 'Escape') onClose();
          // Return starts a new line. With Command or Control it is Done.
          if (key.key === 'Enter' && (key.metaKey || key.ctrlKey)) {
            confirm();
            onClose();
          }
        }}
        aria-labelledby={`${id}${hour}`}
        accessibilityLabel={question}
        placeholder={options.placeholder}
        placeholderTextColor={theme.inkQuiet}
        maxLength={280}
        style={[
          styles.input,
          options.italic && styles.italic,
          { color: theme.ink, borderColor: theme.accent, backgroundColor: theme.paper, outlineColor: theme.accent },
        ]}
      />
    </View>
  );

  // Planned words stay in italics: in the plan's own field, where the plan is shown to be
  // read, and in the field for what happened for as long as it still holds the plan untouched.
  const planFields = (
    <>
      {field('p', past ? `What was ${at} for?` : `What is ${at} for?`, planWords, setPlanWords, {
        placeholder: 'proposals, gym, errands',
        italic: true,
        focus: planOpen,
      })}
      <Picker
        title={past ? 'Where it was meant to go' : 'Where it should go'}
        kind="plan"
        value={entry?.planned ?? null}
        categories={categories}
        onPick={(planned) => {
          // Changing the plan is not saying where the hour went: the old plan's category
          // is not logged on the way.
          const { category: _suggestion, ...texts } = unsaved(true);
          onSave({ ...texts, planned });
        }}
        hold={hold}
      />
      {recurring && (
        <Text style={[styles.label, { color: theme.inkSoft }]}>
          From a recurring plan. A change here is for this hour only.
        </Text>
      )}
    </>
  );

  return (
    <View style={styles.editor}>
      {ahead ? (
        planFields
      ) : (
        <>
          {field(
            'q',
            `What happened at ${at}?`,
            note,
            (next) => {
              setNote(next);
              setTouched(true);
            },
            { placeholder: 'proposals, lunch, scrolled', italic: prefilled && note === savedPlan, focus: !planOpen },
          )}

          {planOpen ? (
            planFields
          ) : (
            <View style={styles.planned}>
              <View style={styles.plannedText}>
                <View style={styles.plannedLine}>
                  <Mark
                    style={styles.chipSwatch}
                    outline={entry?.planned ? (plan ? theme.palette[plan.color] : theme.ink) : null}
                    faint
                  />
                  <Text style={[styles.label, styles.italic, { color: theme.inkSoft }]}>
                    {entry?.planned
                      ? `${recurring ? 'Recurring plan' : 'Planned'}: ${plan?.label ?? 'a category not on this device'}`
                      : savedPlan.trim() !== ''
                        ? recurring
                          ? 'Recurring plan, with no category'
                          : 'Planned, with no category'
                        : 'No plan for this hour'}
                  </Text>
                </View>
                {savedPlan.trim() !== '' && (
                  <Text style={[styles.plannedWords, styles.italic, { color: theme.ink }]}>{savedPlan.trim()}</Text>
                )}
              </View>
              <Tap
                {...hold}
                aria-label="Edit the plan"
                onPress={() => setEditingPlan(true)}
                style={[styles.small, { borderColor: theme.line }]}
                activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
                <Text style={[styles.chipText, { color: theme.ink }]}>Edit</Text>
              </Tap>
            </View>
          )}

          <Picker
            title="Where it went"
            kind="done"
            value={entry?.category ?? suggested}
            suggested={suggested !== null}
            categories={categories}
            onPick={(category) => {
              setCategoryChosen(true);
              onSave(withTexts({ category }));
            }}
            hold={hold}
          />
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
                            {...hold}
                            role="radio"
                            aria-checked={checked}
                            aria-label={`${flag.label}: ${option.label}`}
                            // Pressing the chosen answer takes it back: unset is a state of its own.
                            onPress={() => onSave(withTexts({ flags: setFlagChoice(on, flag.id, checked ? null : option.id) }))}
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
                <Tap {...hold} role="link" onPress={onEditFlags} style={[styles.editLink, styles.editFlags]} activeStyle={{ backgroundColor: theme.paper }}>
                  <Text style={[styles.chipText, styles.underline, { color: theme.inkSoft }]}>Edit flags</Text>
                </Tap>
              )}
            </View>
          )}
        </>
      )}

      <Items day={day} hour={hour} hold={hold} />

      <View style={styles.actions}>
        <Tap
          {...hold}
          // A recurring plan is not this hour's to clear: there is nothing stored here yet.
          disabled={ahead ? recurring || (planWords === '' && !entry?.planned) : !logged && note === ''}
          onPress={() => {
            if (ahead) setPlanWords('');
            else setNote('');
            setTouched(true);
            setCategoryChosen(true);
            // Once the hour has started, clearing takes what happened and leaves the plan.
            onSave(ahead ? EMPTY : DEED_EMPTY);
          }}
          style={styles.action}
          activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.actionText, { color: theme.inkSoft }]}>Clear this hour</Text>
        </Tap>
        <Tap
          {...hold}
          onPress={() => {
            confirm();
            onClose();
          }}
          style={[styles.action, styles.done, { borderColor: theme.ink }]}
          activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.actionText, { color: theme.ink, fontWeight: '700' }]}>Done</Text>
        </Tap>
      </View>
    </View>
  );
}

type PickerProps = {
  title: string;
  // The plan's swatches are hollow and the deed's are filled: the same two shapes the strip uses.
  kind: 'done' | 'plan';
  value: string | null;
  categories: Category[];
  onPick(id: string | null): void;
  // `value` is offered, not saved: it shows in italics, and choosing it is still a choice.
  suggested?: boolean;
  // Press handlers every control in the hour editor shares (see Editor). Other screens leave it out.
  hold?: { onPressIn(): void; onPressOut(): void };
};

// A dropdown of categories: one closed line that says what is chosen, and a list that
// opens under it. Built from Taps, not a native select, so every option keeps its swatch
// and the same control runs on phones and the web.
export function Picker({ title, kind, value, categories, onPick, suggested = false, hold }: PickerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // The active categories, plus this hour's own one if it has since been archived, so it
  // can still be seen and taken off.
  const choices = categories.filter((c) => !c.archived || c.id === value);
  const current = findCategory(categories, value);
  const shown = current?.label ?? (value ? 'A category not on this device' : 'None');
  const swatch = (color: string | null) => (
    <Mark style={styles.chipSwatch} fill={kind === 'done' ? color : null} outline={kind === 'plan' ? color : null} />
  );
  const pick = (id: string | null) => {
    setOpen(false);
    if (id !== value || suggested) onPick(id);
  };

  return (
    <View style={styles.group}>
      <Text style={[styles.label, { color: theme.inkSoft }]}>{title}</Text>
      <Tap
        {...hold}
        aria-expanded={open}
        aria-label={`${title}: ${shown}${suggested ? ', from the plan' : ''}`}
        onPress={() => setOpen(!open)}
        style={[styles.select, { borderColor: open ? theme.ink : theme.line, backgroundColor: theme.paper }]}
        activeStyle={{ borderColor: theme.ink }}>
        {swatch(current ? theme.palette[current.color] : value ? theme.ink : null)}
        <Text numberOfLines={1} style={[styles.selectText, suggested && styles.italic, { color: value ? theme.ink : theme.inkSoft }]}>
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
                {...hold}
                role="option"
                aria-selected={on}
                aria-label={choice?.label ?? 'None'}
                onPress={() => pick(choice?.id ?? null)}
                style={[styles.option, { borderTopColor: theme.rule }]}
                activeStyle={{ backgroundColor: theme.paperRaised }}>
                {swatch(choice ? theme.palette[choice.color] : null)}
                <Text style={[styles.selectText, { color: theme.ink }, on && { fontWeight: '700' }]}>
                  {choice?.label ?? 'None'}
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
  swatch: { width: 14, height: 14 },
  // Over the box: the row's padding, the hour and one gap to its left, one gap to its right.
  mark: { position: 'absolute', top: 0, left: 4 + 46, width: 12 + 14 + 12, height: ROW, borderRadius: 4, borderWidth: 1, borderColor: 'transparent' },
  text: { flex: 1 },
  note: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  flags: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  editor: { paddingLeft: 62, paddingRight: 4, paddingBottom: 16, gap: 12 },
  group: { gap: 6 },
  italic: { fontStyle: 'italic' },
  planned: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  plannedText: { flex: 1, gap: 2, paddingTop: 4 },
  plannedLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plannedWords: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
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
