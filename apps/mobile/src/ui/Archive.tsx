// The Archive as a screen of its own: every archived line drawn like a pad's, the newest
// archive first, in an order that cannot be changed. A tap on a line selects it; the one
// action is Unarchive, which puts each line at the top of the pad its chip names. The
// list, the selection rules and the command are the state package's archive.ts, the same
// as the web's screen.
import { memo, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { inlineSpans, slotLabel, todayKey } from '@hissypad/core'
import {
  ARCHIVE_DAYS, NO_ARCHIVE_SELECTION, archiveCovered, archiveLines, archivePrune, archiveRecent, archiveTap, cmdUnarchive, dayLabel,
  unarchivedLabel, usePad, type ArchiveLine, type ArchiveSelection,
} from '@hissypad/state'
import { useLineCategory } from '@hissypad/state/hours'
import { CategoryBadge } from '@hissypad/ui'
import { GUTTER, INDENT, LINE, SIZE, mono, serif, type Theme } from '../theme'

const Line = memo(function Line({ line, selected, covered, found, theme, onTap }: { line: ArchiveLine; selected: boolean; covered: boolean; found: boolean; theme: Theme; onTap: (id: string) => void }) {
  const { row } = line
  const category = useLineCategory(row.category)
  // The pad it was in; an archived pad says what it is. A line under another has no chip:
  // it was in the same pad as the line on top.
  const chip = line.isPad ? 'Pad' : line.depth === 0 ? line.source : null
  const gone = !line.isPad && !line.sourceLive
  const mark = row.done ? theme.inkMute : theme.inkSoft
  return (
    <Pressable
      onPress={() => onTap(line.id)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${row.text.trim() || 'Blank line'}, ${line.isPad ? 'a pad' : `from ${line.source}`}`}
      accessibilityHint={selected ? 'Deselects the line' : 'Selects the line'}
      style={[
        s.row,
        { paddingLeft: line.depth * INDENT },
        selected && { backgroundColor: theme.accentSoft },
        covered && { backgroundColor: theme.accentFaint },
        // The line Search sent here: a rule down its left edge, so it does not rest on color alone.
        found && { borderLeftWidth: 3, borderLeftColor: theme.accent },
      ]}
    >
      <View style={s.bullet}>
        {line.number !== null ? (
          <Text style={[s.num, { color: mark }, row.done && { textDecorationLine: 'line-through' }]}>{line.number}.</Text>
        ) : row.header ? (
          <Text style={[s.hash, { color: mark }, row.done && { textDecorationLine: 'line-through' }]}>#</Text>
        ) : row.done ? (
          <Text style={[s.cross, { color: theme.inkMute }]}>×</Text>
        ) : row.doing ? (
          <View style={[s.ring, { borderColor: theme.inkSoft }]}><View style={[s.dot, { backgroundColor: theme.inkSoft }]} /></View>
        ) : (
          <View style={[s.dot, { backgroundColor: theme.inkSoft }]} />
        )}
      </View>
      {category && <View style={[s.category, row.done && { opacity: 0.55 }]}><CategoryBadge category={category} wordWhenBare /></View>}
      <Text style={[s.text, { color: row.done ? theme.inkMute : theme.ink }, row.header && s.bold, row.done && { textDecorationLine: 'line-through', textDecorationColor: theme.accent }]}>
        {row.text.trim() === '' ? ' ' : inlineSpans(row.text).map((sp, i) => {
          const strike = sp.strike || row.done
          const deco = sp.underline ? (strike ? 'underline line-through' : 'underline') : sp.strike ? 'line-through' : undefined
          if (!sp.bold && !sp.italic && !deco && !sp.highlight && !sp.code) return sp.text
          return (
            <Text key={i} style={[sp.bold && s.bold, sp.italic && s.italic, deco && { textDecorationLine: deco }, sp.code && [s.code, { backgroundColor: theme.codeBg }], sp.highlight && { backgroundColor: theme.markHl }]}>
              {sp.text}
            </Text>
          )
        })}
        {row.slot && <Text style={[s.slot, { color: theme.inkSoft }]}>{' '}{slotLabel(row.slot, todayKey())}</Text>}
      </Text>
      {chip && (
        <View style={[s.src, { borderColor: theme.rule }, gone && s.srcGone]}>
          <Text numberOfLines={1} style={[s.srcText, { color: gone ? theme.inkMute : theme.inkSoft }]}>{chip}</Text>
        </View>
      )}
    </Pressable>
  )
})

// `at` is a line to open at (an archived line picked in Search): it is scrolled to and
// marked. `onClose` goes back to the pad. `bottom` is the room the home indicator needs.
export function ArchiveView({ at, onClose, theme, bottom }: { at: { id: string; rev: number } | null; onClose: () => void; theme: Theme; bottom: number }) {
  const all = usePad((s) => s.all)
  const lines = useMemo(() => archiveLines(all), [all])
  const recent = useMemo(() => archiveRecent(lines), [lines])
  const [older, setOlder] = useState(false)
  const [picked, setPicked] = useState<ArchiveSelection>(NO_ARCHIVE_SELECTION)
  const [said, setSaid] = useState<string | null>(null)
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null)
  const ys = useRef(new Map<string, number>())

  // A line found in Search may be older than what the screen opens with.
  const atIndex = at ? lines.findIndex((l) => l.id === at.id) : -1
  const shown = older || atIndex >= recent ? lines : lines.slice(0, recent)
  const sel = archivePrune(picked, lines)
  const selected = useMemo(() => new Set(sel.ids), [sel])
  const covered = useMemo(() => archiveCovered(lines, sel.ids), [lines, sel])
  const count = sel.ids.length + covered.size
  const rest = lines.length - shown.length

  // The rows report where they are as they are laid out; the one to open at is scrolled to
  // once it has (a little after the screen is up, and again on a second trip to it).
  useEffect(() => {
    if (!at) return
    const t = setTimeout(() => {
      const y = ys.current.get(at.id)
      if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - 120), animated: true })
    }, 250)
    return () => clearTimeout(t)
  }, [at?.id, at?.rev])

  const state = useRef({ sel, shown })
  state.current = { sel, shown }
  const onTap = useRef((id: string) => setPicked(archiveTap(state.current.sel, state.current.shown, id))).current

  function unarchive() {
    // In the order they are listed, so they land in that order.
    const order = lines.filter((l) => selected.has(l.id)).map((l) => l.id)
    setSaid(`${unarchivedLabel(cmdUnarchive(order))} Shake to undo.`)
    setPicked(NO_ARCHIVE_SELECTION)
  }

  let day = ''
  return (
    <View style={s.root}>
      <View style={s.head}>
        <Text accessibilityRole="header" style={[s.title, { color: theme.ink }]}>Archive</Text>
        <Pressable onPress={onClose} style={s.back} hitSlop={{ top: 8, bottom: 8, left: 16, right: 8 }} accessibilityRole="button" accessibilityLabel="Back to the pad">
          <Text style={[s.backText, { color: theme.link }]}>Back to the pad</Text>
        </Pressable>
      </View>
      <Text style={[s.said, { color: theme.inkSoft }]} numberOfLines={1} accessibilityLiveRegion="polite">{said ?? ''}</Text>
      <ScrollView ref={scroller} style={s.root} contentContainerStyle={[s.content, { paddingBottom: 96 + bottom }]}>
        {lines.length === 0 && <Text style={[s.note, { color: theme.inkMute }]}>Nothing is archived.</Text>}
        {shown.map((l) => {
          // A heading where the day changes, as the day of the line on top.
          const label = l.depth === 0 ? dayLabel(l.deletedAt) : day
          const head = label !== day
          day = label
          return (
            // The line with the day heading over it, when it opens a day: where this sits in
            // the list is where the line is.
            <View key={l.id} onLayout={(e) => void ys.current.set(l.id, e.nativeEvent.layout.y)}>
              {head && <Text style={[s.day, { color: theme.inkMute }]}>{label.toUpperCase()}</Text>}
              <Line line={l} selected={selected.has(l.id)} covered={covered.has(l.id)} found={at?.id === l.id} theme={theme} onTap={onTap} />
            </View>
          )
        })}
        {rest > 0 && (
          <Pressable onPress={() => setOlder(true)} style={s.older} accessibilityRole="button">
            <Text style={[s.backText, { color: theme.link }]}>Show the {rest} older {rest === 1 ? 'line' : 'lines'}</Text>
          </Pressable>
        )}
        {lines.length > 0 && (
          <Text style={[s.note, { color: theme.inkMute }]}>
            {rest > 0 ? `Lines archived in the last ${ARCHIVE_DAYS} days, the newest first. ` : 'Every archived line, the newest first. '}
            Tap lines to select them. Unarchive puts each at the top of the pad it was in.
          </Text>
        )}
      </ScrollView>
      {sel.ids.length > 0 && (
        <View style={[s.bar, { bottom: 16 + bottom, backgroundColor: theme.paperRaised, borderColor: theme.rule }]}>
          <Text style={[s.count, { color: theme.inkMute }]}>{count} {count === 1 ? 'line' : 'lines'}</Text>
          <Pressable onPress={unarchive} accessibilityRole="button" accessibilityLabel="Unarchive" style={({ pressed }) => [s.barBtn, pressed && { backgroundColor: theme.accentSoft }]}>
            <Text style={[s.barText, { color: theme.ink }]}>Unarchive</Text>
          </Pressable>
          <View style={[s.sep, { backgroundColor: theme.rule }]} />
          <Pressable onPress={() => setPicked(NO_ARCHIVE_SELECTION)} accessibilityRole="button" accessibilityLabel="Clear selection" style={({ pressed }) => [s.barBtn, pressed && { backgroundColor: theme.accentSoft }]}>
            <Text style={[s.barText, { color: theme.ink }]}>×</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingLeft: GUTTER + 8, paddingRight: 16, paddingTop: 2 },
  title: { fontFamily: serif, fontStyle: 'italic', fontSize: 19 },
  back: { minHeight: 32, justifyContent: 'center' },
  backText: { fontFamily: serif, fontSize: 15, textDecorationLine: 'underline' },
  said: { height: 22, paddingHorizontal: 16, fontFamily: serif, fontStyle: 'italic', fontSize: 14 },
  content: { paddingHorizontal: 8 },
  day: { fontFamily: serif, fontSize: 12, letterSpacing: 1, marginTop: 14, marginBottom: 4, paddingLeft: GUTTER },
  row: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 4, paddingRight: 8 },
  bullet: { width: GUTTER, minHeight: LINE, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  ring: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cross: { fontFamily: serif, fontSize: SIZE + 2, lineHeight: LINE },
  hash: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, fontWeight: '700' },
  num: { fontFamily: serif, fontSize: SIZE - 1, lineHeight: LINE, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: mono, fontSize: SIZE - 2 },
  category: { marginTop: (LINE - 22) / 2, marginRight: 6 },
  text: { flex: 1, fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  slot: { fontSize: SIZE - 5, fontWeight: '400', fontStyle: 'normal', textDecorationLine: 'none' },
  src: { maxWidth: 120, marginLeft: 10, marginTop: (LINE - 20) / 2, height: 20, paddingHorizontal: 6, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  // Its pad is archived too.
  srcGone: { borderStyle: 'dashed' },
  srcText: { fontFamily: serif, fontSize: 12 },
  older: { minHeight: 40, justifyContent: 'center', paddingLeft: GUTTER, marginTop: 8 },
  note: { fontFamily: serif, fontStyle: 'italic', fontSize: 15, lineHeight: 22, paddingLeft: GUTTER, paddingRight: 8, marginTop: 12 },
  bar: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  count: { fontFamily: serif, fontSize: 15, paddingHorizontal: 8 },
  barBtn: { minHeight: 40, minWidth: 40, paddingHorizontal: 12, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  barText: { fontFamily: serif, fontSize: 16 },
  sep: { width: StyleSheet.hairlineWidth, height: 22 },
})
