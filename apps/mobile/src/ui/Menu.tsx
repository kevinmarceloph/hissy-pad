// A list of choices, and a one-line question. On iOS these are the system's own
// (Alert.alert, Alert.prompt), as before. Android's alert shows three buttons at most and
// has no prompt, so there they are a sheet of our own, drawn by <MenuHost /> at the root.
// `menu` takes what Alert.alert takes, so a call site reads the same on both.
import { useEffect, useState } from 'react'
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type AlertButton } from 'react-native'
import { create } from 'zustand'
import { SIZE, serif, useTheme } from '../theme'

type Ask = { initial: string; onText: (text: string) => void }
type Request = { title: string; message: string | undefined; buttons: AlertButton[]; ask?: Ask }

const useMenu = create<{ request: Request | null }>(() => ({ request: null }))

export function menu(title: string, message?: string, buttons: AlertButton[] = []) {
  if (Platform.OS === 'ios') Alert.alert(title, message, buttons)
  else useMenu.setState({ request: { title, message, buttons } })
}

// Asks for a line of text; `onText` gets it trimmed, and only when it is not empty.
export function askText(title: string, message: string | undefined, initial: string, onText: (text: string) => void) {
  const take = (v?: string) => { if (v && v.trim()) onText(v.trim()) }
  if (Platform.OS === 'ios') {
    Alert.prompt(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'OK', onPress: take }], 'plain-text', initial)
  } else {
    useMenu.setState({ request: { title, message, buttons: [], ask: { initial, onText: take } } })
  }
}

export function MenuHost() {
  const theme = useTheme()
  const request = useMenu((s) => s.request)
  const [text, setText] = useState('')
  useEffect(() => { setText(request?.ask?.initial ?? '') }, [request])
  if (Platform.OS === 'ios') return null

  // Closed first, so a choice that opens another menu is not closed by this one.
  const close = (then?: () => void) => {
    useMenu.setState({ request: null })
    then?.()
  }
  const cancel = request?.buttons.find((b) => b.style === 'cancel')
  const choices = request?.buttons.filter((b) => b.style !== 'cancel') ?? []
  const ask = request?.ask
  const foot = [s.foot, { borderColor: theme.rule }]

  return (
    <Modal visible={request !== null} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => close(cancel?.onPress as (() => void) | undefined)}>
      <Pressable accessibilityLabel="Cancel" style={s.dim} onPress={() => close(cancel?.onPress as (() => void) | undefined)}>
        {/* A press on the card is not a press on the dimmed pad behind it. */}
        <Pressable style={[s.card, { backgroundColor: theme.paperRaised, borderColor: theme.rule }]} onPress={() => {}}>
          <Text accessibilityRole="header" style={[s.title, { color: theme.ink }]}>{request?.title}</Text>
          {request?.message ? <Text style={[s.message, { color: theme.inkSoft }]}>{request.message}</Text> : null}
          {ask ? (
            <>
              <TextInput
                autoFocus
                value={text}
                onChangeText={setText}
                selectTextOnFocus
                onSubmitEditing={() => close(() => ask.onText(text))}
                accessibilityLabel={request?.title}
                style={[s.field, { color: theme.ink, borderColor: theme.rule, backgroundColor: theme.paper }]}
              />
              <View style={foot}>
                <Pressable accessibilityRole="button" style={s.half} onPress={() => close()}><Text style={[s.choice, { color: theme.inkSoft }]}>Cancel</Text></Pressable>
                <Pressable accessibilityRole="button" style={s.half} onPress={() => close(() => ask.onText(text))}><Text style={[s.choice, s.strong, { color: theme.ink }]}>OK</Text></Pressable>
              </View>
            </>
          ) : (
            <>
              <ScrollView style={s.list} keyboardShouldPersistTaps="handled">
                {choices.map((b, n) => (
                  <Pressable
                    key={n}
                    accessibilityRole="button"
                    android_ripple={{ color: theme.rule }}
                    style={[s.row, { borderColor: theme.rule }]}
                    onPress={() => close(b.onPress as (() => void) | undefined)}
                  >
                    <Text style={[s.choice, { color: b.style === 'destructive' ? theme.accent : theme.ink }, b.style === 'destructive' && s.strong]}>{b.text}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={foot}>
                <Pressable accessibilityRole="button" style={s.half} onPress={() => close(cancel?.onPress as (() => void) | undefined)}>
                  <Text style={[s.choice, { color: theme.inkSoft }]}>{cancel?.text ?? (choices.length ? 'Cancel' : 'OK')}</Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 380, maxHeight: '80%', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingTop: 16, overflow: 'hidden' },
  title: { fontFamily: serif, fontSize: SIZE + 1, fontWeight: '700', paddingHorizontal: 20 },
  message: { fontFamily: serif, fontSize: SIZE - 2, lineHeight: 20, paddingHorizontal: 20, paddingTop: 4 },
  list: { marginTop: 10, flexGrow: 0 },
  row: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  choice: { fontFamily: serif, fontSize: SIZE },
  strong: { fontWeight: '700' },
  field: { fontFamily: serif, fontSize: SIZE, marginHorizontal: 20, marginTop: 12, marginBottom: 14, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 6 },
  foot: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  half: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
})
