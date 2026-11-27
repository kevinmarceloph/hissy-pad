import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { slotDoneElsewhere, slotKey, slotLeftovers } from '@hissypad/core';
import { closeSlot, cmdAppendAtEnd, openSlot, usePad } from '@hissypad/state';
import { cmdFindForSlot, cmdSlotFresh } from '@hissypad/state/hours';

import { StateMark } from './StateMark';
import { Tap } from './Tap';
import { LINE, ROW, serif, SIZE, SMALL, useTheme } from './theme';

// The app's own pad editor, handed to Hours by its host: these screens cannot import it
// (the web's is DOM, the phone's its own rows). It draws the store's `rows`, which are the
// open hour's lines while the store shows that hour (openSlot).
export type RenderLines = (hour: { day: string; hour: number; slot: string }) => ReactNode;
export const LinesContext = createContext<RenderLines | null>(null);
export const useHostedLines = () => useContext(LinesContext);

type Props = {
  // The calendar day and hour of the slot, never the day as drawn.
  day: string;
  hour: number;
  onClose(): void;
};

// An open hour: a pad scoped to it (PLAN.md, "Hours joins the pad" and "The hour view,
// round 3"). The store is asked to show this hour, the host draws its rows, archived ones
// among them, and the host's toolbar acts on them. Under the lines, empty space that takes
// a tap for a new line, the way the space under a pad does. Under that, one quiet line: a
// search button that finds a line in any pad for this hour, a text toggle ("✕2 done") for
// the lines crossed out while the hour ran that were not put in it, Fresh start, and Close.
export function HostedLines({ day, hour, onClose }: Props) {
  const theme = useTheme();
  // Both apps hand an editor in. Without one (a screen under test) no lines are drawn and
  // the store's view is left alone.
  const render = useHostedLines();
  const slot = slotKey(day, hour);
  const shown = usePad((s) => s.slotId);
  const zoomed = usePad((s) => s.zoomId !== null);
  const all = usePad((s) => s.all);
  const empty = usePad((s) => s.slotId === slot && Object.keys(s.rows).length === 0);
  const mine = render !== null && shown === slot;

  // The store shows one thing at a time. A card that zooms into a line (a new item's)
  // takes the view while it is open; the hour takes it back when the card is gone.
  useEffect(() => {
    if (render && shown !== slot && !zoomed) openSlot(slot);
  }, [render, shown, slot, zoomed]);
  // Leaving the hour gives the view back to the pad.
  useEffect(
    () => () => {
      if (usePad.getState().slotId === slot) closeSlot();
    },
    [slot],
  );

  // What the row counts as ✕N, in the order it was crossed out (Kevin, 2026-11-25).
  const finished = useMemo(() => slotDoneElsewhere(all)[slot] ?? [], [all, slot]);
  const [listed, setListed] = useState(false);
  // What Fresh start would take out of the hour: its lines that are not crossed out.
  const leftovers = useMemo(() => slotLeftovers(all, slot).length, [all, slot]);

  return (
    <View>
      {mine && render({ day, hour, slot })}
      {mine && (
        // Empty space under the lines: a tap opens a new line at the end of the hour, as a
        // tap under a pad does (Kevin, 2026-11-27). An hour with nothing in it says so.
        <Tap aria-label="Add a line to this hour" onPress={cmdAppendAtEnd} style={empty ? styles.blank : styles.space} activeStyle={null}>
          {empty ? <Text style={[styles.small, styles.hint, { color: theme.inkQuiet }]}>Nothing in this hour. Tap here to add a line.</Text> : null}
        </Tap>
      )}
      <View style={styles.foot}>
        <Tap aria-label="Find a line in a pad for this hour" onPress={() => cmdFindForSlot(day, hour)} hitSlop={6} style={styles.icon} activeStyle={{ backgroundColor: theme.paper }}>
          <FindIcon color={theme.inkSoft} />
        </Tap>
        {finished.length > 0 && (
          <Tap aria-expanded={listed} aria-label={`Done in this hour: ${finished.length}`} onPress={() => setListed(!listed)} hitSlop={6} style={styles.link} activeStyle={{ backgroundColor: theme.paper }}>
            <Text style={[styles.small, styles.underline, { color: theme.inkSoft }]}>
              ✕{finished.length} done {listed ? '▴' : '▾'}
            </Text>
          </Tap>
        )}
        <View style={styles.gap} />
        <Tap
          aria-label="Fresh start: take the lines that are not done out of this hour"
          disabled={leftovers === 0}
          onPress={() => cmdSlotFresh(day, hour)}
          hitSlop={6}
          style={[styles.link, leftovers === 0 && styles.off]}
          activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.small, { color: theme.inkSoft }]}>Fresh start</Text>
        </Tap>
        <Tap aria-label="Close this hour" onPress={onClose} hitSlop={6} style={styles.link} activeStyle={{ backgroundColor: theme.paper }}>
          <Text style={[styles.small, { color: theme.ink }]}>Close</Text>
        </Tap>
      </View>
      {listed && finished.length > 0 && (
        // Lines from any pad, crossed out while this hour ran, cleared ones too. Read only:
        // they live in their own pads, and in their own hours if they have one.
        <View role="list" aria-label="Lines done in this hour">
          {finished.map((r) => (
            <View key={r.id} role="listitem" style={styles.line}>
              <View aria-hidden style={styles.bullet}>
                <StateMark state="done" color={theme.inkQuiet} />
              </View>
              <Text style={[styles.text, styles.struck, { color: theme.inkQuiet, textDecorationColor: theme.accent }]}>{r.text}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// A magnifier with a plus in its glass: find a line and add it. Drawn with Views, so both
// apps have it without an icon font.
function FindIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 20, height: 20 }}>
      <View style={{ width: 15, height: 15, borderRadius: 7.5, borderWidth: 1.5, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 7, height: 1.5, backgroundColor: color }} />
        <View style={{ position: 'absolute', width: 1.5, height: 7, backgroundColor: color }} />
      </View>
      <View style={{ position: 'absolute', left: 11.5, top: 14.5, width: 7.5, height: 1.5, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
    </View>
  );
}

const styles = StyleSheet.create({
  // The tap target under the lines: a line and a half of nothing, like the foot of a pad.
  space: { minHeight: Math.round(LINE * 1.5) },
  blank: { minHeight: ROW, justifyContent: 'center', paddingLeft: Platform.OS === 'web' ? 9 : 10 },
  hint: { fontStyle: 'italic' },
  foot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, minHeight: 32 },
  gap: { flex: 1 },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  link: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 4 },
  off: { opacity: 0.45 },
  underline: { textDecorationLine: 'underline' },
  // A line as the pad draws one: a bullet in its own column, the words in the pad's line.
  // The bullet sits where each app's pad puts its own: measured against the web's rows,
  // and the phone's 36pt gutter.
  line: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 2, ...(Platform.OS === 'web' ? { marginLeft: 4, gap: 5 } : null) },
  bullet: { width: Platform.OS === 'web' ? 28 : 36, height: LINE, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  struck: { textDecorationLine: 'line-through' },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
});
