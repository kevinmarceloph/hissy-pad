// The round buttons floating at the bottom right of the pad, above the toolbar and the
// keyboard. While editing, Hour…, Category… and Boomerang… (LINE_ACTIONS marked `floats`) and Move to… come first
// (five round buttons and the switch fit a 375pt phone with a gap of 6). With nothing targeted: + adds a line at the top when tapped, or where it is
// dropped when dragged onto the pad (like the + in Things). While a line is being edited
// (or lines are selected): a switch of three sides, each a button that puts it in that state
// (• open, a dot in a ring for doing, × crossed out; the side the line is on is filled), and a
// chevron ends editing and puts the keyboard away (or clears the selection).
import { useMemo } from 'react'
import { Dimensions, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import { menu } from './Menu'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import { sharedState, type LineState } from '@hissypad/core'
import { clearSelection, cmdAddAtTop, cmdMoveTo, cmdSetState, placeList, stopEditing, usePad, LINE_ACTIONS } from '@hissypad/state'
import { LineIcon } from './LineIcons'
import { serif, type Theme } from '../theme'

function Round({ label, onPress, theme, children, accent }: { label: string; onPress: () => void; theme: Theme; children: React.ReactNode; accent?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [s.round, { backgroundColor: pressed ? theme.accentSoft : theme.paperRaised, borderColor: accent ? theme.accent : theme.rule }]}
    >
      {children}
    </Pressable>
  )
}

export interface AddDrag {
  begin: (x: number, y: number) => void // screen coordinates
  move: (x: number, y: number) => void
  end: (commit: boolean) => void
}

