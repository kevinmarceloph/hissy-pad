import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  cleanIcon,
  cleanLabel,
  CODE_MAX,
  colorLabel,
  iconProblem,
  LABEL_MAX,
  labelProblem,
  nextColor,
  type Category,
  type CategoryPatch,
  type ColorKey,
} from '@hissypad/core/hours';
import { useCategories } from './provider';

import { CategoryBadge } from './CategoryBadge';
import { ColorField } from './ColorField';
import { MoveButtons } from './MoveButtons';
import { Tap } from './Tap';
import { GUTTER, LINE, MAX_WIDTH, ROW, serif, SIZE, SMALL, useTheme } from './theme';

// Where the category list is edited: rename, pick an icon, recolor, reorder, archive, add. One editor is
// open at a time, the same way the day screen edits one hour at a time. The order is
// changed from the rows themselves, with the arrows at their right. Opened from the top
// menu of both apps (CategoriesApp), so its way out says Close there.
export function CategoriesScreen({ onBack, backLabel = 'Back to the day' }: { onBack(): void; backLabel?: string }) {
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
              <Text style={[styles.body, { color: theme.ink }]}>{backLabel}</Text>
            </Tap>
          </View>
          <Text role="heading" aria-level={1} style={[styles.title, { color: theme.ink }]}>
            Categories
          </Text>
          <Text style={[styles.small, { color: theme.inkSoft }]}>
            The places an hour or a line can go. Archive one to take it out of the pickers: what you already tagged keeps it.
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
              No categories yet. Add one to tag hours and lines of the pad with it.
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
              onAdd={(label, icon, color) => {
                void add(label, icon, color);
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
                  <View style={styles.badgeSlot}><CategoryBadge category={category} /></View>
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
          <View style={styles.badgeSlot}><CategoryBadge category={category} /></View>
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
  const [icon, setIcon] = useState(category.icon);
  const [problem, setProblem] = useState<string | null>(null);
  const [iconTrouble, setIconTrouble] = useState<string | null>(null);

  // The icon as a patch: empty when it has not changed or cannot be used (the reason is
  // then on screen, and the category keeps the icon it had).
  const iconOk = (): boolean => {
    const found = iconProblem(list, icon, category.id);
    setIconTrouble(found);
    if (!found) setIcon(cleanIcon(icon));
    return !found;
  };
  const iconPatch = (): CategoryPatch =>
    iconProblem(list, icon, category.id) || cleanIcon(icon) === category.icon ? {} : { icon: cleanIcon(icon) };

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

  // The name and the icon are written when a field is left or submitted, not on every
  // keystroke, each when it can be used. True when both can, so the editor may close.
  const commit = (): boolean => {
    const name = namePatch();
    const icon = iconOk();
    const patch = { ...name, ...iconPatch() };
    if (Object.keys(patch).length > 0) onUpdate(patch);
    return name !== null && icon;
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
      <IconField value={icon} problem={iconTrouble} onChange={setIcon} onBlur={commit} onEscape={onClose} />
      <ColorField value={category.color} onPick={(color) => onUpdate({ ...namePatch(), ...iconPatch(), color })} />

      <View style={styles.actions}>
        <View style={[styles.actionGroup, styles.actionGroupEnd]}>
          <Tap
            onPress={() => {
              onUpdate({ ...namePatch(), ...iconPatch(), archived: true });
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

type NewProps = { list: Category[]; onAdd(label: string, icon: string, color: ColorKey): void; onCancel(): void };

// Also the pad's category picker's "New category", where a line gets the one it makes.
export function NewCategory({ list, onAdd, onCancel }: NewProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState(() => nextColor(list));
  const [problem, setProblem] = useState<string | null>(null);
  const [iconTrouble, setIconTrouble] = useState<string | null>(null);

  const submit = () => {
    const found = labelProblem(list, draft);
    const iconFound = iconProblem(list, icon);
    setProblem(found);
    setIconTrouble(iconFound);
    if (!found && !iconFound) onAdd(draft, cleanIcon(icon), color);
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
      <IconField value={icon} problem={iconTrouble} onChange={setIcon} onEscape={onCancel} />
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

type IconProps = { value: string; problem: string | null; onChange(value: string): void; onBlur?(): void; onEscape(): void };

// One emoji or a short code, its own among the categories. Cut down by cleanIcon when saved.
function IconField({ value, problem, onChange, onBlur, onEscape }: IconProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text nativeID="category-icon" style={[styles.small, { color: theme.inkSoft }]}>
        Icon
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Escape') onEscape();
        }}
        aria-labelledby="category-icon"
        accessibilityLabel="Icon"
        aria-invalid={problem !== null}
        placeholder="🛒 or HP"
        autoCapitalize="characters"
        autoCorrect={false}
        placeholderTextColor={theme.inkQuiet}
        returnKeyType="done"
        maxLength={16}
        style={[
          styles.input,
          styles.iconInput,
          { color: theme.ink, borderColor: theme.accent, backgroundColor: theme.paper, outlineColor: theme.accent },
        ]}
      />
      {problem && (
        <Text role="alert" style={[styles.small, { color: theme.accent }]}>
          {problem}
        </Text>
      )}
      <Text style={[styles.small, { color: theme.inkSoft }]}>
        One emoji, or a code of up to {CODE_MAX} letters (HP). Each category has its own. A line shows it before its
        text, and typed before a line it puts the line in this category.
      </Text>
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
  name: { flex: 1 },
  // As wide as a three-letter code, so the names line up whatever the icon.
  badgeSlot: { width: 30, alignItems: 'flex-start' },
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
  iconInput: { width: 96 },
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
