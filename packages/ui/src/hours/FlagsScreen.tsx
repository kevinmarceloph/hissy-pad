import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { cleanLabel, LABEL_MAX } from '@hissypad/core/hours';
import { cleanIcon, flagLabelProblem, flagMark, type Flag, type FlagPatch } from '@hissypad/core/hours';
import { useFlags } from './provider';

import { FlagOptions } from './FlagOptions';
import { MoveButtons } from './MoveButtons';
import { Tap } from './Tap';
import { GUTTER, LINE, MAX_WIDTH, ROW, serif, SIZE, SMALL, useTheme } from './theme';

// Where the flag list is edited: rename, give an icon, edit the options, reorder, archive, add.
// The categories screen with the color one level down, on each option: one editor open at a time.
export function FlagsScreen({ onBack }: { onBack(): void }) {
  const theme = useTheme();
  const list = useFlags((s) => s.list);
  const error = useFlags((s) => s.error);
  const add = useFlags((s) => s.add);
  const update = useFlags((s) => s.update);
  const move = useFlags((s) => s.move);

  // A flag id, 'new' for the add form, or nothing open.
  const [editing, setEditing] = useState<string | null>(null);

  const active = list.filter((f) => !f.archived);
  const archived = list.filter((f) => f.archived);

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
            Flags
          </Text>
          <Text style={[styles.small, { color: theme.inkSoft }]}>
            Questions to answer about an hour. Each flag has its own options, Yes and No to start, and stays unset
            until you pick one. Its icon shows at the right of the hour, on the color of the answer. Archive a flag to
            take it out of the editor: hours that already carry it keep it.
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
              No flags. Add one to start marking hours with it.
            </Text>
          )}

          {active.map((flag, index) => (
            <FlagRow
              key={flag.id}
              flag={flag}
              list={list}
              open={editing === flag.id}
              first={index === 0}
              last={index === active.length - 1}
              onOpen={() => setEditing(flag.id)}
              onClose={() => setEditing(null)}
              onUpdate={(patch) => void update(flag.id, patch)}
              onMove={(by) => void move(flag.id, by)}
            />
          ))}

          {editing === 'new' ? (
            <NewFlag
              list={list}
              onCancel={() => setEditing(null)}
              onAdd={(label, icon) => {
                void add(label, icon);
                setEditing(null);
              }}
            />
          ) : (
            <View style={styles.addRow}>
              <Tap
                onPress={() => setEditing('new')}
                style={[styles.button, styles.bordered, { borderColor: theme.ink }]}
                activeStyle={{ backgroundColor: theme.paperRaised }}>
                <Text style={[styles.body, { color: theme.ink }]}>Add a flag</Text>
              </Tap>
            </View>
          )}

          {archived.length > 0 && (
            <View style={styles.archived}>
              <Text role="heading" aria-level={2} style={[styles.heading, { color: theme.ink }]}>
                Archived
              </Text>
              {archived.map((flag) => (
                <View key={flag.id} style={[styles.wrap, styles.row, { borderBottomColor: theme.rule }]}>
                  <Text aria-hidden style={[styles.body, styles.mark, { color: theme.inkSoft }]}>
                    {flagMark(flag)}
                  </Text>
                  <Text numberOfLines={1} style={[styles.body, styles.name, { color: theme.inkSoft }]}>
                    {flag.label}
                  </Text>
                  <Tap
                    aria-label={`Restore ${flag.label}`}
                    onPress={() => void update(flag.id, { archived: false })}
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
  flag: Flag;
  list: Flag[];
  open: boolean;
  first: boolean;
  last: boolean;
  onOpen(): void;
  onClose(): void;
  onUpdate(patch: FlagPatch): void;
  onMove(by: -1 | 1): void;
};

function FlagRow(props: RowProps) {
  const theme = useTheme();
  const { flag, open, first, last, onOpen, onClose, onMove } = props;
  return (
    <View style={[styles.wrap, { borderBottomColor: theme.rule }, open && { backgroundColor: theme.paperRaised }]}>
      <View style={styles.line}>
        <Tap
          onPress={open ? onClose : onOpen}
          aria-expanded={open}
          aria-label={flag.label}
          style={[styles.row, styles.name]}
          activeStyle={{ backgroundColor: theme.paperRaised }}>
          <Text aria-hidden style={[styles.body, styles.mark, { color: theme.ink }]}>
            {flagMark(flag)}
          </Text>
          <Text numberOfLines={1} style={[styles.body, styles.name, { color: theme.ink }]}>
            {flag.label}
          </Text>
        </Tap>
        {/* Beside the row's button, not inside it: the order changes without opening anything. */}
        <MoveButtons name={flag.label} first={first} last={last} onMove={onMove} />
      </View>
      {open && <RowEditor {...props} />}
    </View>
  );
}

function RowEditor({ flag, list, onClose, onUpdate }: RowProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState(flag.label);
  const [icon, setIcon] = useState(flag.icon);
  const [problem, setProblem] = useState<string | null>(null);

  // The icon as a patch: empty when it has not changed.
  const iconPatch = (): FlagPatch => (cleanIcon(icon) === flag.icon ? {} : { icon: cleanIcon(icon) });

  // The name as a patch: empty when it has not changed, null when it cannot be used (and
  // the reason is on screen).
  const namePatch = (): FlagPatch | null => {
    const found = flagLabelProblem(list, draft, flag.id);
    setProblem(found);
    if (found) return null;
    const label = cleanLabel(draft);
    setDraft(label);
    return label === flag.label ? {} : { label };
  };

  // The name is written when the field is left or submitted, not on every keystroke.
  const commit = (): boolean => {
    const name = namePatch();
    const patch = { ...name, ...iconPatch() };
    if (name !== null && Object.keys(patch).length > 0) onUpdate(patch);
    return name !== null;
  };

  return (
    <View style={styles.editor}>
      <NameField
        value={draft}
        problem={problem}
        onChange={setDraft}
        onBlur={commit}
        onSubmit={() => {
          if (commit() && Platform.OS === 'web') onClose();
        }}
        onEscape={onClose}
      />
      <IconField value={icon} onChange={setIcon} onBlur={commit} onEscape={onClose} />
      <FlagOptions flag={flag} onChange={(options) => onUpdate({ options })} />

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

type NewProps = { list: Flag[]; onAdd(label: string, icon: string): void; onCancel(): void };

function NewFlag({ list, onAdd, onCancel }: NewProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [icon, setIcon] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const found = flagLabelProblem(list, draft);
    setProblem(found);
    if (!found) onAdd(draft, icon);
  };

  return (
    <View style={[styles.wrap, styles.editor, styles.newEditor, { borderBottomColor: theme.rule, backgroundColor: theme.paperRaised }]}>
      <Text role="heading" aria-level={2} style={[styles.heading, { color: theme.ink }]}>
        New flag
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
      <IconField value={icon} onChange={setIcon} onEscape={onCancel} />
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
      <Text nativeID="flag-name" style={[styles.small, { color: theme.inkSoft }]}>
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
        aria-labelledby="flag-name"
        accessibilityLabel="Name"
        aria-invalid={problem !== null}
        placeholder="Outdoors, caffeinated, in flow"
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

type IconProps = { value: string; onChange(value: string): void; onBlur?(): void; onEscape(): void };

// One emoji. Whatever is typed is cut to its first character when it is saved.
function IconField({ value, onChange, onBlur, onEscape }: IconProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text nativeID="flag-icon" style={[styles.small, { color: theme.inkSoft }]}>
        Icon
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Escape') onEscape();
        }}
        aria-labelledby="flag-icon"
        accessibilityLabel="Icon"
        placeholder="none"
        placeholderTextColor={theme.inkQuiet}
        returnKeyType="done"
        maxLength={16}
        style={[
          styles.input,
          styles.iconInput,
          { color: theme.ink, borderColor: theme.accent, backgroundColor: theme.paper, outlineColor: theme.accent },
        ]}
      />
      <Text style={[styles.small, { color: theme.inkSoft }]}>
        One emoji. It shows at the right of an hour where the flag is answered.
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
  mark: { width: 26, textAlign: 'center' },
  iconInput: { width: 96 },
  editor: { paddingLeft: 4, paddingRight: 4, paddingBottom: 16, gap: 16 },
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
