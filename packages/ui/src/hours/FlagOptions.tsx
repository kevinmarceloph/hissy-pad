import { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { cleanLabel, colorLabel, LABEL_MAX } from '@hissypad/core/hours';
import {
  activeOptions,
  MAX_OPTIONS,
  newOptionId,
  nextOptionColor,
  optionLabelProblem,
  type Flag,
  type FlagOption,
} from '@hissypad/core/hours';

import { ColorField } from './ColorField';
import { FlagMark } from './FlagMark';
import { Tap } from './Tap';
import { LINE, ROW, serif, SIZE, SMALL, useTheme } from './theme';

type Props = { flag: Flag; onChange(options: FlagOption[]): void };

// The answers a flag can take, edited inside the flag's own editor: rename, recolor, add,
// remove. One option is open at a time. Removing archives: hours that carry the option
// keep its name and color, and it can be put back.
export function FlagOptions({ flag, onChange }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const active = activeOptions(flag);
  const removed = flag.options.filter((o) => o.archived);

  const change = (id: string, patch: Partial<FlagOption>) =>
    onChange(flag.options.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  const add = () => {
    const labels = new Set(flag.options.map((o) => o.label.toLowerCase()));
    const ids = new Set(flag.options.map((o) => o.id));
    let n = flag.options.length + 1;
    while (labels.has(`option ${n}`)) n++;
    let id = newOptionId();
    while (ids.has(id)) id = newOptionId();
    onChange([...flag.options, { id, label: `Option ${n}`, color: nextOptionColor(flag.options) }]);
    setOpen(id);
  };

  return (
    <View style={styles.field}>
      <Text style={[styles.small, { color: theme.inkSoft }]}>Options</Text>
      <View style={[styles.list, { borderColor: theme.line }]}>
        {active.map((option, index) => (
          <View key={option.id} style={index > 0 && [styles.divided, { borderTopColor: theme.rule }]}>
            <Tap
              aria-expanded={open === option.id}
              aria-label={`Option ${option.label}, ${colorLabel(option.color)}`}
              onPress={() => setOpen(open === option.id ? null : option.id)}
              style={styles.row}
              activeStyle={{ backgroundColor: theme.paper }}>
              {/* The mark as an hour will show it. The color is also named in words. */}
              <FlagMark flag={flag} option={option} />
              <Text numberOfLines={1} style={[styles.body, styles.name, { color: theme.ink }]}>
                {option.label}
              </Text>
              <Text style={[styles.small, { color: theme.inkSoft }]}>{colorLabel(option.color)}</Text>
            </Tap>
            {open === option.id && (
              <OptionEditor
                option={option}
                options={flag.options}
                only={active.length === 1}
                onChange={(patch) => change(option.id, patch)}
                onRemove={() => {
                  change(option.id, { archived: true });
                  setOpen(null);
                }}
                onClose={() => setOpen(null)}
              />
            )}
          </View>
        ))}
      </View>

      {flag.options.length < MAX_OPTIONS && (
        <Tap onPress={add} style={[styles.button, styles.add]} activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.body, styles.underline, { color: theme.ink }]}>Add an option</Text>
        </Tap>
      )}

      {removed.map((option) => (
        <View key={option.id} style={styles.row}>
          <Text numberOfLines={1} style={[styles.body, styles.name, { color: theme.inkSoft }]}>
            {option.label} (removed)
          </Text>
          <Tap
            aria-label={`Restore option ${option.label}`}
            onPress={() => change(option.id, { archived: false })}
            style={styles.button}
            activeStyle={{ backgroundColor: theme.paper }}>
            <Text style={[styles.body, { color: theme.ink }]}>Restore</Text>
          </Tap>
        </View>
      ))}

      <Text style={[styles.small, { color: theme.inkSoft }]}>
        An hour takes one of these, or stays unset. The color shows behind the icon on the hour.
      </Text>
    </View>
  );
}

type EditorProps = {
  option: FlagOption;
  options: FlagOption[];
  // The last option left: it cannot be removed.
  only: boolean;
  onChange(patch: Partial<FlagOption>): void;
  onRemove(): void;
  onClose(): void;
};

function OptionEditor({ option, options, only, onChange, onRemove, onClose }: EditorProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState(option.label);
  const [problem, setProblem] = useState<string | null>(null);

  // The name is written when the field is left or submitted, not on every keystroke.
  const commit = (): boolean => {
    const found = optionLabelProblem(options, draft, option.id);
    setProblem(found);
    if (found) return false;
    const label = cleanLabel(draft);
    setDraft(label);
    if (label !== option.label) onChange({ label });
    return true;
  };

  return (
    <View style={styles.editor}>
      <View style={styles.field}>
        <Text nativeID={`option-name-${option.id}`} style={[styles.small, { color: theme.inkSoft }]}>
          Option name
        </Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={() => {
            if (commit() && Platform.OS === 'web') onClose();
          }}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === 'Escape') onClose();
          }}
          aria-labelledby={`option-name-${option.id}`}
          accessibilityLabel="Option name"
          aria-invalid={problem !== null}
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
      <ColorField value={option.color} onPick={(color) => onChange({ color })} />
      <Tap disabled={only} onPress={onRemove} style={[styles.button, styles.add]} activeStyle={{ backgroundColor: theme.paper }}>
        <Text style={[styles.body, { color: theme.inkSoft }]}>Remove option</Text>
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  body: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  underline: { textDecorationLine: 'underline' },
  list: { borderWidth: 1, borderRadius: 4, overflow: 'hidden' },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10 },
  name: { flex: 1 },
  editor: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 12, gap: 12 },
  input: {
    fontFamily: serif,
    fontSize: SIZE,
    minHeight: ROW,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 4,
  },
  button: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 4 },
  add: { alignSelf: 'flex-start', marginLeft: -12 },
});
