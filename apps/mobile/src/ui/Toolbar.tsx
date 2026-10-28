import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { buildIndex, childrenOf, topmost } from '@hissypad/core'
import {
  clearSelection, stopEditing, usePad,
  cmdAddAbove, cmdAddBelow, cmdCopySelection, cmdDedent, cmdDeleteSelection, cmdIndent, cmdMove, cmdToggleCollapsed, cmdToggleDone, cmdToggleNumbered,
} from '@hissypad/state'
import { serif, type Theme } from '../theme'

function abilities(rows: ReturnType<typeof usePad.getState>['rows'], ids: string[]) {
  const index = buildIndex(rows)
  const tops = topmost(index, ids)
  const set = new Set(tops)
  let indent = false, dedent = false, up = false, down = false, fold = false
  for (const id of tops) {
    const parent = index.parentOf.get(id) ?? null
    const sibs = childrenOf(index, parent)
    const i = sibs.findIndex((x) => x.id === id)
    if (sibs.slice(0, i).some((x) => !set.has(x.id))) { indent = true; up = true }
    if (sibs.slice(i + 1).some((x) => !set.has(x.id))) down = true
    if (parent !== null) dedent = true
    if (childrenOf(index, id).length > 0) fold = true
  }
  return { indent, dedent, up, down, fold }
}

function Btn({ label, onPress, disabled, a11y, theme }: { label: string; onPress: () => void; disabled?: boolean; a11y?: string; theme: Theme }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y ?? label} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.btn, pressed && { backgroundColor: theme.accentSoft }]}>
      <Text style={[s.btnText, { color: disabled ? theme.inkMute : theme.ink, opacity: disabled ? 0.5 : 1 }]}>{label}</Text>
    </Pressable>
  )
}

export function Toolbar({ theme }: { theme: Theme }) {
  const selection = usePad((s) => s.selection)
  const editing = usePad((s) => s.editing)
  const rows = usePad((s) => s.rows)
  const ids = selection.length > 0 ? selection : editing ? [editing.id] : []
  const can = useMemo(() => abilities(rows, ids), [rows, ids])
  if (ids.length === 0) return null
  const n = selection.length
  const sep = <View style={[s.sep, { backgroundColor: theme.rule }]} />
  return (
    <View style={[s.bar, { backgroundColor: theme.paperRaised, borderColor: theme.rule }]} accessibilityRole="toolbar">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={s.inner}>
        {n > 1 && <Text style={[s.count, { color: theme.inkMute }]}>{n} lines</Text>}
        <Btn theme={theme} label="Done" onPress={cmdToggleDone} />
        <Btn theme={theme} label="1." a11y="Numbered list" onPress={cmdToggleNumbered} />
        {sep}
        <Btn theme={theme} label="+ above" a11y="Add a line above" onPress={cmdAddAbove} />
        <Btn theme={theme} label="+ below" a11y="Add a line below" onPress={cmdAddBelow} />
        {sep}
        <Btn theme={theme} label="←" a11y="Outdent" onPress={cmdDedent} disabled={!can.dedent} />
        <Btn theme={theme} label="→" a11y="Indent" onPress={cmdIndent} disabled={!can.indent} />
        <Btn theme={theme} label="↑" a11y="Move up" onPress={() => cmdMove('up')} disabled={!can.up} />
        <Btn theme={theme} label="↓" a11y="Move down" onPress={() => cmdMove('down')} disabled={!can.down} />
        {sep}
        <Btn theme={theme} label="Fold" onPress={cmdToggleCollapsed} disabled={!can.fold} />
        <Btn theme={theme} label="Copy" onPress={() => void cmdCopySelection()} />
        <Btn theme={theme} label="Delete" onPress={cmdDeleteSelection} />
        <Btn theme={theme} label="×" a11y={n > 0 ? 'Clear selection' : 'Stop editing'} onPress={() => (n > 0 ? clearSelection() : stopEditing())} />
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  inner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4, gap: 2 },
  btn: { minWidth: 40, minHeight: 40, paddingHorizontal: 8, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: serif, fontSize: 16 },
  count: { fontFamily: serif, fontSize: 15, paddingHorizontal: 8 },
  sep: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 4 },
})
