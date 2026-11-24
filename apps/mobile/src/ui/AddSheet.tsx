// The widget's + (hissypad://add?pad=…) asks for a line here. It used to be Alert.prompt,
// but React Native never sets autocapitalization on that alert's field and iOS leaves it
// at none, so every line started lowercase. A TextInput of our own capitalizes sentences.
// widget.ts calls openAddSheet from outside React; the sheet is mounted once in App.tsx.
// A + tapped from the home screen arrives while the app is still coming to the front,
// where autoFocus inside a modal fires before the sheet is up: the keyboard showed with
// no field behind it and the typing went nowhere. So the sheet opens once the app is
// active, each ask gets a modal of its own, and the field is focused in onShow.
import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { AppState, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { cmdAddToPad } from '@hissypad/state'
import { serif, type Theme } from '../theme'

type Ask = { pad: string; name: string; seq: number }
let seq = 0
let current: Ask | null = null
const listeners = new Set<(a: Ask | null) => void>()

function set(a: Ask | null) {
  current = a
  listeners.forEach((l) => l(a))
}

export function openAddSheet(pad: string, name: string) {
  const ask = { pad, name, seq: ++seq }
  if (AppState.currentState === 'active') return set(ask)
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return
    sub.remove()
    if (ask.seq === seq) set(ask)
  })
}

export function AddSheet({ theme }: { theme: Theme }) {
  const [ask, setAsk] = useState<Ask | null>(current)
  const [text, setText] = useState('')
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  useEffect(() => {
    listeners.add(setAsk)
    return () => { listeners.delete(setAsk) }
  }, [])
  useEffect(() => {
    if (!ask) setText('')
  }, [ask])

  const close = () => set(null)
  // Return passes the field's own text: the last keystrokes (or the word autocorrect
  // fixes on return) can reach the field a moment before they reach `text`.
  const add = (value = text) => {
    if (ask && value.trim()) cmdAddToPad(ask.pad, value)
    close()
  }
  const can = text.trim() !== ''

  if (!ask) return null
  return (
    <Modal key={ask.seq} visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close} onShow={() => input.current?.focus()}>
      <View style={[s.root, { backgroundColor: theme.paper }]}>
        <View style={s.head}>
          <Pressable onPress={close} style={s.btn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={[s.btnText, { color: theme.inkSoft }]}>Cancel</Text>
          </Pressable>
          <Text numberOfLines={1} style={[s.title, { color: theme.ink }]}>Add to {ask.name}</Text>
          <Pressable onPress={() => add()} disabled={!can} style={s.btn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Add" accessibilityState={{ disabled: !can }}>
            <Text style={[s.btnText, s.addText, { color: can ? theme.accent : theme.inkMute }]}>Add</Text>
          </Pressable>
        </View>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          autoCapitalize="sentences"
          returnKeyType="done"
          enablesReturnKeyAutomatically
          submitBehavior="submit"
          onSubmitEditing={(e) => add(e.nativeEvent.text)}
          placeholder="A new line"
          placeholderTextColor={theme.inkMute}
          accessibilityLabel={`Add to ${ask.name}`}
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
