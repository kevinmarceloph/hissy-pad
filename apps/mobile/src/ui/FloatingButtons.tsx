// The round buttons floating at the bottom right of the pad, above the toolbar and the
// keyboard. With nothing targeted: + adds a line at the top. While a line is being edited
// (or lines are selected): a left/right switch crosses it out (• on the left for open, ×
// on the right for crossed out; the side the line is on is filled), and a chevron ends editing and puts the keyboard away (or clears the selection).
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { clearSelection, cmdAddAtTop, cmdToggleDone, stopEditing, usePad } from '@hissypad/state'
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

export function FloatingButtons({ theme, onAdd }: { theme: Theme; onAdd?: () => void }) {
  const editing = usePad((s) => s.editing)
  const selection = usePad((s) => s.selection)
  const rows = usePad((s) => s.rows)
  const targets = selection.length > 0 ? selection : editing ? [editing.id] : []

  if (targets.length === 0) {
    return (
      <View style={s.wrap} pointerEvents="box-none">
        <Round
          theme={theme}
          label="Add a line at the top"
          accent
          onPress={() => {
            void Haptics.selectionAsync().catch(() => {})
            cmdAddAtTop()
            onAdd?.()
          }}
        >
          <Text style={[s.glyph, s.plus, { color: theme.accent }]}>+</Text>
        </Round>
      </View>
    )
  }

  const allDone = targets.every((id) => rows[id]?.done)
  const finish = () => {
    if (selection.length > 0) clearSelection()
    stopEditing()
    Keyboard.dismiss()
  }
  return (
    <View style={s.wrap} pointerEvents="box-none">
      {/* A switch with two sides: • (open) on the left, × (crossed out) on the right. The
          side the line is on is filled; a tap anywhere on it flips it. */}
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Crossed out"
        accessibilityState={{ checked: allDone }}
        hitSlop={6}
        onPress={() => {
          void Haptics.selectionAsync().catch(() => {})
          cmdToggleDone()
        }}
        style={[s.round, s.switch, { backgroundColor: theme.paperRaised, borderColor: theme.rule }]}
      >
        <View style={[s.side, !allDone && { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}>
          <Text style={[s.glyph, s.mark, { color: allDone ? theme.inkMute : theme.ink }]}>•</Text>
        </View>
        <View style={[s.side, allDone && { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}>
          <Text style={[s.glyph, s.mark, { color: allDone ? theme.accent : theme.inkMute }]}>×</Text>
        </View>
      </Pressable>
      <Round theme={theme} label={selection.length > 0 ? 'Clear selection' : 'Done editing'} onPress={finish}>
        {/* A chevron pointing down, drawn so it does not depend on a font having the glyph. */}
        <View style={[s.chevron, { borderColor: theme.ink }]} />
      </Round>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', bottom: 12, right: 12, zIndex: 5, flexDirection: 'row', gap: 10 },
  round: {
    width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth * 2, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  glyph: { fontFamily: serif, fontSize: 21, lineHeight: 26 },
  mark: { fontSize: 24, lineHeight: 26 },
  switch: { width: 84, flexDirection: 'row', padding: 3, gap: 2 },
  side: { flex: 1, alignSelf: 'stretch', borderRadius: 19, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 28, lineHeight: 30 },
  chevron: { width: 11, height: 11, borderRightWidth: 2, borderBottomWidth: 2, transform: [{ rotate: '45deg' }], marginTop: -5 },
})
