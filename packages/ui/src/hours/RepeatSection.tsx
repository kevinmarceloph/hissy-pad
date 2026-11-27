import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { KEEP_WORDS, REPEAT_DEFAULT, REPEAT_KEEPS, REPEAT_MAX, REPEAT_UNITS, repeatLabel, repeatLink, unitWord, type RepeatChoice } from '@hissypad/core';
import { cmdMakeRepeat, cmdOpenTemplate, cmdSetRepeat, cmdStopRepeat, cmdUnlinkRepeat, repeatWords, usePad } from '@hissypad/state';

import { Tap } from './Tap';
import { LINE, ROW, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The line the hour picker was opened on.
  id: string;
  // Open or shut: shut it is one line that says how the line repeats. The hour picker
  // gives the room of its hours to it while it is open.
  open: boolean;
  onToggle(): void;
  // The template was gone to: the host closes the picker and shows the pad.
  onOpenTemplate?(): void;
  clock?: () => Date;
};

// The hour picker's Repeat section (Kevin, 2026-11-27): makes a line a recurring item, as
// in Things. Two kinds: a new one every so often whatever happened to the last (and then
// what becomes of one still open: use it again, replace it, or add another beside it), or
// a new one so long after the last was crossed out. The rule is the template's: on an
// instance or on the template itself each change is written as it is made; on a line that
// does not repeat yet it is a draft until the button under it is pressed.
// An instance also has the way to its template (kept in Later, where its lines can be
// edited for the ones to come) and Unlink, which makes it an ordinary line again.
export function RepeatSection({ id, open, onToggle, onOpenTemplate, clock = () => new Date() }: Props) {
  const theme = useTheme();
  const all = usePad((s) => s.all);
  const link = repeatLink(all, id);
  const [draft, setDraft] = useState<RepeatChoice>(REPEAT_DEFAULT);
  const choice: RepeatChoice = link ? link.rule : draft;
  const change = (patch: Partial<RepeatChoice>) => {
    const next = { ...choice, ...patch };
    if (link) cmdSetRepeat(id, next, clock());
    else setDraft(next);
  };
  const row = all[id];
  if (!row || row.pad) return null;

  const says = link ? repeatWords(link.templateId, clock()) : 'Does not repeat';
  const radio = (on: boolean, label: string, onPress: () => void) => (
    <Tap
      key={label}
      role="radio"
      aria-checked={on}
      onPress={onPress}
      style={[styles.choice, { borderColor: on ? theme.ink : theme.line, backgroundColor: on ? theme.ink : 'transparent' }]}
      activeStyle={{ borderColor: theme.ink }}>
      <Text style={[styles.body, { color: on ? theme.paper : theme.ink }, on && { fontWeight: '700' }]}>{label}</Text>
    </Tap>
  );
  const plain = (label: string, onPress: () => void, strong = false) => (
    <Tap
      onPress={onPress}
      style={[styles.action, { borderColor: strong ? theme.ink : theme.line, backgroundColor: strong ? theme.ink : 'transparent' }, strong && styles.grow]}
      activeStyle={strong ? { opacity: 0.85 } : { borderColor: theme.ink, backgroundColor: theme.paperRaised }}>
      <Text numberOfLines={1} style={[styles.body, { color: strong ? theme.paper : theme.ink }, strong && { fontWeight: '700' }]}>
        {label}
      </Text>
    </Tap>
  );

  return (
    <View style={[styles.section, { borderTopColor: theme.line }]}>
      <Tap aria-label={`Repeat: ${says}`} aria-expanded={open} onPress={onToggle} style={styles.head} activeStyle={{ backgroundColor: theme.paperRaised }}>
        <Text style={[styles.body, { color: theme.ink, fontWeight: '700' }]}>Repeat</Text>
        <Text numberOfLines={1} style={[styles.small, styles.says, { color: theme.inkSoft }]}>
          {says}
        </Text>
        <Text aria-hidden style={[styles.body, { color: theme.inkSoft }]}>
          {open ? '−' : '+'}
        </Text>
      </Tap>
      {open && (
        <View style={styles.inside}>
          {link && (
            <Text style={[styles.small, { color: theme.inkSoft }]}>
              {link.role === 'template'
                ? 'This is the template: the items to come are copies of it and the lines under it.'
                : 'This is one of a recurring item. A change here is for the ones to come too.'}
            </Text>
          )}
          <View role="radiogroup" aria-label="How it repeats" style={styles.row}>
            {radio(choice.mode === 'every', 'On a schedule', () => change({ mode: 'every' }))}
            {radio(choice.mode === 'after', 'After it is done', () => change({ mode: 'after' }))}
          </View>
          <View style={styles.row}>
            <Text style={[styles.body, { color: theme.ink }]}>{choice.mode === 'every' ? 'Every' : 'A new one'}</Text>
            <Tap
              aria-label="Fewer"
              disabled={choice.n <= 1}
              onPress={() => change({ n: choice.n - 1 })}
              style={[styles.step, { borderColor: theme.line }]}
              activeStyle={{ borderColor: theme.ink }}>
              <Text style={[styles.body, { color: theme.ink }]}>−</Text>
            </Tap>
            <Text aria-label="How many" aria-live="polite" style={[styles.body, styles.count, { color: theme.ink }]}>
              {choice.n}
            </Text>
            <Tap
              aria-label="More"
              disabled={choice.n >= REPEAT_MAX}
              onPress={() => change({ n: choice.n + 1 })}
              style={[styles.step, { borderColor: theme.line }]}
              activeStyle={{ borderColor: theme.ink }}>
              <Text style={[styles.body, { color: theme.ink }]}>+</Text>
            </Tap>
            <View role="radiogroup" aria-label="Days, weeks, months or years" style={styles.group}>
              {REPEAT_UNITS.map((unit) => radio(choice.unit === unit, unitWord(unit, choice.n), () => change({ unit })))}
            </View>
            {choice.mode === 'after' && <Text style={[styles.body, { color: theme.ink }]}>after the last is done</Text>}
          </View>
          {choice.mode === 'every' && (
            <View style={styles.stack}>
              <Text style={[styles.body, { color: theme.ink }]}>If the last one is still open:</Text>
              <View role="radiogroup" aria-label="If the last one is still open" style={styles.group}>
                {REPEAT_KEEPS.map((keep) => radio(choice.keep === keep, KEEP_WORDS[keep], () => change({ keep })))}
              </View>
            </View>
          )}
          <View style={styles.row}>
            {!link && plain(`Repeat: ${repeatLabel(choice).toLowerCase()}`, () => cmdMakeRepeat(id, choice, clock()), true)}
            {link?.role === 'instance' &&
              plain('Go to the template', () => {
                if (cmdOpenTemplate(id)) onOpenTemplate?.();
              })}
            {link?.role === 'instance' && plain('Unlink this one', () => cmdUnlinkRepeat([id], clock()))}
            {link?.role === 'template' && plain('Stop repeating', () => cmdStopRepeat(id))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 4 },
  head: { minHeight: ROW, flexDirection: 'row', alignItems: 'center', columnGap: 10, borderRadius: 4, marginHorizontal: -6, paddingHorizontal: 6 },
  says: { flex: 1 },
  inside: { gap: 10, paddingTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  // A set of choices inside a row: it wraps within the width it is given (a phone's).
  group: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, flexShrink: 1, maxWidth: '100%' },
  stack: { gap: 6 },
  body: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  choice: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderRadius: 18 },
  step: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 18 },
  count: { minWidth: 28, textAlign: 'center', fontWeight: '700' },
  action: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 4 },
  grow: { flexGrow: 1, alignItems: 'center' },
});
