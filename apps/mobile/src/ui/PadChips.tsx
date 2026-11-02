// The pads as a row of chips under the title. Tap to open one; tap the open one (or press
// and hold any) to rename or delete it; the + chip makes a new pad. Names come through
// Alert.prompt on iOS; Android has no prompt, so a new pad there is called "New pad" and
// can be renamed from the web.
import { useMemo } from 'react'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import type { PadId } from '@hissypad/core'
import { cmdDeletePad, cmdNewPad, cmdRenamePad, openPad, padList, usePad } from '@hissypad/state'
import { serif, type Theme } from '../theme'

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
  const pads = useMemo(() => padList(all), [all])

  function manage(id: string, name: string) {
    const lines = Object.values(all).filter((r) => r.deletedAt === null && r.parentId === id).length
    Alert.alert(name, undefined, [
      { text: 'Rename…', onPress: () => ask('Rename pad', undefined, name, (n) => cmdRenamePad(id, n)) },
      {
        text: 'Delete pad',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Delete “${name}”?`, lines ? `Its ${lines} top-level ${lines === 1 ? 'line goes' : 'lines go'} too, with everything under them.` : 'It is empty.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => cmdDeletePad(id) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function tap(id: PadId, name: string) {
    if (id === padId) {
      if (id !== null) manage(id, name)
      return
    }
    openPad(id)
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.strip} contentContainerStyle={s.inner}>
      {pads.map((p) => {
        const on = p.id === padId
        return (
          <Pressable
            key={p.id ?? 'main'}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => tap(p.id, p.name)}
            onLongPress={() => p.id !== null && manage(p.id, p.name)}
            style={[s.chip, { borderBottomColor: on ? theme.accent : 'transparent' }]}
          >
            <Text style={[s.chipText, { color: on ? theme.ink : theme.inkSoft }]} numberOfLines={1}>{p.name}</Text>
          </Pressable>
        )
      })}
      <Pressable accessibilityRole="button" accessibilityLabel="New pad" onPress={() => ask('New pad', 'A name for it', '', (n) => cmdNewPad(n))} style={s.chip}>
        <Text style={[s.chipText, { color: theme.inkMute, fontSize: 19 }]}>+</Text>
      </Pressable>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  strip: { flexGrow: 0 },
  inner: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, gap: 2 },
  chip: { minHeight: 36, paddingHorizontal: 10, justifyContent: 'center', borderBottomWidth: 2, maxWidth: 180 },
  chipText: { fontFamily: serif, fontSize: 15 },
})
