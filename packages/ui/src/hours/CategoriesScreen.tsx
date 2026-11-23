import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  cleanLabel,
  colorLabel,
  LABEL_MAX,
  labelProblem,
  nextColor,
  type Category,
  type CategoryPatch,
  type ColorKey,
} from '@hissypad/core/hours';
import { useCategories } from './provider';

import { ColorField } from './ColorField';
import { MoveButtons } from './MoveButtons';
import { Tap } from './Tap';
import { GUTTER, LINE, MAX_WIDTH, ROW, serif, SIZE, SMALL, useTheme } from './theme';

// Where the category list is edited: rename, recolor, reorder, archive, add. One editor is
// open at a time, the same way the day screen edits one hour at a time. The order is
// changed from the rows themselves, with the arrows at their right.
export function CategoriesScreen({ onBack }: { onBack(): void }) {
  const theme = useTheme();
  const list = useCategories((s) => s.list);
  const error = useCategories((s) => s.error);
  const add = useCategories((s) => s.add);
  const update = useCategories((s) => s.update);
  const move = useCategories((s) => s.move);

  // A category id, 'new' for the add form, or nothing open.
  const [editing, setEditing] = useState<string | null>(null);

  const active = list.filter((c) => !c.archived);
  const archived = list.filter((c) => c.archived);

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
            Categories
          </Text>
          <Text style={[styles.small, { color: theme.inkSoft }]}>
            The places an hour can go. Archive one to take it out of the picker: hours you already tagged keep it.
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
          {active.length === 0 && (
            <Text style={[styles.body, styles.empty, { color: theme.inkSoft }]}>
              No categories. Hours can still take a note. Add a category to start tagging them.
            </Text>
          )}

          {active.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              list={list}
              open={editing === category.id}
              first={index === 0}
              last={index === active.length - 1}
              onOpen={() => setEditing(category.id)}
              onClose={() => setEditing(null)}
              onUpdate={(patch) => void update(category.id, patch)}
              onMove={(by) => void move(category.id, by)}
            />
          ))}

          {editing === 'new' ? (
            <NewCategory
              list={list}
              onCancel={() => setEditing(null)}
              onAdd={(label, color) => {
                void add(label, color);
                setEditing(null);
              }}
            />
          ) : (
            <View style={styles.addRow}>
              <Tap
                onPress={() => setEditing('new')}
                style={[styles.button, styles.bordered, { borderColor: theme.ink }]}
                activeStyle={{ backgroundColor: theme.paperRaised }}>
                <Text style={[styles.body, { color: theme.ink }]}>Add a category</Text>
              </Tap>
            </View>
          )}

          {archived.length > 0 && (
            <View style={styles.archived}>
              <Text role="heading" aria-level={2} style={[styles.heading, { color: theme.ink }]}>
                Archived
              </Text>
              {archived.map((category) => (
                <View key={category.id} style={[styles.wrap, styles.row, { borderBottomColor: theme.rule }]}>
                  <View style={[styles.swatch, { backgroundColor: theme.palette[category.color] }]} />
                  <Text numberOfLines={1} style={[styles.body, styles.name, { color: theme.inkSoft }]}>
                    {category.label}
                  </Text>
                  <Tap
                    aria-label={`Restore ${category.label}`}
                    onPress={() => void update(category.id, { archived: false })}
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

type RowProps = {
  category: Category;
  list: Category[];
  open: boolean;
  first: boolean;
  last: boolean;
  onOpen(): void;
  onClose(): void;
  onUpdate(patch: CategoryPatch): void;
  onMove(by: -1 | 1): void;
};

function CategoryRow(props: RowProps) {
  const theme = useTheme();
  const { category, open, first, last, onOpen, onClose, onMove } = props;
  return (
    <View style={[styles.wrap, { borderBottomColor: theme.rule }, open && { backgroundColor: theme.paperRaised }]}>
      <View style={styles.line}>
        <Tap
          onPress={open ? onClose : onOpen}
          aria-expanded={open}
          aria-label={`${category.label}, ${colorLabel(category.color)}`}
          style={[styles.row, styles.name]}
          activeStyle={{ backgroundColor: theme.paperRaised }}>
          <View style={[styles.swatch, { backgroundColor: theme.palette[category.color] }]} />
          <Text numberOfLines={1} style={[styles.body, styles.name, { color: theme.ink }]}>
            {category.label}
          </Text>
        </Tap>
        {/* Beside the row's button, not inside it: the order changes without opening anything. */}
        <MoveButtons name={category.label} first={first} last={last} onMove={onMove} />
      </View>
      {open && <RowEditor {...props} />}
    </View>
  );
}

function RowEditor({ category, list, onClose, onUpdate }: RowProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState(category.label);
  const [problem, setProblem] = useState<string | null>(null);

  // The name as a patch: empty when it has not changed, null when it cannot be used (and
  // the reason is on screen).
  const namePatch = (): CategoryPatch | null => {
    const found = labelProblem(list, draft, category.id);
    setProblem(found);
    if (found) return null;
    const label = cleanLabel(draft);
    setDraft(label);
    return label === category.label ? {} : { label };
  };

  // The name is written when the field is left or submitted, not on every keystroke.
  const commit = (): boolean => {
    const patch = namePatch();
    if (patch?.label) onUpdate(patch);
    return patch !== null;
  };

  return (
    <View style={styles.editor}>
      <NameField
        value={draft}
        problem={problem}
        onChange={setDraft}
        onBlur={commit}
        onSubmit={() => {
          // On a phone, return only puts the keyboard away: the colors were under it.
          if (commit() && Platform.OS === 'web') onClose();
        }}
        onEscape={onClose}
      />
      <ColorField value={category.color} onPick={(color) => onUpdate({ ...namePatch(), color })} />

      <View style={styles.actions}>
        <View style={[styles.actionGroup, styles.actionGroupEnd]}>
          <Tap
            onPress={() => {
              onUpdate({ ...namePatch(), archived: true });
              onClose();
            }}
            style={styles.button}
            activeStyle={{ backgroundColor: theme.paper }}>
            <Text style={[styles.body, { color: theme.inkSoft }]}>Archive</Text>
          </Tap>
          <Tap
            onPress={() => {
              if (commit()) onClose();
            }}
            style={[styles.button, styles.bordered, { borderColor: theme.ink }]}
            activeStyle={{ backgroundColor: theme.paper }}>
            <Text style={[styles.body, styles.strong, { color: theme.ink }]}>Done</Text>
          </Tap>
        </View>
      </View>
    </View>
  );
}

type NewProps = { list: Category[]; onAdd(label: string, color: ColorKey): void; onCancel(): void };

function NewCategory({ list, onAdd, onCancel }: NewProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [color, setColor] = useState(() => nextColor(list));
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const found = labelProblem(list, draft);
    setProblem(found);
    if (!found) onAdd(draft, color);
  };

  return (
    <View style={[styles.wrap, styles.editor, styles.newEditor, { borderBottomColor: theme.rule, backgroundColor: theme.paperRaised }]}>
      <Text role="heading" aria-level={2} style={[styles.heading, { color: theme.ink }]}>
        New category
      </Text>
      <NameField
        autoFocus
        value={draft}
        problem={problem}
        onChange={setDraft}
        onSubmit={() => {
          if (Platform.OS === 'web') submit();
        }}
        onEscape={onCancel}
      />
      <ColorField value={color} onPick={setColor} />
      <View style={[styles.actions, styles.actionsEnd]}>
        <Tap onPress={onCancel} style={styles.button} activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.body, { color: theme.inkSoft }]}>Cancel</Text>
        </Tap>
        <Tap
          onPress={submit}
          style={[styles.button, styles.bordered, { borderColor: theme.ink }]}
          activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.body, styles.strong, { color: theme.ink }]}>Add</Text>
        </Tap>
      </View>
    </View>
  );
}

