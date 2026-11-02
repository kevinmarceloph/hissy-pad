// Trash and Recently done as full-screen modals: the same selectors and commands as the
// web panels, drawn with the app's paper-and-serif tokens.
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  cmdRestore, cmdUndone, doneEntries, groupByDay, timeLabel, trashEntries, usePad, TRASH_DAYS,
} from '@hissypad/state'
import { serif, type Theme } from '../theme'

function firstLine(text: string): string {
  const line = text.split('\n')[0]!.trim()
  return line === '' ? '(blank line)' : line
}

function Sheet({ visible, title, note, onClose, theme, children }: { visible: boolean; title: string; note: string; onClose: () => void; theme: Theme; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.root, { backgroundColor: theme.paper, paddingTop: 12 }]}>
        <View style={s.head}>
          <Text style={[s.title, { color: theme.ink }]}>{title}</Text>
          <Pressable onPress={onClose} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 24, right: 12 }} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[s.close, { color: theme.inkSoft }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
          {children}
          <Text style={[s.note, { color: theme.inkMute }]}>{note}</Text>
        </ScrollView>
      </View>
    </Modal>
  )
}

function Day({ label, theme }: { label: string; theme: Theme }) {
  return <Text style={[s.day, { color: theme.inkMute }]}>{label.toUpperCase()}</Text>
}

function Line({ text, sub, done, action, onPress, theme }: { text: string; sub: string | null; done?: boolean; action: string; onPress: () => void; theme: Theme }) {
  return (
    <View style={[s.line, { borderTopColor: theme.rule }]}>
      <View style={s.lineText}>
        <Text style={[s.txt, { color: done ? theme.inkMute : theme.ink }, done && { textDecorationLine: 'line-through', textDecorationColor: theme.accent }]}>{text}</Text>
        {sub && <Text style={[s.sub, { color: theme.inkMute }]}>{sub}</Text>}
      </View>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={action} style={({ pressed }) => [s.btn, { borderColor: pressed ? theme.accent : theme.rule }]}>
        <Text style={[s.btnText, { color: theme.ink }]}>{action}</Text>
      </Pressable>
    </View>
  )
}

const under = (n: number) => (n > 0 ? `+${n} ${n === 1 ? 'line' : 'lines'} under it` : null)

export function TrashSheet({ visible, onClose, theme }: { visible: boolean; onClose: () => void; theme: Theme }) {
  const rows = usePad((s) => s.all)
  const batches = visible ? trashEntries(rows) : []
  const groups = groupByDay(batches, (b) => b.deletedAt)
  const restore = (ids: string[]) => {
    cmdRestore(ids)
    onClose()
  }
  return (
    <Sheet visible={visible} title="Trash" note={`Deleted lines stay here for ${TRASH_DAYS} days.`} onClose={onClose} theme={theme}>
      {batches.length === 0 && <Text style={[s.empty, { color: theme.inkMute }]}>Nothing deleted in the last {TRASH_DAYS} days.</Text>}
      {groups.map((g) => (
        <View key={g.label}>
          <Day label={g.label} theme={theme} />
          {g.items.map((b) => (
            <View key={b.deletedAt} style={s.batch}>
              <View style={s.when}>
                <Text style={[s.whenText, { color: theme.inkMute }]}>{timeLabel(b.deletedAt)}</Text>
                {b.entries.length > 1 && (
                  <Pressable onPress={() => restore(b.entries.map((e) => e.id))} accessibilityRole="button">
                    <Text style={[s.whenText, { color: theme.link }]}>Restore all {b.count}</Text>
                  </Pressable>
                )}
              </View>
              {b.entries.map((e) => (
                <Line key={e.id} text={firstLine(e.text)} sub={under(e.childCount)} action="Restore" onPress={() => restore([e.id])} theme={theme} />
              ))}
            </View>
          ))}
        </View>
      ))}
    </Sheet>
  )
}

export function DoneSheet({ visible, onClose, theme }: { visible: boolean; onClose: () => void; theme: Theme }) {
  const rows = usePad((s) => s.all)
  const entries = visible ? doneEntries(rows) : []
  const groups = groupByDay(entries, (e) => e.doneAt)
  return (
    <Sheet visible={visible} title="Recently done" note="Crossed-out lines stay in the pad until you delete them." onClose={onClose} theme={theme}>
      {entries.length === 0 && <Text style={[s.empty, { color: theme.inkMute }]}>Nothing is crossed out.</Text>}
      {groups.map((g) => (
        <View key={g.label}>
          <Day label={g.label} theme={theme} />
          {g.items.map((e) => (
            <Line key={e.id} text={firstLine(e.text)} sub={under(e.childCount)} done action="Undone" onPress={() => cmdUndone(e.id)} theme={theme} />
          ))}
        </View>
      ))}
    </Sheet>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontFamily: serif, fontSize: 21 },
  closeBtn: { minHeight: 44, paddingHorizontal: 12, marginRight: -12, justifyContent: 'center' },
  close: { fontFamily: serif, fontSize: 16 },
  day: { fontFamily: serif, fontSize: 12, letterSpacing: 1, marginTop: 16, marginBottom: 4 },
  batch: { marginBottom: 8 },
  when: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 2 },
  whenText: { fontFamily: serif, fontSize: 13 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  lineText: { flex: 1, minWidth: 0 },
  txt: { fontFamily: serif, fontSize: 17, lineHeight: 24 },
  sub: { fontFamily: serif, fontSize: 13, marginTop: 2 },
  btn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  btnText: { fontFamily: serif, fontSize: 15 },
  empty: { fontFamily: serif, fontStyle: 'italic', fontSize: 15, marginTop: 8 },
  note: { fontFamily: serif, fontStyle: 'italic', fontSize: 14, marginTop: 24 },
})
