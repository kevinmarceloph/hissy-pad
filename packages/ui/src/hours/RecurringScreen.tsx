import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { categoryName, categoryShort, findCategory, type Category } from '@hissypad/core/hours';
import { hourLabel, HOURS } from '@hissypad/core/hours';
import { firstLine } from '@hissypad/core/hours';
import {
  dayName,
  daysLabel,
  EVERY_DAY,
  NOTE_MAX,
  recurringProblem,
  spanHours,
  spanLabel,
  toggleDay,
  type RecurringFields,
  type RecurringPlan,
} from '@hissypad/core/hours';
import { useCategories, useRecurring } from './provider';

import { Picker } from './HourRow';
import { Mark } from './Mark';
import { MoveButtons } from './MoveButtons';
import { Tap } from './Tap';
import { GUTTER, LINE, MAX_WIDTH, ROW, serif, SIZE, SMALL, useTheme } from './theme';

// What a new plan starts as: one hour, every day.
const BLANK: RecurringFields = { note: '', category: null, from: 9, to: 10, days: [...EVERY_DAY] };

// A plan in a few words: its category, then the first line of its text.
function planTitle(plan: Pick<RecurringPlan, 'note' | 'category'>, categories: Category[], short = false): string {
  const category = findCategory(categories, plan.category);
  const name = category ? (short ? categoryShort(category) : categoryName(category)) : plan.category ? 'A category not on this device' : null;
  return [name, firstLine(plan.note)].filter(Boolean).join(': ');
}

