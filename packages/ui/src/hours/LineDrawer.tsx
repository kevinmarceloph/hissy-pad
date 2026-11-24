import { StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { stateOf } from '@hissypad/core';
import { usePad } from '@hissypad/state';
import { cmdPickSlot, cmdSlotClear, cmdSlotDone, cmdSlotShift, cmdSlotState } from '@hissypad/state/hours';

import { StateSwitch, type MarkState } from './StateMark';
import { Tap } from './Tap';
import { LINE, serif, SIZE, SMALL, useTheme } from './theme';

// The lines of the open hour the drawer acts on: the ones selected by their bullets, or
// else the one being typed in, as in the pad. The open hour's list (MiniPad) keeps this
// current; the day screen draws the drawer at its foot, outside the list that scrolls.
type Target = { id: string; depth: number };
type DrawerState = {
  targets: Target[];
  // True when the targets were selected by their bullets, false for the line being typed.
  selecting: boolean;
  clear(): void;
  // Runs after an action, to put the caret back in the line being typed.
  after(): void;
};

const NONE: DrawerState = { targets: [], selecting: false, clear: () => {}, after: () => {} };
export const lineDrawer = createStore<DrawerState>(() => NONE);
export const closeLineDrawer = () => lineDrawer.setState(NONE);

// What can be done to the lines selected in an hour, at the bottom of the screen: put them
// in one of the three states, move them in or out, or take them out of the hour. This is
// the pad's way (a bullet selects, the bar at the bottom acts), with the few actions an
// hour has until it draws the pad's own toolbar (PLAN.md, "Hours joins the pad").
export function LineDrawer() {
  const theme = useTheme();
  const { targets, selecting, clear, after } = useStore(lineDrawer);
  const all = usePad((s) => s.all);
  const known = targets.filter((t) => all[t.id]);
  if (known.length === 0) return null;

  const ids = known.map((t) => t.id);
  const states = new Set(ids.map((id) => stateOf(all[id]!)));
  // A mixed set lights no side of the switch.
  const shared: MarkState | null = states.size === 1 ? [...states][0]! : null;
  const one = known.length === 1;
  const setState = (state: MarkState) => {
    cmdSlotState(ids.filter((id) => all[id]!.deletedAt === null), state);
    // An archived line stays in its hour and can still be crossed out, or not.
    if (state !== 'doing') for (const id of ids) if (all[id]!.deletedAt !== null) cmdSlotDone(id, state === 'done');
    after();
  };
  const shift = (dir: 'in' | 'out') => {
    for (const t of known) cmdSlotShift(t.id, t.depth, dir);
    after();
  };

  return (
    <View role="toolbar" aria-label="Selected lines" style={[styles.drawer, { backgroundColor: theme.paperRaised, borderColor: theme.line }]}>
      <Text numberOfLines={1} style={[styles.count, { color: theme.inkSoft }]}>
        {selecting ? `${known.length} selected` : 'This line'}
      </Text>
      <StateSwitch label={one ? 'This line' : 'These lines'} value={shared} onChange={setState} />
      <Tap
        aria-label={one ? 'Move this line out' : 'Move these lines out'}
        disabled={!known.every((t) => t.depth >= 2)}
        onPress={() => shift('out')}
        style={[styles.button, { borderColor: theme.line }]}
        activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
        <Text style={[styles.glyph, { color: theme.ink }]}>←</Text>
      </Tap>
      <Tap
        aria-label={one ? 'Move this line in' : 'Move these lines in'}
        disabled={!known.every((t) => t.depth >= 1)}
        onPress={() => shift('in')}
        style={[styles.button, { borderColor: theme.line }]}
        activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
        <Text style={[styles.glyph, { color: theme.ink }]}>→</Text>
      </Tap>
      {/* Another hour, or a run of them: the pad's own picker (Kevin, 2026-11-25: a line is
          not dragged between hours, it is moved from here). */}
      <Tap
        aria-label={one ? 'Move this line to another hour' : 'Move these lines to another hour'}
        onPress={() => cmdPickSlot(ids)}
        style={[styles.button, styles.words, { borderColor: theme.line }]}
        activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
        <Text style={[styles.small, { color: theme.ink }]}>Hour…</Text>
      </Tap>
      {known.every((t) => t.depth === 0) && (
        <Tap
          aria-label={one ? 'Take this line out of the hour' : 'Take these lines out of the hour'}
          onPress={() => {
            cmdSlotClear(ids);
            clear();
          }}
          style={[styles.button, styles.words, { borderColor: theme.line }]}
          activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
          <Text style={[styles.small, { color: theme.ink }]}>Out of hour</Text>
        </Tap>
      )}
      {selecting && (
        <Tap aria-label="Clear selection" onPress={clear} style={[styles.button, styles.last]} activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.glyph, { color: theme.inkSoft }]}>×</Text>
        </Tap>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4,
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 10, borderTopRightRadius: 10,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 6,
  },
  count: { fontFamily: serif, fontSize: SMALL, lineHeight: 20, minWidth: 64 },
  button: { minWidth: 42, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent', borderRadius: 18 },
  words: { paddingHorizontal: 12 },
  last: { marginLeft: 'auto' },
  glyph: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
});
