// The line toolbar above the keyboard. Its buttons come from LINE_ACTIONS in the state
// package, the same list the web's SelectionBar draws. On the phone it is two rows
// (as it is on the web at phone width), and Hour…, Category…, the open / doing / done
// switch and "done editing" are the floating buttons at the bottom right (FloatingButtons.tsx), and so is
// Move to… (the tray icon). The three dots open the less used actions (those marked `more`).
import { useEffect, useMemo } from 'react'
import { Alert, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native'
import { menu } from './Menu'
import { kindOf } from '@hissypad/core'
import {
  actionFace, cmdSetKind, cmdTogglePin, countOf, lineAbilities, lineActions, lineCount, refreshClipboard, useClipboard, usePad,
  LINE_ACTIONS, LINE_KINDS, type LineActionGroup, type LineIcon as LineIconId,
} from '@hissypad/state'
import { cmdPickCategory, cmdPickSlot } from '@hissypad/state/hours'
import { serif, type Theme } from '../theme'
import { LineIcon } from './LineIcons'


function Btn({ label, icon, onPress, disabled, a11y, theme, on, style }: { label: string; icon?: LineIconId | undefined; onPress: () => void; disabled?: boolean; a11y?: string; theme: Theme; on?: boolean; style?: object | undefined }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={on === undefined ? undefined : { selected: on }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.btn, style, (pressed || on) && { backgroundColor: theme.accentSoft }]}>
      {icon ? (
        <View style={{ opacity: disabled ? 0.5 : 1 }}><LineIcon icon={icon} color={disabled ? theme.inkMute : theme.ink} ground={theme.paperRaised} /></View>
      ) : (
        <Text style={[s.btnText, { color: disabled ? theme.inkMute : theme.ink, opacity: disabled ? 0.5 : 1 }]}>{label}</Text>
      )}
    </Pressable>
  )
}

export function Toolbar({ theme }: { theme: Theme }) {
  const selection = usePad((s) => s.selection)
  const editing = usePad((s) => s.editing)
  const rows = usePad((s) => s.rows)
  const ids = selection.length > 0 ? selection : editing ? [editing.id] : []
  const clip = useClipboard((s) => s.hasText)
  const can = useMemo(() => lineAbilities(rows, ids, undefined, undefined, clip), [rows, ids, clip])
  const showing = ids.length > 0
  useEffect(() => { if (showing) void refreshClipboard() }, [showing])
  if (!showing) return null
  // Done, Hour…, Category… and Move to… float above the bar (FloatingButtons.tsx).
  const offered = lineActions(can)
  const shown = offered.filter((a) => !a.floats && !a.more)
  const tucked = offered.filter((a) => a.more && (a.enabled ? a.enabled(can) : true))

  // What an action says back (Paste could not read the clipboard) is shown as an alert.
  function run(a: (typeof LINE_ACTIONS)[number]) {
    const said = a.run()
    if (said instanceof Promise) void said.then((line) => { if (line) Alert.alert(line) })
  }
  // The less used actions.
  function more() {
    const held = ids
    menu('More', undefined, [
      // The alert can end the edit before an option is tapped; "Hour…" and "Category…" keep the lines it had.
      ...tucked.map((a) => ({ text: actionFace(a, can).label, onPress: () => void (a.id === 'slot' ? cmdPickSlot(held) : a.id === 'category' ? cmdPickCategory(held) : a.id === 'pin' ? cmdTogglePin(held) : a.run()) })),
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
        <Btn key={k.kind} theme={theme} label={k.glyph} a11y={k.name} on={current === k.kind} onPress={() => cmdSetKind(k.kind)} style={[s.cell, s.kindBtn, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: theme.rule }]} />
      ))}
    </View>
  )
  const button = (a: (typeof LINE_ACTIONS)[number], style?: object) => {
    const face = actionFace(a, can)
    return <Btn key={a.id} theme={theme} label={face.label} icon={face.icon} a11y={face.name} onPress={() => run(a)} disabled={a.enabled ? !a.enabled(can) : false} style={style} />
  }
  // Two rows, no sideways scrolling, every button the same width with the same gap. The top
  // row is where the line sits and what kind it is: six arrows and four types. The second
  // is a new line beside it, then everything else in registry order, so a new action lands
  // there (and wraps if it ever runs out of room).
  const top = new Set<LineActionGroup>(['move'])
  const rest = shown.filter((a) => !top.has(a.group) && a.group !== 'remove')
  const last = shown.filter((a) => a.group === 'remove')
  return (
    <View style={[s.bar, { backgroundColor: theme.paperRaised, borderColor: theme.rule }]} accessibilityRole="toolbar">
      <View style={s.row}>
        {shown.filter((a) => a.group === 'move').map((a) => button(a, s.cell))}
        {kinds}
      </View>
      <View style={[s.row, s.second]}>
        {n > 1 && countOf(selection, rows) > 0 && <Text style={[s.count, { color: theme.inkMute }]}>{lineCount(countOf(selection, rows))}</Text>}
        {rest.map((a) => button(a, s.cell))}
        {tucked.length > 0 && <Btn theme={theme} label="More…" icon="more" a11y="More actions" onPress={more} style={s.cell} />}
        {last.map((a) => button(a, s.cell))}
      </View>
    </View>
  )
}

// On a narrower phone (the app is portrait only) the buttons are a little tighter.
const NARROW = Dimensions.get('window').width < 380
const GAP = 3

const s = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: GAP },
  second: { flexWrap: 'wrap', rowGap: 0 },
  btn: { minWidth: NARROW ? 32 : 36, minHeight: 40, paddingHorizontal: NARROW ? 4 : 6, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  // Each button an equal share of its row: ten on the first (six arrows and four types),
  // nine on the second.
  cell: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, paddingHorizontal: 0 },
  // The types in one bordered group as wide as that many buttons and the gaps between.
  kind: { flexGrow: LINE_KINDS.length, flexShrink: 1, flexBasis: GAP * (LINE_KINDS.length - 1), flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, overflow: 'hidden' },
  kindBtn: { minHeight: 34, borderRadius: 0 },
  btnText: { fontFamily: serif, fontSize: 16 },
  count: { fontFamily: serif, fontSize: 15, paddingHorizontal: 6 },
})