// Where the plans that repeat are edited: sleep every night, a class on two weekdays. The
// flags screen's shape, with one difference: a plan has several fields that only make sense
// together, so an editor here is a draft until Save.
export function RecurringScreen({ onBack }: { onBack(): void }) {
  const theme = useTheme();
  const list = useRecurring((s) => s.list);
  const error = useRecurring((s) => s.error);
  const add = useRecurring((s) => s.add);
  const update = useRecurring((s) => s.update);
  const move = useRecurring((s) => s.move);
  const categories = useCategories((s) => s.list);

  // A plan id, 'new' for the add form, or nothing open.
  const [editing, setEditing] = useState<string | null>(null);

  const active = list.filter((p) => !p.archived);
  const archived = list.filter((p) => p.archived);

  return (
    <View style={[styles.screen, { backgroundColor: theme.paper }]}>
      <View style={styles.column}>
        <View role="banner" style={styles.header}>
          <View role="navigation" aria-label="Screens" style={styles.nav}>
            <Tap role="link" onPress={onBack} style={styles.navButton} activeStyle={{ backgroundColor: theme.paperRaised }}>
              <Text style={[styles.body, { color: theme.ink }]}>Back to the day</Text>
            </Tap>
          </View>
          <Text role="heading" aria-level={1} style={[styles.title, { color: theme.ink }]}>
            Recurring plans
          </Text>
          <Text style={[styles.small, { color: theme.inkSoft }]}>
            Plans that repeat. An hour with no lines in it shows the recurring plan that covers it, so the day comes
            already drawn. A line put in the hour takes its place. Where two recurring plans overlap, the one on fewer
            days wins, then the one higher on this list.
          </Text>
          {error && (
            <Text role="alert" style={[styles.small, { color: theme.accent }]}>
              That change was not saved and has been undone: {error}
            </Text>
          )}
        </View>

        <ScrollView
          role="main"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.list}>
          {active.length === 0 && editing !== 'new' && (
            <Text style={[styles.body, styles.empty, { color: theme.inkSoft }]}>
              No recurring plans. Add one for something you do at the same hours, like sleep.
            </Text>
          )}

          {active.map((plan, index) => {
            const open = editing === plan.id;
            const category = findCategory(categories, plan.category);
            const when = `${spanLabel(plan.from, plan.to)}, ${daysLabel(plan.days)}`;
            return (
              <View
                key={plan.id}
                style={[styles.wrap, { borderBottomColor: theme.rule }, open && { backgroundColor: theme.paperRaised }]}>
                <View style={styles.line}>
                  <Tap
                    onPress={() => setEditing(open ? null : plan.id)}
                    aria-expanded={open}
                    aria-label={`${planTitle(plan, categories)}, ${when}`}
                    style={[styles.row, styles.rowText]}
                    activeStyle={{ backgroundColor: theme.paperRaised }}>
                    {/* An outline, like every plan on the day: the fill is for what happened. */}
                    <Mark style={styles.swatch} outline={category ? theme.palette[category.color] : theme.ink} />
                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={[styles.body, styles.italic, { color: theme.ink }]}>
                        {planTitle(plan, categories, true)}
                      </Text>
                      <Text numberOfLines={1} style={[styles.small, { color: theme.inkSoft }]}>
                        {when}
                      </Text>
                    </View>
                  </Tap>
                  {/* The order matters where two plans on the same number of days overlap: the upper one wins. */}
                  <MoveButtons
                    name={planTitle(plan, categories)}
                    first={index === 0}
                    last={index === active.length - 1}
                    onMove={(by) => void move(plan.id, by)}
                  />
                </View>
                {open && (
                  <PlanForm
                    start={plan}
                    categories={categories}
                    saveLabel="Save"
                    onCancel={() => setEditing(null)}
                    onSave={(fields) => {
                      void update(plan.id, fields);
                      setEditing(null);
                    }}
                    onArchive={() => {
                      void update(plan.id, { archived: true });
                      setEditing(null);
                    }}
                  />
                )}
              </View>
            );
          })}

          {editing === 'new' ? (
            <View style={[styles.wrap, styles.newEditor, { borderBottomColor: theme.rule, backgroundColor: theme.paperRaised }]}>
              <Text role="heading" aria-level={2} style={[styles.heading, styles.newHeading, { color: theme.ink }]}>
                New recurring plan
              </Text>
              <PlanForm
                start={BLANK}
                categories={categories}
                saveLabel="Add"
                autoFocus
                onCancel={() => setEditing(null)}
                onSave={(fields) => {
                  void add(fields);
                  setEditing(null);
                }}
              />
            </View>
          ) : (
            <View style={styles.addRow}>
              <Tap
                onPress={() => setEditing('new')}
                style={[styles.button, styles.bordered, { borderColor: theme.ink }]}
                activeStyle={{ backgroundColor: theme.paperRaised }}>
                <Text style={[styles.body, { color: theme.ink }]}>Add a recurring plan</Text>
              </Tap>
            </View>
          )}

          {archived.length > 0 && (
            <View style={styles.archived}>
              <Text role="heading" aria-level={2} style={[styles.heading, { color: theme.ink }]}>
                Archived
              </Text>
              {archived.map((plan) => (
                <View key={plan.id} style={[styles.wrap, styles.row, { borderBottomColor: theme.rule }]}>
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={[styles.body, styles.italic, { color: theme.inkSoft }]}>
                      {planTitle(plan, categories, true)}
                    </Text>
                    <Text numberOfLines={1} style={[styles.small, { color: theme.inkSoft }]}>
                      {spanLabel(plan.from, plan.to)}, {daysLabel(plan.days)}
                    </Text>
                  </View>
                  <Tap
                    aria-label={`Restore ${planTitle(plan, categories)}`}
                    onPress={() => void update(plan.id, { archived: false })}
                    style={styles.button}
                    activeStyle={{ backgroundColor: theme.paperRaised }}>
                    <Text style={[styles.body, { color: theme.ink }]}>Restore</Text>
                  </Tap>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

type FormProps = {
  start: RecurringFields;
  categories: Category[];
  saveLabel: string;
  autoFocus?: boolean;
  onSave(fields: RecurringFields): void;
  onCancel(): void;
  // Only a plan that exists can be archived.
  onArchive?(): void;
};

// One plan's fields as a draft: nothing is written until Save (or Add).
function PlanForm({ start, categories, saveLabel, autoFocus, onSave, onCancel, onArchive }: FormProps) {
  const theme = useTheme();
  const [note, setNote] = useState(start.note);
  const [category, setCategory] = useState(start.category);
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const [days, setDays] = useState(start.days);
  const [problem, setProblem] = useState<string | null>(null);

  const fields: RecurringFields = { note, category, from, to, days };
  const hours = spanHours(from, to);
  const submit = () => {
    const found = recurringProblem(fields);
    setProblem(found);
    if (!found) onSave(fields);
  };

  // Each end of the run is one closed line that says the hour. Pressed, it opens the 24
  // hours as chips (the control the day start uses) and a pick closes it again, so the
  // form stays short and an hour is still one tap away.
  const [picking, setPicking] = useState<'From' | 'To' | null>(null);
  const hourButton = (name: 'From' | 'To', value: number) => (
    <Tap
      aria-expanded={picking === name}
      aria-label={`${name}: ${hourLabel(value)}`}
      onPress={() => setPicking(picking === name ? null : name)}
      style={[styles.select, { borderColor: picking === name ? theme.ink : theme.line, backgroundColor: theme.paper }]}
      activeStyle={{ borderColor: theme.ink }}>
      <Text style={[styles.small, { color: theme.inkSoft }]}>{name}</Text>
      <Text style={[styles.body, styles.selectValue, { color: theme.ink }]}>{hourLabel(value)}</Text>
      <Text aria-hidden style={[styles.caret, { color: theme.ink }]}>
        {picking === name ? '\u25B4' : '\u25BE'}
      </Text>
    </Tap>
  );
  const hourChoices = (name: 'From' | 'To', value: number, onPick: (hour: number) => void) => (
    <View role="radiogroup" aria-label={name} style={styles.choices}>
      {HOURS.map((hour) => {
        const on = hour === value;
        return (
          <Tap
            key={hour}
            role="radio"
            aria-checked={on}
            aria-label={`${name} ${hourLabel(hour)}`}
            onPress={() => {
              onPick(hour);
              setPicking(null);
            }}
            style={[styles.choice, { borderColor: on ? theme.ink : theme.line }, on && { backgroundColor: theme.ink }]}
            activeStyle={{ borderColor: theme.ink }}>
            <Text style={[styles.small, { color: on ? theme.paper : theme.ink }, on && styles.strong]}>{hourLabel(hour)}</Text>
          </Tap>
        );
      })}
    </View>
  );

  return (
    <View style={styles.editor}>
      <View style={styles.field}>
        <Text nativeID="plan-note" style={[styles.small, { color: theme.inkSoft }]}>
          What are the hours for?
        </Text>
        <TextInput
          autoFocus={autoFocus}
          multiline
          rows={Math.min(6, Math.max(2, note.split('\n').length))}
          value={note}
          onChangeText={setNote}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === 'Escape') onCancel();
          }}
          aria-labelledby="plan-note"
          accessibilityLabel="What are the hours for?"
          placeholder="sleep, gym, the Tuesday call"
          placeholderTextColor={theme.inkQuiet}
          maxLength={NOTE_MAX}
          style={[
            styles.input,
            styles.italic,
            { color: theme.ink, borderColor: theme.accent, backgroundColor: theme.paper, outlineColor: theme.accent },
          ]}
        />
      </View>

      <Picker title="Where they should go" kind="plan" value={category} categories={categories} onPick={setCategory} />

      <View style={styles.field}>
        <View style={styles.span}>
          {hourButton('From', from)}
          {hourButton('To', to)}
        </View>
        {picking === 'From' && hourChoices('From', from, setFrom)}
        {picking === 'To' && hourChoices('To', to, setTo)}
        <Text style={[styles.small, { color: theme.inkSoft }]}>
          {hours} {hours === 1 ? 'hour' : 'hours'}: {spanLabel(from, to)}
          {to <= from && from !== 0 ? ', into the next day' : ''}.
          {from !== to ? ` The hour that starts at ${hourLabel(to)} is not included.` : ''}
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={[styles.small, { color: theme.inkSoft }]}>Days: {daysLabel(days)}</Text>
        <View role="group" aria-label="Days" style={styles.choices}>
          {EVERY_DAY.map((day) => {
            const on = days.includes(day);
            return (
              <Tap
                key={day}
                role="checkbox"
                aria-checked={on}
                aria-label={dayName(day)}
                onPress={() => setDays(toggleDay(days, day))}
                style={[styles.choice, { borderColor: on ? theme.ink : theme.line }, on && { backgroundColor: theme.ink }]}
                activeStyle={{ borderColor: theme.ink }}>
                <Text style={[styles.small, { color: on ? theme.paper : theme.ink }, on && styles.strong]}>
                  {on ? '✓ ' : ''}
                  {dayName(day)}
                </Text>
              </Tap>
            );
          })}
        </View>
        {to <= from && from !== 0 && (
          <Text style={[styles.small, { color: theme.inkSoft }]}>
            A day here is the day the plan starts on: Friday&apos;s runs into Saturday morning.
          </Text>
        )}
      </View>

      {problem && (
        <Text role="alert" style={[styles.small, { color: theme.accent }]}>
          {problem}
        </Text>
      )}

      <View style={styles.actions}>
        {onArchive ? (
          <Tap onPress={onArchive} style={styles.button} activeStyle={{ backgroundColor: theme.paper }}>
            <Text style={[styles.body, { color: theme.inkSoft }]}>Archive</Text>
          </Tap>
        ) : (
          <View />
        )}
        <View style={styles.actionGroup}>
          <Tap onPress={onCancel} style={styles.button} activeStyle={{ backgroundColor: theme.paper }}>
            <Text style={[styles.body, { color: theme.inkSoft }]}>Cancel</Text>
          </Tap>
          <Tap
            onPress={submit}
            style={[styles.button, styles.bordered, { borderColor: theme.ink }]}
            activeStyle={{ backgroundColor: theme.paper }}>
            <Text style={[styles.body, styles.strong, { color: theme.ink }]}>{saveLabel}</Text>
          </Tap>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingHorizontal: GUTTER },
  header: { paddingTop: 8, paddingBottom: 12, gap: 4 },
  nav: { flexDirection: 'row', marginLeft: -10 },
  navButton: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 4 },
  title: { fontFamily: serif, fontSize: 32, lineHeight: 40, fontWeight: '700' },
  heading: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, fontWeight: '700' },
  body: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  strong: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  list: { paddingBottom: 48 },
  empty: { marginTop: 12 },
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center' },
  // Two lines: the plan, then when it runs.
  row: { minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 8 },
  rowText: { flex: 1 },
  swatch: { width: 14, height: 14 },
  editor: { paddingLeft: 4, paddingRight: 4, paddingTop: 8, paddingBottom: 16, gap: 16 },
  newEditor: { paddingHorizontal: 8, paddingTop: 12, marginTop: 16, borderRadius: 4 },
  newHeading: { paddingHorizontal: 4, paddingBottom: 4 },
  field: { gap: 6 },
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
  span: { flexDirection: 'row', gap: 8 },
  select: {
    flex: 1,
    minHeight: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 4,
  },
  selectValue: { flex: 1 },
  // No serif here: the same glyph the category dropdown draws.
  caret: { fontSize: SIZE, lineHeight: LINE },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { minWidth: 56, minHeight: ROW, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderWidth: 1, borderRadius: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', rowGap: 4 },
  actionGroup: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
  button: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 4 },
  bordered: { borderWidth: 1, paddingHorizontal: 20 },
  addRow: { marginTop: 16, alignItems: 'flex-start' },
  archived: { marginTop: 32 },
});
