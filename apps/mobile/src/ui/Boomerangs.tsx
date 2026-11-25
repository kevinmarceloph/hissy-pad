// In Later, the lines that are out on a boomerang are rows of the pad, under Later's own
// lines and in groups by the day they come back (core/boomerang.ts keeps the groups). This
// is the heading drawn before the first row of each group; the first one also carries the
// section's name. The same as the web's (apps/web/src/pad/Boomerangs.tsx).
import { StyleSheet, Text, View } from 'react-native'
import { dueLabel } from '@hissypad/core'
import { dayOf } from '@hissypad/core/hours'
import { hoursIfOpen } from '@hissypad/state/hours'
import { LineIcon } from './LineIcons'
import { GUTTER, serif, type Theme } from '../theme'

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
