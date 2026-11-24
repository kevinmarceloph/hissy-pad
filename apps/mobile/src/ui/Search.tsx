// Search every pad, as a sheet: a field at the top and the lines found under it, grouped
// by pad. A tap goes to the line (its pad opens, folds over it open, the line is selected).
// The matching and the jump are the state package's search.ts, the same as the web panel.
// A text toggle under the field adds the archived lines; going to one opens the Archive at it.
import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cmdOpenHit, search, searchCount, usePad, type SearchHit } from '@hissypad/state'
import { serif, type Theme } from '../theme'

// `onOpen` runs when a line found is gone to: the app comes back to the pad from Hours or Sort.
// `onArchived` is handed an archived line that was picked: the app shows it in the Archive.
export function SearchSheet({ visible, onClose, onOpen, onArchived, theme }: { visible: boolean; onClose: () => void; onOpen?: () => void; onArchived?: (id: string) => void; theme: Theme }) {
  const insets = useSafeAreaInsets()
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const result = useMemo(() => (visible ? search(all, query, padId, undefined, archived) : { groups: [], total: 0 }), [visible, all, query, padId, archived])

  useEffect(() => {
    if (!visible) setQuery('')
  }, [visible])

  const open = (hit: SearchHit) => {
    onClose()
    if (hit.archived) return onArchived?.(hit.id)
    cmdOpenHit(hit.id)
    onOpen?.()
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
        <Pressable
          onPress={() => setArchived(!archived)}
          style={s.toggle}
          hitSlop={{ top: 8, bottom: 8 }}
          accessibilityRole="button"
          accessibilityState={{ selected: archived }}
        >
          <Text style={[s.toggleText, { color: theme.accent }]}>{archived ? 'Leave out archived lines' : 'Search archived lines too'}</Text>
        </Pressable>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
        >
          {result.groups.map((g) => (
            <View key={g.archived ? 'archive' : g.padId ?? 'main'}>
              <Text style={[s.pad, { color: theme.inkMute }]}>{g.name.toUpperCase()}</Text>
              {g.hits.map((h) => (
                <Pressable
                  key={h.id}
                  onPress={() => open(h)}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.hit, { borderTopColor: theme.rule }, pressed && { backgroundColor: theme.accentSoft }]}
                >
                  <Text numberOfLines={2} style={[s.txt, { color: h.done ? theme.inkMute : h.archived ? theme.inkSoft : theme.ink }, h.archived && { fontStyle: 'italic' }, h.done && { textDecorationLine: 'line-through', textDecorationColor: theme.accent }]}>
                    {h.parts.map((p, k) => (p.hit ? <Text key={k} style={{ color: theme.accent, fontWeight: '600' }}>{p.text}</Text> : p.text))}
                  </Text>
                  {(h.isPad || h.path.length > 0) && (
                    <Text numberOfLines={1} style={[s.sub, { color: theme.inkMute }]}>{[h.isPad && 'Pad', ...h.path].filter(Boolean).join(' › ')}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}
          <Text style={[s.note, { color: theme.inkMute }]}>
            {!typed ? `Lines from every pad, crossed-out ones${archived ? ' and archived ones' : ''} too. Tap one to go to it${archived ? ', or to an archived one in the Archive' : ''}.` : result.total === 0 ? 'Nothing found.' : `${searchCount(result)}.`}
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
  toggle: { alignSelf: 'flex-start', paddingHorizontal: 16, minHeight: 32, justifyContent: 'center' },
  toggleText: { fontFamily: serif, fontSize: 15, textDecorationLine: 'underline' },
  pad: { fontFamily: serif, fontSize: 12, letterSpacing: 1, marginTop: 16, marginBottom: 4 },
  hit: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  txt: { fontFamily: serif, fontSize: 17, lineHeight: 24 },
  sub: { fontFamily: serif, fontSize: 13, marginTop: 2 },
  note: { fontFamily: serif, fontStyle: 'italic', fontSize: 14, marginTop: 16 },
})
