// Search every pad, as a sheet: a field at the top and the lines found under it, grouped
// by pad. A tap goes to the line (its pad opens, folds over it open, the line is selected).
// The matching and the jump are the state package's search.ts, the same as the web panel.
// A text toggle under the field adds the archived lines; going to one opens the Archive at it.
import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { parseSlot, slotLabel, todayKey } from '@hissypad/core'
import { cmdOpenHit, hitKids, hitNote, search, searchCount, usePad, type SearchHit } from '@hissypad/state'
import { cmdSlotPut, inSlot, useLineCategory } from '@hissypad/state/hours'
import { CategoryBadge, HitMark } from '@hissypad/ui'
import { serif, type Theme, SHEET_TOP } from '../theme'

// `onOpen` runs when a line found is gone to: the app comes back to the pad from Hours or Sort.
// `onArchived` is handed an archived line that was picked: the app shows it in the Archive.
// `assign` is an hour (a slot key) the search was opened for, from that hour in Hours: the
// line picked is put in the hour instead of gone to. Pads, archived lines and the lines
// already in the hour are left out then.
export function SearchSheet({ visible, onClose, onOpen, onArchived, assign = null, theme }: { visible: boolean; onClose: () => void; onOpen?: () => void; onArchived?: (id: string) => void; assign?: string | null; theme: Theme }) {
  const insets = useSafeAreaInsets()
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const hour = assign === null ? null : parseSlot(assign)
  const what = hour && assign ? `Find a line for ${slotLabel(assign, todayKey())}` : 'Search every pad'
  const result = useMemo(() => {
    if (!visible) return { groups: [], total: 0 }
    const found = search(all, query, padId, undefined, archived && assign === null)
    if (assign === null) return found
    const groups = found.groups.map((g) => ({ ...g, hits: g.hits.filter((h) => !h.isPad && !h.archived && !inSlot(h.id, assign)) })).filter((g) => g.hits.length > 0)
    return { groups, total: groups.reduce((n, g) => n + g.hits.length, 0) }
  }, [visible, all, query, padId, archived, assign])

  useEffect(() => {
    if (!visible) setQuery('')
  }, [visible])

  const open = (hit: SearchHit) => {
    onClose()
    if (hour) return cmdSlotPut(hit.id, hour.day, hour.hour)
    if (hit.archived) return onArchived?.(hit.id)
    cmdOpenHit(hit.id)
    onOpen?.()
  }

  const typed = query.trim() !== ''
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {SHEET_TOP > 0 && <View style={{ height: SHEET_TOP, backgroundColor: theme.paper }} />}
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
            placeholder={what}
            placeholderTextColor={theme.inkMute}
            accessibilityLabel={what}
            style={[s.field, { color: theme.ink, backgroundColor: theme.paperRaised, borderColor: theme.rule }]}
          />
          <Pressable onPress={onClose} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[s.close, { color: theme.inkSoft }]}>Close</Text>
          </Pressable>
        </View>
        {!hour && <Pressable
          onPress={() => setArchived(!archived)}
          style={s.toggle}
          hitSlop={{ top: 8, bottom: 8 }}
          accessibilityRole="button"
          accessibilityState={{ selected: archived }}
        >
          <Text style={[s.toggleText, { color: theme.accent }]}>{archived ? 'Leave out archived lines' : 'Search archived lines too'}</Text>
        </Pressable>}
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
                  <View style={s.line}>
                    <View style={s.mark}>
                      <HitMark hit={h} color={theme.inkSoft} doneColor={theme.inkMute} accent={theme.accent} />
                    </View>
                    <HitCategory id={h.category} />
                    <Text numberOfLines={2} style={[s.txt, s.grow, h.kind === 'header' && !h.isPad && { fontWeight: '700' },{ color: h.done ? theme.inkMute : h.archived ? theme.inkSoft : theme.ink }, h.archived && { fontStyle: 'italic' }, h.done && { textDecorationLine: 'line-through', textDecorationColor: theme.accent }]}>
                    {h.parts.map((p, k) => (p.hit ? <Text key={k} style={{ color: theme.accent, fontWeight: '600' }}>{p.text}</Text> : p.text))}
                  </Text>
                    {hitKids(h) !== '' && <Text style={[s.kids, { color: theme.inkSoft }]}>{hitKids(h)}</Text>}
                  </View>
                  {hitNote(h) !== '' && (
                    <Text numberOfLines={1} style={[s.sub, { color: theme.inkMute }]}>{hitNote(h)}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}
          <Text style={[s.note, { color: theme.inkMute }]}>
            {hour ? (!typed ? 'Lines from every pad. Tap one to put it in this hour, where it is in its pad.' : result.total === 0 ? 'Nothing found.' : `${searchCount(result)}.`) : !typed ? `Lines from every pad, crossed-out ones${archived ? ' and archived ones' : ''} too. Tap one to go to it${archived ? ', or to an archived one in the Archive' : ''}.` : result.total === 0 ? 'Nothing found.' : `${searchCount(result)}.`}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  )
}

// A hit's category, as the pad's rows draw one: nothing for a line with none.
function HitCategory({ id }: { id: string | null }) {
  const category = useLineCategory(id)
  return category ? <CategoryBadge category={category} size={20} /> : null
}

const s = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  grow: { flex: 1 },
  kids: { fontFamily: serif, fontSize: 14, lineHeight: 24, fontVariant: ['tabular-nums'] },
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
  // Under the text, past the bullet (24 wide, then the line's gap of 8).
  sub: { fontFamily: serif, fontSize: 13, marginTop: 2, paddingLeft: 32 },
  // The bullet's box is 20 tall, centered on the first line of 24.
  mark: { paddingTop: 2 },
  note: { fontFamily: serif, fontStyle: 'italic', fontSize: 14, marginTop: 16 },
})
