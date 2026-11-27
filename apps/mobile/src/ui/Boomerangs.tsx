// In Later, the lines that are out on a boomerang are rows of the pad, under Later's own
// lines and in groups by the day they come back (core/boomerang.ts keeps the groups). This
// is the heading drawn before the first row of each group; the first one also carries the
// section's name. The same as the web's (apps/web/src/pad/Boomerangs.tsx).
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { dueLabel, type PadId } from '@hissypad/core'
import { openPad, padName, usePad } from '@hissypad/state'
import { dayOf } from '@hissypad/core/hours'
import { hoursIfOpen } from '@hissypad/state/hours'
import { LineIcon } from './LineIcons'
import { GUTTER, serif, type Theme } from '../theme'

// Today's second section: the lines with an hour, kept in the order of their hours
// (core/schedule.ts). Drawn before the first of them.
export function ScheduledHead({ theme }: { theme: Theme }) {
  return (
    <View style={[s.wrap, s.first, { borderTopColor: theme.rule }]}>
      <View style={s.head}>
        <LineIcon icon="hour" color={theme.inkSoft} ground={theme.paper} />
        <Text accessibilityRole="header" style={[s.title, { color: theme.inkSoft }]}>Scheduled</Text>
      </View>
    </View>
  )
}

// In a category's view: the pad a group of lines is from, before the first of them. A
// press opens that pad. The same as the web's.
export function CategoryHead({ padId, theme }: { padId: PadId; theme: Theme }) {
  const name = usePad((st) => padName(st.all, padId))
  return (
    <Pressable accessibilityRole="header" accessibilityLabel={name} accessibilityHint="Opens this pad" onPress={() => openPad(padId)} hitSlop={{ top: 6, bottom: 6 }} style={s.wrap}>
      <Text style={[s.day, { color: theme.inkMute }]}>{name.toUpperCase()}</Text>
    </Pressable>
  )
}

export function DueHead({ due, first, theme }: { due: string; first: boolean; theme: Theme }) {
  // The day this moment belongs to, by the hour a day starts at in Hours.
  const today = dayOf(new Date(), hoursIfOpen()?.day.getState().start ?? 0)
  return (
    <View style={[s.wrap, first && s.first, first && { borderTopColor: theme.rule }]}>
      {first && (
        <View style={s.head}>
          <LineIcon icon="boomerang" color={theme.inkSoft} ground={theme.paper} />
          <Text accessibilityRole="header" style={[s.title, { color: theme.inkSoft }]}>Boomerang</Text>
        </View>
      )}
      <Text accessibilityRole="header" style={[s.day, { color: theme.inkMute }]}>{(due <= today ? 'Due back' : dueLabel(due, today)).toUpperCase()}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { marginLeft: GUTTER, marginRight: 12 },
  first: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: serif, fontSize: 17, fontStyle: 'italic' },
  day: { fontFamily: serif, fontSize: 12, letterSpacing: 0.8, marginTop: 14, marginBottom: 2 },
})
