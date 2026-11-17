// The line toolbar above the keyboard. Its buttons come from LINE_ACTIONS in the state
// package, the same list the web's SelectionBar draws; the line type switcher and the
// "Move to…" pad list are drawn here.
import { Fragment, useMemo } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { kindOf } from '@hissypad/core'
import {
  clearSelection, cmdMoveToPad, cmdSetKind, lineAbilities, lineCount, padList, stopEditing, usePad,
  LINE_ACTIONS, LINE_KINDS, type LineActionGroup,
} from '@hissypad/state'
import { serif, type Theme } from '../theme'

// A rule is drawn before the first button of these groups.
const RULE_BEFORE: ReadonlySet<LineActionGroup> = new Set(['add', 'move', 'tree'])

function Btn({ label, onPress, disabled, a11y, theme, on, style }: { label: string; onPress: () => void; disabled?: boolean; a11y?: string; theme: Theme; on?: boolean; style?: object }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={on === undefined ? undefined : { selected: on }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.btn, style, (pressed || on) && { backgroundColor: theme.accentSoft }]}>
      <Text style={[s.btnText, { color: disabled ? theme.inkMute : theme.ink, opacity: disabled ? 0.5 : 1 }]}>{label}</Text>
    </Pressable>
  )
}

export function Toolbar({ theme }: { theme: Theme }) {
  const selection = usePad((s) => s.selection)
  const editing = usePad((s) => s.editing)
  const rows = usePad((s) => s.rows)
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const ids = selection.length > 0 ? selection : editing ? [editing.id] : []
  const can = useMemo(() => lineAbilities(rows, ids), [rows, ids])
  const others = useMemo(() => padList(all).filter((p) => p.id !== padId), [all, padId])
  if (ids.length === 0) return null
  // Move to another pad: the pads as a list of buttons (iOS stacks them).
  function moveTo() {
    Alert.alert('Move to', undefined, [
      ...others.map((p) => ({ text: p.name, onPress: () => void cmdMoveToPad(p.id) })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }
  const n = selection.length
  // Mixed selections show the first line's type; a tap sets them all.
  const first = rows[ids[0]!]
  const current = first ? kindOf(first) : 'plain'
  const sep = <View style={[s.sep, { backgroundColor: theme.rule }]} />
  const kinds = (
    <View style={[s.kind, { borderColor: theme.rule }]} accessibilityRole="radiogroup" accessibilityLabel="Line type">
      {LINE_KINDS.map((k, i) => (
        <Btn key={k.kind} theme={theme} label={k.glyph} a11y={k.name} on={current === k.kind} onPress={() => cmdSetKind(k.kind)} style={[s.kindBtn, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: theme.rule }]} />
      ))}
    </View>
  )
  return (
    <View style={[s.bar, { backgroundColor: theme.paperRaised, borderColor: theme.rule }]} accessibilityRole="toolbar">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={s.inner}>
        {n > 1 && <Text style={[s.count, { color: theme.inkMute }]}>{lineCount(n)}</Text>}
        {LINE_ACTIONS.map((a, i) => {
          const prev = LINE_ACTIONS[i - 1]?.group
          const opens = prev !== a.group
          return (
            <Fragment key={a.id}>
              {opens && prev === 'mark' && kinds}
              {opens && RULE_BEFORE.has(a.group) && sep}
              {opens && a.group === 'pad' && others.length > 0 && <Btn theme={theme} label="Move to…" a11y="Move to another pad" onPress={moveTo} />}
              <Btn theme={theme} label={a.label} a11y={a.name} onPress={() => void a.run()} disabled={a.enabled ? !a.enabled(can) : false} />
            </Fragment>
          )
        })}
        <Btn theme={theme} label="×" a11y={n > 0 ? 'Clear selection' : 'Stop editing'} onPress={() => (n > 0 ? clearSelection() : stopEditing())} />
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  inner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4, gap: 2 },
  btn: { minWidth: 40, minHeight: 40, paddingHorizontal: 8, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  kind: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, overflow: 'hidden', marginHorizontal: 2 },
  kindBtn: { minWidth: 36, borderRadius: 0 },
  btnText: { fontFamily: serif, fontSize: 16 },
  count: { fontFamily: serif, fontSize: 15, paddingHorizontal: 8 },
  sep: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 4 },
})
