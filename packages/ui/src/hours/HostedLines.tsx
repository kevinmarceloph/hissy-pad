import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { slotKey, slotLines } from '@hissypad/core';
import { closeSlot, openSlot, usePad } from '@hissypad/state';
import { cmdSlotClear, cmdSlotDone } from '@hissypad/state/hours';

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
// Under them, what a view of live rows leaves out, the hour's archived lines, and the
// field that brings lines in.
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
        <View role="list" aria-label="Archived lines in this hour">
          {archived.map((r) => (
            <View key={r.id} role="listitem" style={styles.line}>
              {/* An archived line can still be crossed out here, or not: it was the hour's. */}
              <Tap
                role="checkbox"
                aria-checked={r.done}
                aria-label={`${r.text}, archived`}
                onPress={() => cmdSlotDone(r.id, !r.done)}
                style={styles.out}
                activeStyle={{ backgroundColor: theme.paper }}>
                <StateMark state={r.done ? 'done' : 'open'} color={theme.inkQuiet} />
              </Tap>
              <Text numberOfLines={2} style={[styles.text, { color: theme.inkQuiet }, r.done && styles.struck]}>
                {r.text}
              </Text>
              <Text style={[styles.small, { color: theme.inkSoft }]}>archived</Text>
              <Tap
                aria-label={`Take “${r.text}” out of this hour`}
                onPress={() => cmdSlotClear(r.id)}
                style={[styles.out, styles.last]}
                activeStyle={{ backgroundColor: theme.paper }}>
                <Text style={[styles.text, { color: theme.inkSoft }]}>×</Text>
              </Tap>
            </View>
          ))}
        </View>
      )}
      <SlotAdder day={day} hour={hour} onClose={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  text: { flexShrink: 1, fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  struck: { textDecorationLine: 'line-through' },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  out: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  last: { marginLeft: 'auto' },
});
