// Sort on the phone: the pad's top-level lines one card at a time, under the top bar. Swipe the
// card left for Later (or the pad picked at the bottom: picking one sends the card there
// too), right for Today, up for Today and crossed out, down to cycle it to the bottom of the
// pad to come round again; the buttons do the same. Skip leaves a card; Archive deletes it. The card's text and sub items are live fields. Same queue, targets and commands as
// the web (state/sort.ts); only the gesture is drawn here, with PanResponder and Animated
// so it ships as a JS-only update.
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { Alert, Animated, Dimensions, Keyboard, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { buildIndex, flatten, slotLabel, todayKey } from '@hissypad/core'
import { cmdPickSlot } from '@hissypad/state/hours'
import {
  cmdSortAddSub, cmdSortRemoveSub, cmdSortSetText, loadSortTargets, openPad, padList, padName, placeList, setSortTarget, sortSessionBack, sortSessionCard, sortSessionProgress,
  sortSessionSend, sortSessionSendLeftTo, sortSessionSendLeftToNew, sortSessionStart, sortSummary, sortTarget, swipeDir, SWIPE_DISTANCE, usePad, useSort,
  type SortChoice, type SortDir, type SortSession,
} from '@hissypad/state'
import { INDENT, serif, type Theme } from '../theme'
import { HoursIcon } from './TopIcons'

const SLOP = 10 // px before a touch on the card becomes a drag

// A card's fields are one line each: multiline only so they wrap. Return closes the field
// (blurAndSubmit) and a pasted line break becomes a space.
const oneLine = (t: string) => t.replace(/\r?\n/g, ' ')

// A field on the card. On iOS a TextInput refuses to hand its touch over by default
// (rejectResponderTermination), so a swipe begun on the card's text never reached the card.
// With it off the field still takes a tap (focus, cursor where the finger landed) and the
// card's pan takes the touch once it turns into a drag.
function CardField({ row: _row, ...props }: ComponentProps<typeof TextInput> & { row?: boolean }) {
  return <TextInput rejectResponderTermination={false} {...props} />
}

// Drawn under the app's top bar, with no pad chips: the title picks which pad is sorted, and
// the mode switcher is the way out.
export function SortView({ theme }: { theme: Theme }) {
  const rows = usePad((s) => s.rows)
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const choice = useSort()

  // The pad to sort, from the title, each with its open top-level lines (the cards it would
  // deal). The view is keyed by the pad, so a new one starts over.
  function pickPad() {
    Alert.alert('Sort which pad?', undefined, [
      ...padList(all).filter((p) => p.id !== padId).map((p) => ({ text: `${p.name} (${p.count})`, onPress: () => openPad(p.id) })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }
  const [session, setSession] = useState(() => sortSessionStart())
  const [draft, setDraft] = useState('')
  const pan = useRef(new Animated.ValueXY()).current
  const busy = useRef(false)

  useEffect(() => { void loadSortTargets() }, [])

  const { queue, sent } = session
  const { id } = sortSessionCard(session, rows)
  const progress = sortSessionProgress(session, rows)
  const row = id ? rows[id]! : null
  const subs = useMemo(() => (id ? flatten(buildIndex(rows), false, id) : []), [rows, id])
  const left = sortTarget(all, 'left', choice.left)
  const right = sortTarget(all, 'right')

  // `run` makes the move and returns the session after it: a plain send unless a left pad
  // was just picked.
  function commit(run: () => SortSession) {
    if (!id) return
    if (draft.trim()) cmdSortAddSub(id, draft)
    setSession(run())
    setDraft('')
  }

  // Fly the card off its edge, then deal the next one from the middle.
  function send(dir: SortDir, run = () => sortSessionSend(session, dir)) {
    if (!id || busy.current) return
    busy.current = true
    Keyboard.dismiss()
    void Haptics.selectionAsync().catch(() => {})
    const { width, height } = Dimensions.get('window')
    const to = dir === 'left' ? { x: -width * 1.2, y: 0 } : dir === 'right' ? { x: width * 1.2, y: 0 } : dir === 'up' ? { x: 0, y: -height * 0.8 } : dir === 'cycle' ? { x: 0, y: height * 0.8 } : { x: 0, y: 0 }
    Animated.timing(pan, { toValue: to, duration: 180, useNativeDriver: true }).start(() => {
      commit(run)
      pan.setValue({ x: 0, y: 0 })
      busy.current = false
    })
  }

  function back() {
    if (busy.current) return
    setSession(sortSessionBack(session))
    setDraft('')
  }

  // The responder is made once; it reaches the current card through this ref.
  const sendRef = useRef(send)
  sendRef.current = send
  const responder = useRef(
    PanResponder.create({
      // The card claims the touch as it starts: the screen's root is a Pressable (it puts the
      // keyboard away), and once an ancestor holds a touch React Native never offers it to the
      // views inside on move, so a move-only claim never fired. A touch that starts on a field
      // is held by the field, which gives it up to the capture below once it is a drag.
      onStartShouldSetPanResponder: () => !busy.current,
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

  // The left side's pad. Right is always Today. With a card up, picking a pad sends it there.
  function pickLeft(next: SortChoice) {
    if (id) send('left', () => sortSessionSendLeftTo(session, next))
    else setSortTarget(next)
  }

  function pickTarget() {
    const def = sortTarget(all, 'left', null)
    const places = placeList(all).filter((p) => p.key !== 'main' && !(p.subId === null && p.padId === def.padId && def.exists))
    Alert.alert(id ? 'Send left to' : 'A left swipe goes to', id ? 'This line goes there now, and the next left swipes too.' : undefined, [
      { text: def.exists ? def.name : `${def.name} (new pad)`, onPress: () => pickLeft(null) },
      { text: padName(all, null), onPress: () => pickLeft('main') },
      ...places.map((p) => ({ text: p.label, onPress: () => pickLeft(p.key) })),
      { text: 'New pad…', onPress: newTarget },
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  // Names come through Alert.prompt on iOS; Android has no prompt, so the pad is called
  // "New pad" there and can be renamed later.
  function newTarget() {
    const make = (name: string) => {
      if (id) send('left', () => sortSessionSendLeftToNew(session, name))
      else sortSessionSendLeftToNew(session, name)
    }
    if (Platform.OS !== 'ios') {
      make('New pad')
      return
    }
    Alert.prompt('New pad', 'A name for it', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Create', onPress: (v?: string) => { if (v?.trim()) make(v) } },
    ], 'plain-text')
  }

  const rotate = pan.x.interpolate({ inputRange: [-300, 300], outputRange: ['-12deg', '12deg'], extrapolate: 'clamp' })
  const stampLeft = pan.x.interpolate({ inputRange: [-SWIPE_DISTANCE, 0], outputRange: [1, 0], extrapolate: 'clamp' })
  const stampRight = pan.x.interpolate({ inputRange: [0, SWIPE_DISTANCE], outputRange: [0, 1], extrapolate: 'clamp' })
  const stampUp = pan.y.interpolate({ inputRange: [-SWIPE_DISTANCE, -SWIPE_DISTANCE / 3], outputRange: [1, 0], extrapolate: 'clamp' })
  const stampDown = pan.y.interpolate({ inputRange: [SWIPE_DISTANCE / 3, SWIPE_DISTANCE], outputRange: [0, 1], extrapolate: 'clamp' })
  const summary = sortSummary(session)

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
      <Pressable style={[s.root, { backgroundColor: theme.paper }]} onPress={Keyboard.dismiss} accessible={false}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            {/* No pad chips in Sort: tapping the pad's name in the title picks the pad to sort. */}
            <Pressable onPress={pickPad} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Pad to sort: ${padName(all, padId)}, change`} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, alignSelf: 'flex-start' })}>
              <Text style={[s.title, { color: theme.ink }]} numberOfLines={1}>
                Sort <Text style={{ textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: theme.inkMute }}>{padName(all, padId)}</Text>
                <Text style={{ color: theme.inkMute }}> ▾</Text>
              </Text>
            </Pressable>
            <Text style={[s.lede, { color: theme.inkSoft }]}>{id ? `${progress.left} to go. Swipe the card.` : 'One line at a time.'}</Text>
          </View>
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
              {stamp('Cycle', stampDown, s.stampDown)}
              <View style={s.top}>
                <Text style={[s.count, { color: theme.inkMute }]}>{progress.at} of {progress.total}</Text>
                {row.slot && <Text style={[s.slot, { color: theme.inkSoft, borderColor: theme.rule }]}>{slotLabel(row.slot, todayKey())}</Text>}
                <Pressable
                  onPress={() => cmdPickSlot([id])}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={row.slot ? `Hour: ${slotLabel(row.slot, todayKey())}, change` : 'Put in an hour'}
                  style={({ pressed }) => [s.hour, { opacity: pressed ? 0.5 : 1 }]}
                >
                  <HoursIcon color={theme.inkSoft} />
                </Pressable>
              </View>
              <CardField
                value={row.text}
                onChangeText={(t) => cmdSortSetText(id, oneLine(t))}
                multiline
                scrollEnabled={false}
                submitBehavior="blurAndSubmit"
                returnKeyType="done"
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
                        <CardField
                          row
                          value={r.text}
                          onChangeText={(t) => cmdSortSetText(sub.id, oneLine(t))}
                          onKeyPress={(e) => { if (e.nativeEvent.key === 'Backspace' && r.text === '') cmdSortRemoveSub(sub.id) }}
                          multiline
                          scrollEnabled={false}
                          submitBehavior="blurAndSubmit"
                          returnKeyType="done"
                          accessibilityLabel="Sub item"
                          style={[s.subText, { color: r.done ? theme.inkMute : theme.ink }, r.done && { textDecorationLine: 'line-through' }]}
                        />
                      </View>
                    )
                  })}
                </ScrollView>
                <View style={s.subRow}>
                  <Text style={[s.dot, { color: theme.inkMute }]}>+</Text>
                  <CardField
                    row
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
        <View style={[s.actions, s.actionsDown]}>
          {action('↓ Cycle', 'Down: cycle, to the bottom of the pad to come round again', () => send('cycle'), !id)}
        </View>
        <View style={s.minor}>
          <Pressable onPress={back} disabled={sent.length === 0} accessibilityRole="button" style={s.minorBtn}>
            <Text style={[s.minorText, { color: sent.length ? theme.inkSoft : theme.inkMute, opacity: sent.length ? 1 : 0.5 }]}>Back</Text>
          </Pressable>
          <Pressable onPress={() => send('skip')} disabled={!id} accessibilityRole="button" style={s.minorBtn}>
            <Text style={[s.minorText, { color: id ? theme.inkSoft : theme.inkMute, opacity: id ? 1 : 0.5 }]}>Skip</Text>
          </Pressable>
          <Pressable onPress={() => send('archive')} disabled={!id} accessibilityRole="button" accessibilityHint="Deletes it; the Archive keeps it" style={s.minorBtn}>
            <Text style={[s.minorText, { color: id ? theme.inkSoft : theme.inkMute, opacity: id ? 1 : 0.5 }]}>Archive</Text>
          </Pressable>
        </View>
        <View style={[s.targets, { borderTopColor: theme.rule }]}>
          <Pressable onPress={pickTarget} accessibilityRole="button" accessibilityLabel={`Pad for a left swipe: ${left.name}`} style={s.minorBtn}>
            <Text style={[s.targetText, { color: theme.inkSoft }]} numberOfLines={1}>← goes to <Text style={{ color: theme.link }}>{left.name}</Text></Text>
          </Pressable>
        </View>
      </Pressable>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  title: { fontFamily: serif, fontSize: 21 },
  lede: { fontFamily: serif, fontSize: 15, marginTop: 2 },
  stage: { flex: 1 },
  card: {
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  count: { fontFamily: serif, fontSize: 13, marginRight: 'auto' },
  slot: { fontFamily: serif, fontSize: 12, paddingHorizontal: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: 3, overflow: 'hidden' },
  hour: { padding: 4, margin: -4 },
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
  stampDown: { alignSelf: 'center', top: undefined, bottom: 10 },
  stampText: { fontFamily: serif, fontSize: 14, letterSpacing: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: serif, fontSize: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionsDown: { marginTop: 8, paddingHorizontal: '33%' },
  action: { flex: 1, minHeight: 48, paddingHorizontal: 6, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: serif, fontSize: 16 },
  minor: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 4 },
  minorBtn: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  minorText: { fontFamily: serif, fontSize: 16 },
  targets: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 4 },
  targetText: { fontFamily: serif, fontSize: 14 },
})
