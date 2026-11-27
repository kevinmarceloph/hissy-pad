// In Later, the lines that are out on a boomerang are rows of the pad, under Later's own
// lines and in groups by the day they come back (core/boomerang.ts keeps the groups). This
// is the heading drawn before the first row of each group; the first one also carries the
// section's name. The same as the web's (apps/web/src/pad/Boomerangs.tsx).
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { dueLabel, FOREVER, type PadId } from '@hissypad/core'
import { cmdAddAt, openPad, padName, usePad } from '@hissypad/state'
import { dayOf } from '@hissypad/core/hours'
import { hoursIfOpen } from '@hissypad/state/hours'
import { LineIcon } from './LineIcons'
import { GUTTER, LINE, serif, type Theme } from '../theme'

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

// And under each pad's group there: a tap adds a line to that pad, after the group's last
// top-level line, in the category (the store gives it one: unscopeCategory). The same as the web's.
export function CategoryAdd({ afterId, padId, theme }: { afterId: string; padId: PadId; theme: Theme }) {
  const name = usePad((st) => padName(st.all, padId))
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Add a line to ${name} in this category`} onPress={() => cmdAddAt({ parentId: null, afterId })} style={s.add}>
      <Text style={[s.addMark, { color: theme.inkMute }]}>+</Text>
    </Pressable>
  )
}

export function DueHead({ due, first, theme }: { due: string; first: boolean; theme: Theme }) {
  // The day this moment belongs to, by the hour a day starts at in Hours.
  const today = dayOf(new Date(), hoursIfOpen()?.day.getState().start ?? 0)
  // The templates of the recurring items: a section of its own, under every day.
  if (due === FOREVER) {
    return (
      <View style={[s.wrap, s.first, { borderTopColor: theme.rule }]}>
        <View style={s.head}>
          <Text accessibilityRole="header" style={[s.title, { color: theme.inkSoft }]}>↻ Recurring</Text>
        </View>
      </View>
    )
  }
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
  add: { height: LINE + 6, justifyContent: 'center' },
  addMark: { width: GUTTER, textAlign: 'center', fontFamily: serif, fontSize: 17, opacity: 0.6 },
  first: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: serif, fontSize: 17, fontStyle: 'italic' },
  day: { fontFamily: serif, fontSize: 12, letterSpacing: 0.8, marginTop: 14, marginBottom: 2 },
})
