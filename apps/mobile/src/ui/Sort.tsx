// Sort on the phone: the pad's top-level lines one card at a time, full screen. Swipe the
// card left for Later, right for Today, up for Today and crossed out; the buttons do the
// same. The card's text and sub items are live fields. Same queue, targets and commands as
// the web (state/sort.ts); only the gesture is drawn here, with PanResponder and Animated
// so it ships as a JS-only update.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Animated, Dimensions, Keyboard, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { buildIndex, flatten, isLive, listPads } from '@hissypad/core'
import {
  cmdSortAddSub, cmdSortBack, cmdSortRemoveSub, cmdSortSend, cmdSortSetText, loadSortTargets, padName, setSortTarget, sortQueue, sortTarget,
  swipeDir, SWIPE_DISTANCE, usePad, useSort, type SortDir, type SortResult, type SortSide,
} from '@hissypad/state'
import { INDENT, serif, type Theme } from '../theme'

interface Sent extends SortResult { id: string }

const SLOP = 10 // px before a touch on the card becomes a drag

export function SortSheet({ onClose, theme }: { onClose: () => void; theme: Theme }) {
  const insets = useSafeAreaInsets()
  const rows = usePad((s) => s.rows)
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const choice = useSort()
  const [queue] = useState(() => sortQueue())
  const [pos, setPos] = useState(0)
  const [sent, setSent] = useState<Sent[]>([])
  const [draft, setDraft] = useState('')
  const pan = useRef(new Animated.ValueXY()).current
  const busy = useRef(false)

  useEffect(() => { void loadSortTargets() }, [])

  let at = pos
  while (at < queue.length && !(isLive(rows[queue[at]!]) && rows[queue[at]!]!.parentId === null)) at++
  const id = at < queue.length ? queue[at]! : null
  const row = id ? rows[id]! : null
  const subs = useMemo(() => (id ? flatten(buildIndex(rows), false, id) : []), [rows, id])
  const left = sortTarget(all, 'left', choice.left)
  const right = sortTarget(all, 'right', choice.right)

  function commit(dir: SortDir) {
    if (!id) return
    if (draft.trim()) cmdSortAddSub(id, draft)
    const res = cmdSortSend(id, dir)
    if (!res) return
    setSent((s) => [...s, { ...res, id }])
    setPos(at + 1)
    setDraft('')
  }

  // Fly the card off its edge, then deal the next one from the middle.
  function send(dir: SortDir) {
    if (!id || busy.current) return
    busy.current = true
    Keyboard.dismiss()
    void Haptics.selectionAsync().catch(() => {})
    const { width, height } = Dimensions.get('window')
    const to = dir === 'left' ? { x: -width * 1.2, y: 0 } : dir === 'right' ? { x: width * 1.2, y: 0 } : dir === 'up' ? { x: 0, y: -height * 0.8 } : { x: 0, y: height * 0.5 }
    Animated.timing(pan, { toValue: to, duration: 180, useNativeDriver: true }).start(() => {
      commit(dir)
      pan.setValue({ x: 0, y: 0 })
      busy.current = false
    })
  }

  function back() {
    const last = sent.at(-1)
    if (!last || busy.current) return
    cmdSortBack(last)
    setSent((s) => s.slice(0, -1))
    setPos(queue.indexOf(last.id))
    setDraft('')
  }

  // The responder is made once; it reaches the current card through this ref.
  const sendRef = useRef(send)
  sendRef.current = send
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => !busy.current && Math.hypot(g.dx, g.dy) > SLOP,
      onPanResponderGrant: () => Keyboard.dismiss(),
      onPanResponderMove: (_e, g) => pan.setValue({ x: g.dx, y: g.dy }),
      onPanResponderRelease: (_e, g) => {
        const dir = swipeDir(g.dx, g.dy)
        if (dir) sendRef.current(dir)
        else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 6 }).start()
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start()
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current

  function addSub() {
    if (id && cmdSortAddSub(id, draft)) setDraft('')
  }

  function pickTarget(side: SortSide) {
    const def = sortTarget(all, side, null)
    const pads = listPads(all).filter((p) => p.id !== def.padId)
    Alert.alert(side === 'left' ? 'A left swipe goes to' : 'A right or up swipe goes to', undefined, [
      { text: def.exists ? def.name : `${def.name} (new pad)`, onPress: () => setSortTarget(side, null) },
      { text: padName(all, null), onPress: () => setSortTarget(side, 'main') },
      ...pads.map((p) => ({ text: p.text || 'Untitled pad', onPress: () => setSortTarget(side, p.id) })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  const rotate = pan.x.interpolate({ inputRange: [-300, 300], outputRange: ['-12deg', '12deg'], extrapolate: 'clamp' })
  const stampLeft = pan.x.interpolate({ inputRange: [-SWIPE_DISTANCE, 0], outputRange: [1, 0], extrapolate: 'clamp' })
  const stampRight = pan.x.interpolate({ inputRange: [0, SWIPE_DISTANCE], outputRange: [0, 1], extrapolate: 'clamp' })
  const stampUp = pan.y.interpolate({ inputRange: [-SWIPE_DISTANCE, -SWIPE_DISTANCE / 3], outputRange: [1, 0], extrapolate: 'clamp' })
  const tally = (dir: SortDir) => sent.filter((x) => x.dir === dir).length
  const summary = [
    tally('right') && `${tally('right')} to ${right.name}`,
    tally('up') && `${tally('up')} done`,
    tally('left') && `${tally('left')} to ${left.name}`,
    tally('skip') && `${tally('skip')} skipped`,
  ].filter(Boolean).join(', ')

  const stamp = (label: string, opacity: Animated.AnimatedInterpolation<number>, style: object) => (
    <Animated.View pointerEvents="none" style={[s.stamp, style, { borderColor: theme.accent, backgroundColor: theme.paperRaised, opacity }]}>
      <Text style={[s.stampText, { color: theme.accent }]}>{label.toUpperCase()}</Text>
    </Animated.View>
  )
  const action = (label: string, a11y: string, onPress: () => void, disabled: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.action, { borderColor: pressed ? theme.accent : theme.rule, backgroundColor: theme.paperRaised, opacity: disabled ? 0.45 : 1 }]}>
      <Text style={[s.actionText, { color: theme.ink }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <Pressable style={[s.root, { backgroundColor: theme.paper, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]} onPress={Keyboard.dismiss} accessible={false}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: theme.ink }]} numberOfLines={1}>Sort {padName(all, padId)}</Text>
            <Text style={[s.lede, { color: theme.inkSoft }]}>{id ? `${queue.length - at} to go. Swipe the card.` : 'One line at a time.'}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Done sorting" style={[s.doneBtn, { backgroundColor: theme.ink }]}>
            <Text style={[s.doneText, { color: theme.paper }]}>Done</Text>
          </Pressable>
        </View>

        <View style={s.stage}>
          {id && row ? (
            <Animated.View
              key={id}
              {...responder.panHandlers}
              style={[s.card, { backgroundColor: theme.paperRaised, borderColor: theme.rule, transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] }]}
            >
              {stamp(left.name, stampLeft, s.stampLeft)}
              {stamp(right.name, stampRight, s.stampRight)}
              {stamp('Done', stampUp, s.stampUp)}
              <Text style={[s.count, { color: theme.inkMute }]}>{at + 1} of {queue.length}</Text>
              <TextInput
                value={row.text}
                onChangeText={(t) => cmdSortSetText(id, t)}
                multiline
                scrollEnabled={false}
                placeholder="Empty line"
                placeholderTextColor={theme.inkMute}
                accessibilityLabel="Line text"
                style={[s.text, { color: theme.ink }]}
              />
              <View style={[s.subs, { borderTopColor: theme.rule }]}>
                <ScrollView style={s.subScroll} keyboardShouldPersistTaps="handled">
                  {subs.map((sub) => {
                    const r = rows[sub.id]!
                    return (
                      <View key={sub.id} style={[s.subRow, { paddingLeft: sub.depth * INDENT }]}>
                        <Text style={[s.dot, { color: theme.inkMute }]}>•</Text>
                        <TextInput
                          value={r.text}
                          onChangeText={(t) => cmdSortSetText(sub.id, t)}
                          onKeyPress={(e) => { if (e.nativeEvent.key === 'Backspace' && r.text === '') cmdSortRemoveSub(sub.id) }}
                          multiline
                          scrollEnabled={false}
                          submitBehavior="blurAndSubmit"
                          accessibilityLabel="Sub item"
                          style={[s.subText, { color: r.done ? theme.inkMute : theme.ink }, r.done && { textDecorationLine: 'line-through' }]}
                        />
                      </View>
                    )
                  })}
                </ScrollView>
                <View style={s.subRow}>
                  <Text style={[s.dot, { color: theme.inkMute }]}>+</Text>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={addSub}
                    onBlur={addSub}
                    submitBehavior="submit"
                    returnKeyType="done"
                    placeholder="Add a sub item"
                    placeholderTextColor={theme.inkMute}
                    accessibilityLabel="Add a sub item"
                    style={[s.subText, { color: theme.ink }]}
                  />
                </View>
              </View>
            </Animated.View>
          ) : (
            <View style={s.empty} accessibilityRole="summary">
              <Text style={[s.emptyTitle, { color: theme.inkSoft }]}>{queue.length === 0 ? 'Nothing to sort in this pad.' : 'All sorted.'}</Text>
              {summary !== '' && <Text style={[s.lede, { color: theme.inkMute, marginTop: 4 }]}>{summary}</Text>}
            </View>
          )}
        </View>

        <View style={s.actions}>
          {action(`← ${left.name}`, `Left: ${left.name}`, () => send('left'), !id)}
          {action('↑ Done', `Up: ${right.name}, done`, () => send('up'), !id)}
          {action(`${right.name} →`, `Right: ${right.name}`, () => send('right'), !id)}
        </View>
        <View style={s.minor}>
          <Pressable onPress={back} disabled={sent.length === 0} accessibilityRole="button" style={s.minorBtn}>
            <Text style={[s.minorText, { color: sent.length ? theme.inkSoft : theme.inkMute, opacity: sent.length ? 1 : 0.5 }]}>Back</Text>
          </Pressable>
          <Pressable onPress={() => send('skip')} disabled={!id} accessibilityRole="button" style={s.minorBtn}>
            <Text style={[s.minorText, { color: id ? theme.inkSoft : theme.inkMute, opacity: id ? 1 : 0.5 }]}>Skip</Text>
          </Pressable>
        </View>
        <View style={[s.targets, { borderTopColor: theme.rule }]}>
          <Pressable onPress={() => pickTarget('left')} accessibilityRole="button" accessibilityLabel={`Pad for a left swipe: ${left.name}`} style={s.minorBtn}>
            <Text style={[s.targetText, { color: theme.inkSoft }]} numberOfLines={1}>← goes to <Text style={{ color: theme.link }}>{left.name}</Text></Text>
          </Pressable>
          <Pressable onPress={() => pickTarget('right')} accessibilityRole="button" accessibilityLabel={`Pad for a right or up swipe: ${right.name}`} style={s.minorBtn}>
            <Text style={[s.targetText, { color: theme.inkSoft }]} numberOfLines={1}>→ and ↑ go to <Text style={{ color: theme.link }}>{right.name}</Text></Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  title: { fontFamily: serif, fontSize: 21 },
  lede: { fontFamily: serif, fontSize: 15, marginTop: 2 },
  doneBtn: { minHeight: 40, paddingHorizontal: 16, borderRadius: 4, justifyContent: 'center' },
  doneText: { fontFamily: serif, fontSize: 16 },
  stage: { flex: 1 },
  card: {
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  count: { fontFamily: serif, fontSize: 13, marginBottom: 6 },
  text: { fontFamily: serif, fontSize: 21, lineHeight: 29, padding: 0 },
  subs: { marginTop: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  subScroll: { maxHeight: 220, flexGrow: 0 },
  subRow: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 30 },
  dot: { fontFamily: serif, fontSize: 17, lineHeight: 26, width: 18 },
  subText: { flex: 1, fontFamily: serif, fontSize: 17, lineHeight: 26, padding: 0 },
  stamp: { position: 'absolute', top: 10, zIndex: 1, paddingHorizontal: 8, paddingVertical: 1, borderWidth: 1.5, borderRadius: 4 },
  stampLeft: { right: 12, transform: [{ rotate: '6deg' }] },
  stampRight: { left: 12, transform: [{ rotate: '-6deg' }] },
  stampUp: { alignSelf: 'center' },
  stampText: { fontFamily: serif, fontSize: 14, letterSpacing: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: serif, fontSize: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  action: { flex: 1, minHeight: 48, paddingHorizontal: 6, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: serif, fontSize: 16 },
  minor: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 4 },
  minorBtn: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  minorText: { fontFamily: serif, fontSize: 16 },
  targets: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 4 },
  targetText: { fontFamily: serif, fontSize: 14 },
})
