// Under Later's own lines: what is out on a boomerang, grouped by the day it comes back.
// The same list as the web's (apps/web/src/pad/Boomerangs.tsx): the first line of the text,
// how many lines ride under it, and two things to do with it: another day, or back now.
import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { buildIndex, countLines, descendantIds, dueLabel, fixedPadOf } from '@hissypad/core'
import { dayOf } from '@hissypad/core/hours'
import { boomerangList, cmdComeBack, cmdPickBoomerang, usePad } from '@hissypad/state'
import { hoursIfOpen } from '@hissypad/state/hours'
import { LineIcon } from './LineIcons'
import { GUTTER, LINE, serif, type Theme } from '../theme'

export function Boomerangs({ theme, onSaid }: { theme: Theme; onSaid: (said: string) => void }) {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const scoped = usePad((s) => s.zoomId !== null || s.slotId !== null)
  const here = !scoped && fixedPadOf(all, padId) === 'Later'
  const groups = useMemo(() => (here ? boomerangList(all) : []), [here, all])
  const index = useMemo(() => (groups.length ? buildIndex(all) : null), [groups, all])
  if (!index) return null
  // The day this moment belongs to, by the hour a day starts at in Hours.
  const today = dayOf(new Date(), hoursIfOpen()?.day.getState().start ?? 0)
  return (
    <View accessibilityLabel="Out on a boomerang" style={[s.wrap, { borderTopColor: theme.rule }]}>
      <View style={s.head}>
        <LineIcon icon="boomerang" color={theme.inkSoft} ground={theme.paper} />
        <Text accessibilityRole="header" style={[s.title, { color: theme.inkSoft }]}>Boomerang</Text>
      </View>
      {groups.map((g) => (
        <View key={g.due}>
          <Text accessibilityRole="header" style={[s.day, { color: theme.inkMute }]}>{(g.due <= today ? 'Due back' : dueLabel(g.due, today)).toUpperCase()}</Text>
          {g.lines.map((r) => {
            const under = countLines(descendantIds(index, r.id).map((id) => all[id]))
            const text = r.text.split('\n')[0] || 'Blank line'
            return (
              <View key={r.id} style={s.line}>
                <Text numberOfLines={1} style={[s.text, { color: r.done ? theme.inkMute : theme.ink }, r.done && { textDecorationLine: 'line-through' }]}>
                  {text}{under > 0 ? <Text style={{ color: theme.inkMute }}>{`  +${under}`}</Text> : null}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Another day for ${text}`} hitSlop={6} onPress={() => cmdPickBoomerang([r.id])} style={[s.button, { borderColor: theme.rule }]}>
                  <Text style={[s.buttonText, { color: theme.inkSoft }]}>Day…</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Bring ${text} back to the Inbox now`}
                  hitSlop={6}
                  onPress={() => {
                    if (cmdComeBack([r.id])) onSaid('Back in the Inbox.')
                  }}
                  style={[s.button, { borderColor: theme.rule }]}
                >
                  <Text style={[s.buttonText, { color: theme.inkSoft }]}>Back now</Text>
                </Pressable>
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { marginLeft: GUTTER, marginRight: 12, marginBottom: 24, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: serif, fontSize: 17, fontStyle: 'italic' },
  day: { fontFamily: serif, fontSize: 12, letterSpacing: 0.8, marginTop: 14, marginBottom: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: LINE + 10 },
  text: { flex: 1, fontFamily: serif, fontSize: 17, lineHeight: LINE },
  button: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 9, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 4 },
  buttonText: { fontFamily: serif, fontSize: 13 },
})
