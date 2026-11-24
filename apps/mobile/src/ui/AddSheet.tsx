// The widget's + (hissypad://add?pad=…) asks for a line here. It used to be Alert.prompt,
// but React Native never sets autocapitalization on that alert's field and iOS leaves it
// at none, so every line started lowercase. A TextInput of our own capitalizes sentences.
// widget.ts calls openAddSheet from outside React; the sheet is mounted once in App.tsx.
import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { cmdAddToPad } from '@hissypad/state'
import { serif, type Theme } from '../theme'

type Ask = { pad: string; name: string }
let current: Ask | null = null
const listeners = new Set<(a: Ask | null) => void>()

function set(a: Ask | null) {
  current = a
  listeners.forEach((l) => l(a))
}

export function openAddSheet(pad: string, name: string) {
  set({ pad, name })
}

export function AddSheet({ theme }: { theme: Theme }) {
  const [ask, setAsk] = useState<Ask | null>(current)
  const [text, setText] = useState('')
  useEffect(() => {
    listeners.add(setAsk)
    return () => { listeners.delete(setAsk) }
  }, [])
  useEffect(() => {
    if (!ask) setText('')
  }, [ask])

  const close = () => set(null)
  const add = () => {
    if (ask && text.trim()) cmdAddToPad(ask.pad, text)
    close()
  }
  const can = text.trim() !== ''

  return (
    <Modal visible={ask !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[s.root, { backgroundColor: theme.paper }]}>
        <View style={s.head}>
          <Pressable onPress={close} style={s.btn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={[s.btnText, { color: theme.inkSoft }]}>Cancel</Text>
          </Pressable>
          <Text numberOfLines={1} style={[s.title, { color: theme.ink }]}>Add to {ask?.name ?? ''}</Text>
          <Pressable onPress={add} disabled={!can} style={s.btn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Add" accessibilityState={{ disabled: !can }}>
            <Text style={[s.btnText, s.addText, { color: can ? theme.accent : theme.inkMute }]}>Add</Text>
          </Pressable>
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          autoCapitalize="sentences"
          returnKeyType="done"
          enablesReturnKeyAutomatically
          submitBehavior="submit"
          onSubmitEditing={add}
          placeholder="A new line"
          placeholderTextColor={theme.inkMute}
          accessibilityLabel={`Add to ${ask?.name ?? ''}`}
          style={[s.field, { color: theme.ink, backgroundColor: theme.paperRaised, borderColor: theme.rule }]}
        />
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: 12, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 12 },
  title: { flex: 1, textAlign: 'center', fontFamily: serif, fontSize: 17, fontWeight: '600' },
  btn: { minHeight: 44, minWidth: 56, justifyContent: 'center' },
  btnText: { fontFamily: serif, fontSize: 16 },
  addText: { textAlign: 'right', fontWeight: '600' },
  field: { minHeight: 44, paddingHorizontal: 12, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, fontFamily: serif, fontSize: 17 },
})