type NameProps = {
  value: string;
  problem: string | null;
  autoFocus?: boolean;
  onChange(value: string): void;
  onBlur?(): void;
  onSubmit(): void;
  onEscape(): void;
};

function NameField({ value, problem, autoFocus, onChange, onBlur, onSubmit, onEscape }: NameProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text nativeID="category-name" style={[styles.small, { color: theme.inkSoft }]}>
        Name
      </Text>
      <TextInput
        autoFocus={autoFocus}
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        onSubmitEditing={onSubmit}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Escape') onEscape();
        }}
        aria-labelledby="category-name"
        accessibilityLabel="Name"
        aria-invalid={problem !== null}
        placeholder="Reading, commute, errands"
        placeholderTextColor={theme.inkQuiet}
        returnKeyType="done"
        maxLength={LABEL_MAX}
        style={[
          styles.input,
          { color: theme.ink, borderColor: theme.accent, backgroundColor: theme.paper, outlineColor: theme.accent },
        ]}
      />
      {problem && (
        <Text role="alert" style={[styles.small, { color: theme.accent }]}>
          {problem}
        </Text>
      )}
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
  list: { paddingBottom: 48 },
  empty: { marginTop: 12 },
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center' },
  row: { minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  swatch: { width: 14, height: 14, borderRadius: 3 },
  name: { flex: 1 },
  editor: { paddingLeft: 30, paddingRight: 4, paddingBottom: 16, gap: 16 },
  newEditor: { paddingLeft: 12, paddingRight: 12, paddingTop: 12, marginTop: 16, borderRadius: 4 },
  field: { gap: 6 },
  input: {
    fontFamily: serif,
    fontSize: SIZE,
    minHeight: ROW,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 4,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', rowGap: 4 },
  actionsEnd: { justifyContent: 'flex-end', columnGap: 4 },
  actionGroup: { flexDirection: 'row', alignItems: 'center' },
  // Stays on the right edge when a narrow screen wraps it onto its own line.
  actionGroupEnd: { marginLeft: 'auto' },
  button: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 4 },
  bordered: { borderWidth: 1, paddingHorizontal: 20 },
  addRow: { marginTop: 16, alignItems: 'flex-start' },
  archived: { marginTop: 32 },
});
