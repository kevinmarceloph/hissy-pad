// The line toolbar above the keyboard. Its buttons come from LINE_ACTIONS in the state
// package, the same list the web's SelectionBar draws. On the phone it is two rows
// instead of one that scrolls sideways, and three things live elsewhere: crossing out and
// "done editing" are the floating buttons at the bottom right (FloatingButtons.tsx), and the
// pad actions (Move to…, Make pad) are behind More.
import { useMemo } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { kindOf } from '@hissypad/core'
import {
  cmdMoveToPad, cmdSetKind, countOf, lineAbilities, lineCount, padList, usePad,
  LINE_ACTIONS, LINE_KINDS, type LineActionGroup,
} from '@hissypad/state'
import { serif, type Theme } from '../theme'

// The 'mark' group (Done) is the floating × / • toggle; it is not repeated here.
const HIDDEN: ReadonlySet<LineActionGroup> = new Set(['mark'])

function Btn({ label, onPress, disabled, a11y, theme, on, style }: { label: string; onPress: () => void; disabled?: boolean; a11y?: string; theme: Theme; on?: boolean; style?: object | undefined }) {
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
  const shown = LINE_ACTIONS.filter((a) => !HIDDEN.has(a.group) && !a.more)
  const tucked = LINE_ACTIONS.filter((a) => a.more && (a.enabled ? a.enabled(can) : true))

  // More: the pads to move to, then the tucked-away actions (iOS stacks them).
  function more() {
    Alert.alert('More', undefined, [
      ...others.map((p) => ({ text: `Move to ${p.name}`, onPress: () => void cmdMoveToPad(p.id) })),
      ...tucked.map((a) => ({ text: a.label, onPress: () => void a.run() })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  const n = selection.length
  // Mixed selections show the first line's type; a tap sets them all.
  const first = rows[ids[0]!]
  const current = first ? kindOf(first) : 'plain'
  const kinds = (
    <View style={[s.kind, { borderColor: theme.rule }]} accessibilityRole="radiogroup" accessibilityLabel="Line type">
      {LINE_KINDS.map((k, i) => (
        <Btn key={k.kind} theme={theme} label={k.glyph} a11y={k.name} on={current === k.kind} onPress={() => cmdSetKind(k.kind)} style={[s.kindBtn, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: theme.rule }]} />
      ))}
    </View>
  )
  const button = (a: (typeof LINE_ACTIONS)[number], style?: object) => (
    <Btn key={a.id} theme={theme} label={a.label} a11y={a.name} onPress={() => void a.run()} disabled={a.enabled ? !a.enabled(can) : false} style={style} />
  )
  // Two rows, no sideways scrolling. The top row is the structure of the line: where it
  // sits, what kind it is, a new line beside it. The second row is everything else in
  // registry order, so a new action lands there (and wraps if it ever runs out of room).
  const top = new Set<LineActionGroup>(['move', 'add'])
  const rest = shown.filter((a) => !top.has(a.group))
  return (
    <View style={[s.bar, { backgroundColor: theme.paperRaised, borderColor: theme.rule }]} accessibilityRole="toolbar">
      <View style={s.row}>
        {shown.filter((a) => a.group === 'move').map((a) => button(a, s.arrow))}
        {kinds}
        {shown.filter((a) => a.group === 'add').map((a) => button(a))}
      </View>
      <View style={[s.row, s.second]}>
        {n > 1 && countOf(selection, rows) > 0 && <Text style={[s.count, { color: theme.inkMute }]}>{lineCount(countOf(selection, rows))}</Text>}
        {rest.map((a) => button(a))}
        {(others.length > 0 || tucked.length > 0) && <Btn theme={theme} label="More…" a11y="More actions" onPress={more} />}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  second: { flexWrap: 'wrap', justifyContent: 'flex-start', columnGap: 6 },
  btn: { minWidth: 38, minHeight: 40, paddingHorizontal: 7, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  arrow: { minWidth: 36, paddingHorizontal: 4 },
  kind: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, overflow: 'hidden' },
  kindBtn: { minWidth: 32, minHeight: 34, borderRadius: 0 },
  btnText: { fontFamily: serif, fontSize: 16 },
  count: { fontFamily: serif, fontSize: 15, paddingHorizontal: 6 },
})