export function FloatingButtons({ theme, onAdd, addDrag, dragging }: { theme: Theme; onAdd?: () => void; addDrag?: AddDrag; dragging?: boolean }) {
  const editing = usePad((s) => s.editing)
  const selection = usePad((s) => s.selection)
  const rows = usePad((s) => s.rows)
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const inHour = usePad((s) => s.slotId !== null)
  // Everywhere the lines can go: the other pads, and every sub-pad (this pad's included).
  // In an open hour, every pad: its lines come from any of them.
  const places = useMemo(() => placeList(all).filter((p) => inHour || p.subId !== null || p.padId !== padId), [all, padId, inHour])
  const targets = selection.length > 0 ? selection : editing ? [editing.id] : []

  const addAtTop = () => {
    void Haptics.selectionAsync().catch(() => {})
    cmdAddAtTop()
    onAdd?.()
  }
  // A tap adds at the top; a drag carries the + to the spot where the line should go.
  const plus = useMemo(() => {
    const tap = Gesture.Tap().runOnJS(true).onEnd((_e, ok) => {
      if (ok) addAtTop()
    })
    const pan = Gesture.Pan()
      .minDistance(8)
      .runOnJS(true)
      .onStart((e) => addDrag?.begin(e.absoluteX, e.absoluteY))
      .onUpdate((e) => addDrag?.move(e.absoluteX, e.absoluteY))
      .onEnd(() => addDrag?.end(true))
      .onFinalize((_e, ok) => {
        if (!ok) addDrag?.end(false)
      })
    return Gesture.Race(pan, tap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addDrag])

  if (targets.length === 0) {
    return (
      <View style={s.wrap} pointerEvents="box-none">
        <GestureDetector gesture={plus}>
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel="Add a line at the top"
            accessibilityHint="Drag it onto the pad to add the line there"
            onAccessibilityTap={addAtTop}
            style={[s.round, { backgroundColor: theme.paperRaised, borderColor: theme.accent, opacity: dragging ? 0.35 : 1 }]}
          >
            <Text style={[s.glyph, s.plus, { color: theme.accent }]}>+</Text>
          </View>
        </GestureDetector>
      </View>
    )
  }

  const state = sharedState(rows, targets)
  // The pads and sub-pads to move to (iOS stacks them).
  const moveTo = () => {
    void Haptics.selectionAsync().catch(() => {})
    menu('Move to', undefined, [
      ...places.map((p) => ({ text: p.label, onPress: () => void cmdMoveTo(p) })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }
  const finish = () => {
    if (selection.length > 0) clearSelection()
    stopEditing()
    Keyboard.dismiss()
  }
  return (
    <View style={s.wrap} pointerEvents="box-none">
      {/* Hour…, Category… and Boomerang…: the actions marked `floats` that have an icon. */}
      {FLOATING.map((a) => (
        <Round key={a.id} theme={theme} label={a.name} onPress={() => {
          void Haptics.selectionAsync().catch(() => {})
          void a.run()
        }}>
          <LineIcon icon={a.icon!} color={theme.ink} ground={theme.paperRaised} />
        </Round>
      ))}
      {places.length > 0 && (
        <Round theme={theme} label="Move to another pad or a sub-pad" onPress={moveTo}>
          <LineIcon icon="move" color={theme.ink} ground={theme.paperRaised} />
        </Round>
      )}
      {/* Three sides, each its own button: • (open), a dot in a ring (doing), × (crossed
          out). The side the lines are on is filled; none for a mixed set. */}
      <View accessibilityRole="radiogroup" accessibilityLabel="Line state" style={[s.round, s.switch, { backgroundColor: theme.paperRaised, borderColor: theme.rule }]}>
        {SIDES.map((side) => {
          const on = side === state
          const ink = on ? (side === 'done' ? theme.accent : theme.ink) : theme.inkMute
          return (
            <Pressable
              key={side}
              accessibilityRole="radio"
              accessibilityLabel={STATE_NAME[side]}
              accessibilityState={{ checked: on }}
              hitSlop={{ top: 6, bottom: 6 }}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => {})
                cmdSetState(side)
              }}
              style={({ pressed }) => [s.side, on && { backgroundColor: theme.accentSoft, borderColor: theme.accent }, pressed && !on && { backgroundColor: theme.accentFaint }]}
            >
              {side === 'open' ? (
                <Text style={[s.glyph, s.mark, { color: ink }]}>•</Text>
              ) : side === 'doing' ? (
                <View style={[s.ring, { borderColor: ink }]}><View style={[s.dot, { backgroundColor: ink }]} /></View>
              ) : (
                <Text style={[s.glyph, s.mark, { color: ink }]}>×</Text>
              )}
            </Pressable>
          )
        })}
      </View>
      <Round theme={theme} label={selection.length > 0 ? 'Clear selection' : 'Done editing'} onPress={finish}>
        {/* A chevron pointing down, drawn so it does not depend on a font having the glyph. */}
        <View style={[s.chevron, { borderColor: theme.ink }]} />
      </Round>
    </View>
  )
}

const FLOATING = LINE_ACTIONS.filter((a) => a.floats && a.icon)
const SIDES: LineState[] = ['open', 'doing', 'done']
const STATE_NAME: Record<LineState, string> = { open: 'Open', doing: 'Doing', done: 'Done' }

// The row at its widest (four buttons, the switch, the chevron) is 366pt with its margin:
// on a phone narrower than that (the app is portrait only) it sits closer together.
const NARROW = Dimensions.get('window').width < 380

const s = StyleSheet.create({
  wrap: { position: 'absolute', bottom: 12, right: NARROW ? 8 : 12, zIndex: 5, flexDirection: 'row', gap: NARROW ? 4 : 6 },
  round: {
    width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth * 2, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  glyph: { fontFamily: serif, fontSize: 21, lineHeight: 26 },
  mark: { fontSize: 24, lineHeight: 26 },
  switch: { width: 104, flexDirection: 'row', padding: 3, gap: 2 },
  ring: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  side: { flex: 1, alignSelf: 'stretch', borderRadius: 19, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 28, lineHeight: 30 },
  chevron: { width: 11, height: 11, borderRightWidth: 2, borderBottomWidth: 2, transform: [{ rotate: '45deg' }], marginTop: -5 },
})
