// The pads as a row of chips under the title. Today, Inbox and Later come first, each with
// its icon, and stay put: no rename, move, fold or delete. Tap to open a pad; tap the open
// one (or press and hold any other) to rename, move, fold into another pad or delete it; the chevron beside a
// pad that has sub-pads jumps to one; the + chip makes a new pad. Names come through
// Alert.prompt on iOS; Android has no prompt, so a new pad there is called "New pad" and
// can be renamed from the web.
import { useMemo } from 'react'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { FixedPad, PadId } from '@hissypad/core'
import { cmdDeletePad, cmdMovePad, cmdNewPad, cmdPadToLine, cmdRenamePad, countShown, openPad, openSubPad, padList, padTopLines, placeList, usePad, usePrefs, type PadItem } from '@hissypad/state'
import { serif, type Theme } from '../theme'
import { CalendarIcon, HoursIcon } from './TopIcons'
import { LineIcon } from './LineIcons'

// Today is the day (Hours' clock), Inbox is what is still to sort (Sort's tray), Later is
// the calendar. Drawn at 0.8 of the toolbar size, beside the name.
function FixedIcon({ pad, color, ground }: { pad: FixedPad; color: string; ground: string }) {
  return (
    <View style={s.glyph}>
      {pad === 'Today' ? <HoursIcon color={color} /> : pad === 'Later' ? <CalendarIcon color={color} /> : <LineIcon icon="move" color={color} ground={ground} />}
    </View>
  )
}

function ask(title: string, message: string | undefined, initial: string, onName: (name: string) => void) {
  if (Platform.OS === 'ios') {
    Alert.prompt(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'OK', onPress: (v) => v && v.trim() && onName(v.trim()) }], 'plain-text', initial)
  } else {
    onName(initial || 'New pad')
  }
}

export function PadChips({ theme }: { theme: Theme }) {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const hidden = usePrefs((s) => s.hiddenCounts)
  const shown = (p: PadItem) => countShown(hidden, p.fixed ?? p.id!)
  const pads = useMemo(() => padList(all), [all])

  function manage(id: string, name: string) {
    const lines = padTopLines(all, id)
    const i = pads.findIndex((p) => p.id === id)
    const first = pads.findIndex((p) => !p.fixed && p.id !== null)
    Alert.alert(name, undefined, [
      ...(i > first ? [{ text: '← Move left', onPress: () => void cmdMovePad(id, -1) }] : []),
      ...(i >= 0 && i < pads.length - 1 ? [{ text: 'Move right →', onPress: () => void cmdMovePad(id, 1) }] : []),
      { text: 'Rename…', onPress: () => ask('Rename pad', undefined, name, (n) => cmdRenamePad(id, n)) },
      {
        // The opposite of Make pad: the pad becomes a line at the top of the pad picked.
        text: 'Fold into…',
        onPress: () =>
          Alert.alert(`Fold “${name}” into`, 'It becomes a line there, with its lines under it.', [
            ...placeList(all).filter((p) => p.padId !== id).map((p) => ({ text: p.label, onPress: () => void cmdPadToLine(id, p) })),
            { text: 'Cancel', style: 'cancel' as const },
          ]),
      },
      {
        text: 'Archive pad',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Archive “${name}”?`, lines ? `Its ${lines} top-level ${lines === 1 ? 'line goes' : 'lines go'} too, with everything under them.` : 'It is empty.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Archive', style: 'destructive', onPress: () => cmdDeletePad(id) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  // The chevron beside a pad that has sub-pads (its top-level headers): pick one to jump to.
  function jump(p: PadItem) {
    Alert.alert(p.name, 'Jump to a sub-pad', [
      ...p.subs.map((sp) => ({ text: shown(p) && sp.count > 0 ? `${sp.name}  ${sp.count}` : sp.name, onPress: () => void openSubPad(sp.id) })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  function tap(id: PadId, name: string, fixed: boolean) {
    if (id === padId) {
      if (id !== null && !fixed) manage(id, name)
      return
    }
    openPad(id)
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.strip} contentContainerStyle={s.inner}>
      {pads.map((p, i) => {
        const on = p.id === padId
        const after = i > 0 && pads[i - 1]!.fixed !== null && p.fixed === null
        return (
          <View key={p.id ?? 'main'} style={[s.tab, after && { marginLeft: 10 }]}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.name}
              onPress={() => tap(p.id, p.name, p.fixed !== null)}
              onLongPress={() => p.id !== null && !p.fixed && manage(p.id, p.name)}
              style={[s.chip, p.fixed && s.fixedChip, { borderBottomColor: on ? theme.accent : 'transparent' }]}
            >
              {p.fixed && <FixedIcon pad={p.fixed} color={on ? theme.ink : theme.inkSoft} ground={theme.paper} />}
              <Text style={[s.chipText, { color: on ? theme.ink : theme.inkSoft }]} numberOfLines={1}>
                {p.name}
                {shown(p) && p.count > 0 && <Text style={[s.chipCount, { color: theme.inkMute }]}>{'  '}{p.count}</Text>}
              </Text>
            </Pressable>
            {p.subs.length > 0 && (
              <Pressable accessibilityRole="button" accessibilityLabel={`Sub-pads of ${p.name}`} onPress={() => jump(p)} hitSlop={{ top: 4, bottom: 4, right: 6 }} style={s.subs}>
                <View style={[s.chevron, { borderColor: theme.inkMute }]} />
              </Pressable>
            )}
          </View>
        )
      })}
      <Pressable accessibilityRole="button" accessibilityLabel="New pad" onPress={() => ask('New pad', 'A name for it', '', (n) => cmdNewPad(n))} style={[s.chip, { borderBottomColor: 'transparent' }]}>
        <Text style={[s.chipText, { color: theme.inkMute, fontSize: 19 }]}>+</Text>
      </Pressable>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  strip: { flexGrow: 0 },
  inner: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, gap: 2 },
  chip: { minHeight: 36, paddingHorizontal: 10, justifyContent: 'center', borderBottomWidth: 2, maxWidth: 180 },
  tab: { flexDirection: 'row', alignItems: 'stretch' },
  fixedChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  glyph: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', transform: [{ scale: 0.8 }] },
  subs: { minHeight: 36, width: 26, marginLeft: -6, alignItems: 'center', justifyContent: 'center' },
  chevron: { width: 7, height: 7, borderRightWidth: 1.5, borderBottomWidth: 1.5, transform: [{ rotate: '45deg' }], marginTop: -4 },
  chipText: { fontFamily: serif, fontSize: 15 },
  chipCount: { fontFamily: serif, fontSize: 12, fontVariant: ['tabular-nums'] },
})
