// Search every pad, as a sheet: a field at the top and the lines found under it, grouped
// by pad. A tap goes to the line (its pad opens, folds over it open, the line is selected).
// The matching and the jump are the state package's search.ts, the same as the web panel.
import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cmdOpenHit, search, searchCount, usePad } from '@hissypad/state'
import { serif, type Theme } from '../theme'

export function SearchSheet({ visible, onClose, theme }: { visible: boolean; onClose: () => void; theme: Theme }) {
  const insets = useSafeAreaInsets()
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const [query, setQuery] = useState('')
  const result = useMemo(() => (visible ? search(all, query, padId) : { groups: [], total: 0 }), [visible, all, query, padId])

  useEffect(() => {
    if (!visible) setQuery('')
  }, [visible])

  const open = (id: string) => {
    onClose()
    cmdOpenHit(id)
  }

  const typed = query.trim() !== ''
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.root, { backgroundColor: theme.paper }]}>
        <View style={s.head}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            placeholder="Search every pad"
            placeholderTextColor={theme.inkMute}
            accessibilityLabel="Search every pad"
            style={[s.field, { color: theme.ink, backgroundColor: theme.paperRaised, borderColor: theme.rule }]}
          />
          <Pressable onPress={onClose} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[s.close, { color: theme.inkSoft }]}>Close</Text>
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
        >
          {result.groups.map((g) => (
            <View key={g.padId ?? 'main'}>
              <Text style={[s.pad, { color: theme.inkMute }]}>{g.name.toUpperCase()}</Text>
              {g.hits.map((h) => (
                <Pressable
                  key={h.id}
                  onPress={() => open(h.id)}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.hit, { borderTopColor: theme.rule }, pressed && { backgroundColor: theme.accentSoft }]}
                >
                  <Text numberOfLines={2} style={[s.txt, { color: h.done ? theme.inkMute : theme.ink }, h.done && { textDecorationLine: 'line-through', textDecorationColor: theme.accent }]}>
                    {h.parts.map((p, k) => (p.hit ? <Text key={k} style={{ color: theme.accent, fontWeight: '600' }}>{p.text}</Text> : p.text))}
                  </Text>
                  {(h.isPad || h.path.length > 0) && (
                    <Text numberOfLines={1} style={[s.sub, { color: theme.inkMute }]}>{h.isPad ? 'Pad' : h.path.join(' › ')}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}
          <Text style={[s.note, { color: theme.inkMute }]}>
            {!typed ? 'Lines from every pad, crossed-out ones too. Tap one to go to it.' : result.total === 0 ? 'Nothing found.' : `${searchCount(result)}.`}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  field: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, fontFamily: serif, fontSize: 17 },
  closeBtn: { minHeight: 44, justifyContent: 'center' },
  close: { fontFamily: serif, fontSize: 16 },
  pad: { fontFamily: serif, fontSize: 12, letterSpacing: 1, marginTop: 16, marginBottom: 4 },
  hit: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  txt: { fontFamily: serif, fontSize: 17, lineHeight: 24 },
  sub: { fontFamily: serif, fontSize: 13, marginTop: 2 },
  note: { fontFamily: serif, fontStyle: 'italic', fontSize: 14, marginTop: 16 },
})
