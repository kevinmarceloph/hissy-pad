import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { slotKey, slotLines, stateOf } from '@hissypad/core';
import { closeSlot, cmdUnarchive, openSlot, usePad } from '@hissypad/state';

import { SlotAdder } from './SlotAdder';
import { StateMark } from './StateMark';
import { Tap } from './Tap';
import { LINE, serif, SIZE, SMALL, useTheme } from './theme';

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

// An open hour's lines, drawn by the pad's own editor (PLAN.md, "Hours joins the pad"): the store is
// asked to show this hour, the host draws its rows, and the host's toolbar acts on them.
// Under them, what a view of live rows leaves out, the hour's archived lines under a
// heading of their own, and the field that brings lines in.
export function HostedLines({ day, hour, onClose }: Props) {
  const theme = useTheme();
  // Both apps hand an editor in. Without one (a screen under test) no lines are drawn and
  // the store's view is left alone.
  const render = useHostedLines();
  const slot = slotKey(day, hour);
  const shown = usePad((s) => s.slotId);
  const zoomed = usePad((s) => s.zoomId !== null);
  const all = usePad((s) => s.all);

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

  const archived = slotLines(all, slot).filter((r) => r.deletedAt !== null);

  return (
    <View style={styles.group}>
      {render && shown === slot && render({ day, hour, slot })}
      {archived.length > 0 && (
        // Drawn like the pad's lines, under a heading of their own: a bullet that says the
        // line's state, its words, and the way back (Kevin, 2026-11-25). Unarchiving puts
        // the line at the top of its pad (cmdUnarchive), and so back among the hour's lines above.
        <View>
          <Text role="heading" aria-level={3} style={[styles.heading, { color: theme.inkSoft }]}>
            Archived
          </Text>
          <View role="list" aria-label="Archived lines in this hour">
            {archived.map((r) => (
              <View key={r.id} role="listitem" style={styles.line}>
                <View aria-hidden style={styles.bullet}>
                  <StateMark state={stateOf(r)} color={r.done ? theme.inkQuiet : theme.inkSoft} />
                </View>
                <Text style={[styles.text, { color: r.done ? theme.inkQuiet : theme.ink }, r.done && styles.struck]}>{r.text}</Text>
                <Tap
                  aria-label={`Unarchive “${r.text}”`}
                  onPress={() => cmdUnarchive([r.id])}
                  style={[styles.back, { borderColor: theme.line }]}
                  activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paper }}>
                  <Text style={[styles.small, { color: theme.ink }]}>Unarchive</Text>
                </Tap>
              </View>
            ))}
          </View>
        </View>
      )}
      <SlotAdder day={day} hour={hour} onClose={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  heading: { fontFamily: serif, fontSize: SMALL, lineHeight: 20, marginBottom: 2 },
  // A line as the pad draws one: a bullet in its own column, the words in the pad's line.
  // The bullet sits where each app's pad puts its own: measured against the web's rows,
  // and the phone's 36pt gutter.
  line: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 2, ...(Platform.OS === 'web' ? { marginLeft: 4, gap: 5 } : null) },
  bullet: { width: Platform.OS === 'web' ? 28 : 36, height: LINE, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  struck: { textDecorationLine: 'line-through' },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  back: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderRadius: 15 },
});
