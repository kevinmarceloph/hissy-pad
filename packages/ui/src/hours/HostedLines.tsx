import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { slotDoneElsewhere, slotKey, slotLines, stateOf, type Rows } from '@hissypad/core';
import { archiveLines, closeSlot, cmdUnarchive, openSlot, usePad, type ArchiveLine } from '@hissypad/state';

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
// Under them, what a view of live rows leaves out: the lines crossed out during the hour
// that were not put in it, and the hour's archived lines, each under a heading of their
// own; then the field that brings lines in.
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

  const archived = useMemo(() => archivedTrees(all, slot), [all, slot]);
  // What the row counts as ✕N, in the order it was crossed out (Kevin, 2026-11-25).
  const finished = useMemo(() => slotDoneElsewhere(all)[slot] ?? [], [all, slot]);

  return (
    <View style={styles.group}>
      {render && shown === slot && render({ day, hour, slot })}
      {finished.length > 0 && (
        // Lines from any pad, crossed out while this hour ran, cleared ones too. Read only:
        // they live in their own pads, and in their own hours if they have one.
        <View>
          <Text role="heading" aria-level={3} style={[styles.heading, { color: theme.inkSoft }]}>
            Done in this hour
          </Text>
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
        </View>
      )}
      {archived.length > 0 && (
        // Drawn as the pad draws a line: its bullet says its state (a cross when done), done
        // words struck through in the accent, and what was archived with it nested under it
        // (Kevin, 2026-11-25). Unarchiving a line puts it at the top of its pad with what is
        // under it (cmdUnarchive), and so back among the hour's lines above.
        <View>
          <Text role="heading" aria-level={3} style={[styles.heading, { color: theme.inkSoft }]}>
            Archived
          </Text>
          <View role="list" aria-label="Archived lines in this hour">
            {archived.map(({ row: r, depth }) => (
              <View key={r.id} role="listitem" style={[styles.line, { paddingLeft: depth * INDENT }]}>
                <View aria-hidden style={styles.bullet}>
                  <StateMark state={stateOf(r)} color={r.done ? theme.inkQuiet : theme.inkSoft} />
                </View>
                <Text style={[styles.text, { color: r.done ? theme.inkQuiet : theme.ink }, r.done && [styles.struck, { textDecorationColor: theme.accent }]]}>{r.text}</Text>
                {depth === 0 && (
                  <Tap
                    aria-label={`Unarchive “${r.text}”`}
                    onPress={() => cmdUnarchive([r.id])}
                    hitSlop={8}
                    style={styles.back}
                    activeStyle={{ backgroundColor: theme.paper }}>
                    <Text style={[styles.small, styles.link, { color: theme.inkSoft }]}>Unarchive</Text>
                  </Tap>
                )}
              </View>
            ))}
          </View>
        </View>
      )}
      <SlotAdder day={day} hour={hour} onClose={onClose} />
    </View>
  );
}

// How far a line under another sits in: the pad's own step on each app (the web's 1.6rem,
// the phone's INDENT).
const INDENT = Platform.OS === 'web' ? 25.6 : 22;

// The hour's archived lines, each with what was archived under it in the same archive, in
// the order the Archive screen draws them (archiveLines). A line under another archived
// line of this hour is drawn under it, not again on its own. Depth counts from the hour's line.
function archivedTrees(all: Rows, slot: string): ArchiveLine[] {
  const mine = new Set(slotLines(all, slot).filter((r) => r.deletedAt !== null).map((r) => r.id));
  if (mine.size === 0) return [];
  const out: ArchiveLine[] = [];
  const lines = archiveLines(all);
  for (let i = 0; i < lines.length; i++) {
    const top = lines[i]!;
    if (!mine.has(top.id)) continue;
    out.push({ ...top, depth: 0 });
    let j = i + 1;
    for (; j < lines.length && lines[j]!.depth > top.depth; j++) out.push({ ...lines[j]!, depth: lines[j]!.depth - top.depth });
    i = j - 1;
  }
  return out;
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
  // A quiet link the height of a line, so the row is as tall as the pad's; hitSlop widens the target.
  back: { height: LINE, justifyContent: 'center', paddingHorizontal: 6, borderRadius: 4 },
  link: { textDecorationLine: 'underline' },
});
