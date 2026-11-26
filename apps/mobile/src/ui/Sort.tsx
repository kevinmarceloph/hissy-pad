// Sort on the phone: the pad's top-level lines one card at a time, under the top bar. Swipe the
// card left for Later (or the pad picked at the bottom: picking one sends the card there
// too), right for Today, up for Today and crossed out, down to cycle it to the bottom of the
// pad to come round again; the buttons do the same. Skip leaves a card; Archive deletes it. The card's text is a live field, and its sub items are the pad's own rows: the store zooms
// into the card's line, so the toolbar and the floating buttons work on them (SubRows.tsx). Same queue, targets and commands as
// the web (state/sort.ts); only the gesture is drawn here, with PanResponder and Animated
// so it ships as a JS-only update. The pad icon on the card goes to the line in the pad.
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type ReactNode, type Ref } from 'react'
import { Animated, Dimensions, Keyboard, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { askText, menu } from './Menu'
import * as Haptics from 'expo-haptics'
import { scopePad, slotLabel, todayKey } from '@hissypad/core'
import { categoryPrefix, cmdPickCategory, cmdPickSlot, useLineCategory } from '@hissypad/state/hours'
import { CategoryBadge } from '@hissypad/ui'
import {
  cmdAppendAtEnd, cmdOpenHit, cmdSortSetText, loadSortTargets, openPad, padList, padName, placeList, setSortTarget, sortSessionBack, sortSessionCard, sortSessionProgress,
  sortSessionSend, sortSessionSendTo, sortSessionSendToNew, sortSessionStart, sortSummary, sortTarget, swipeDir, SWIPE_DISTANCE, usePad, useSort, zoomTo,
  type SortChoice, type SortSide, type SortDir, type SortSession,
} from '@hissypad/state'
import { useKeyboardHeight } from '../keyboard'
import { serif, type Theme } from '../theme'
import { FloatingButtons } from './FloatingButtons'
import { SubRows } from './SubRows'
import { HoursIcon, PadIcon } from './TopIcons'
import { LineIcon } from './LineIcons'
import { cmdPickBoomerang, cmdSortMoveTo, dueWords } from '@hissypad/state'

const SLOP = 10 // px before a touch on the card becomes a drag

// A card's fields are one line each: multiline only so they wrap. Return closes the field
// (blurAndSubmit) and a pasted line break becomes a space.
const oneLine = (t: string) => t.replace(/\r?\n/g, ' ')

// A field on the card. On iOS a TextInput refuses to hand its touch over by default
// (rejectResponderTermination), so a swipe begun on the card's text never reached the card.
// With it off the field still takes a tap (focus, cursor where the finger landed) and the
// card's pan takes the touch once it turns into a drag.
export function CardField({ row: _row, ref, ...props }: ComponentProps<typeof TextInput> & { row?: boolean; ref?: Ref<ComponentRef<typeof TextInput>> }) {
  return <TextInput ref={ref} rejectResponderTermination={false} {...props} />
}

// The card's line: its category in front of the text, as on a line of the pad. A press on it
// opens the category picker.
export function CardLine({ category, onCategory, children }: { category: ReturnType<typeof useLineCategory>; onCategory: () => void; children: ReactNode }) {
  return (
    <View style={s.line}>
      {category && (
        <Pressable onPress={onCategory} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Category: ${category.label}, change`} style={s.badge}>
          <CategoryBadge category={category} size={24} wordWhenBare />
        </Pressable>
      )}
      {children}
    </View>
  )
}

// Drawn under the app's top bar, with no pad chips: the title picks which pad is sorted, and
// the mode switcher is the way out.
// `paused`: something else has the store's zoom (the new item's sheet is up), so the card
// draws no sub items and leaves the zoom alone until it is back.
export function SortView({ theme, onOpen, paused = false }: { theme: Theme; onOpen?: () => void; paused?: boolean }) {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const zoomId = usePad((s) => s.zoomId)
  const targeted = usePad((s) => s.editing !== null || s.selection.length > 0)
  // The keyboard and the line toolbar take most of the screen: while either is up the card
  // has the room and the buttons under it wait.
  const compact = useKeyboardHeight() > 0 || targeted
  // The pad being sorted. The store's own `rows` is what is under the card while it is zoomed into.
  const rows = useMemo(() => scopePad(all, padId), [all, padId])
  const choice = useSort()

  // The pad to sort, from the title, each with its open top-level lines (the cards it would
  // deal). The view is keyed by the pad, so a new one starts over.
  function pickPad() {
    menu('Sort which pad?', undefined, [
      ...padList(all).filter((p) => p.id !== padId).map((p) => ({ text: `${p.name} (${p.count})`, onPress: () => openPad(p.id) })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }
  const [session, setSession] = useState(() => sortSessionStart())
  const pan = useRef(new Animated.ValueXY()).current
  const busy = useRef(false)

  useEffect(() => { void loadSortTargets() }, [])

  const { queue, sent } = session
  const { id } = sortSessionCard(session, rows)
  const progress = sortSessionProgress(session, rows)
  const row = id ? rows[id]! : null
  const category = useLineCategory(row?.category)

  // The card on screen is zoomed into, so the pad's rows and toolbar edit what is under it.
  // A send or Back leaves the zoom (state/sort.ts); the next card takes it here.
  useEffect(() => {
    if (!paused && id && zoomId !== id) zoomTo(id)
  }, [id, zoomId, paused])
  useEffect(() => () => {
    if (usePad.getState().zoomId !== null) zoomTo(null)
  }, [])
  const left = sortTarget(all, 'left', choice.left)
  const right = sortTarget(all, 'right', choice.right)

  // `run` makes the move and returns the session after it: a plain send unless a left pad
  // was just picked.
  function commit(run: () => SortSession) {
    if (!id) return
    setSession(run())
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

  // A side's pad, from the cog beside its button. With a card up, picking a pad sends it there.
  function pick(side: SortSide, next: SortChoice) {
    if (id) send(side, () => sortSessionSendTo(session, side, next))
    else setSortTarget(next, side)
  }

  function pickTarget(side: SortSide) {
    const def = sortTarget(all, side, null)
    const places = placeList(all).filter((p) => p.key !== 'main' && !(p.subId === null && p.padId === def.padId && def.exists))
    const word = side === 'left' ? 'left' : 'right'
    menu(id ? `Send ${word} to` : `A ${word} swipe goes to`, id ? `This line goes there now, and the next ${word} swipes too.` : undefined, [
      { text: def.exists ? def.name : `${def.name} (new pad)`, onPress: () => pick(side, null) },
      { text: padName(all, null), onPress: () => pick(side, 'main') },
      ...places.map((p) => ({ text: categoryPrefix(p.category) + p.label, onPress: () => pick(side, p.key) })),
      { text: 'New pad…', onPress: () => newTarget(side) },
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  function newTarget(side: SortSide) {
    const make = (name: string) => {
      if (id) send(side, () => sortSessionSendToNew(session, side, name))
      else sortSessionSendToNew(session, side, name)
    }
    askText('New pad', 'A name for it', '', make)
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
  const gear = (side: SortSide) => (
    <Pressable onPress={() => pickTarget(side)} accessibilityRole="button" accessibilityLabel={`Pad for a ${side === 'left' ? 'left' : 'right or up'} swipe: ${(side === 'left' ? left : right).name}`} hitSlop={4} style={({ pressed }) => [s.gear, pressed && { backgroundColor: theme.paperRaised }]}>
      <Text style={[s.gearText, { color: theme.inkSoft }]}>{'\u2699\uFE0E'}</Text>
    </Pressable>
  )
  const action = (label: string, a11y: string, onPress: () => void, disabled: boolean, tall = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.action, tall && s.actionTall, { borderColor: pressed ? theme.accent : theme.rule, backgroundColor: theme.paperRaised, opacity: disabled ? 0.45 : 1 }]}>
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
                {/* The floating buttons' order: hour, category, boomerang, move; the pad icon last. */}
                <Pressable
                  onPress={() => cmdPickCategory([id])}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Give a category"
                  style={({ pressed }) => [s.hour, { opacity: pressed ? 0.5 : 1 }]}
                >
                  <LineIcon icon="category" color={theme.inkSoft} ground={theme.paperRaised} />
                </Pressable>
                {/* Out of the pads until a later day: the card moves on, the line is under Later. */}
                <Pressable
                  onPress={() => cmdPickBoomerang([id])}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={row.due ? `Out until ${dueWords(row.due)}, change` : 'Boomerang: send out until a later day'}
                  style={({ pressed }) => [s.hour, { opacity: pressed ? 0.5 : 1 }]}
                >
                  <LineIcon icon="boomerang" color={theme.inkSoft} ground={theme.paperRaised} />
                </Pressable>
                {/* Any pad or sub-pad, beside what the swipes offer: the card moves on (iOS stacks them). */}
                <Pressable
                  onPress={() => menu('Move to', undefined, [
                    ...placeList(all).filter((p) => p.subId !== null || p.padId !== padId).map((p) => ({ text: categoryPrefix(p.category) + p.label, onPress: () => void cmdSortMoveTo(id, p) })),
                    { text: 'Cancel', style: 'cancel' as const },
                  ])}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Move to another pad or a sub-pad"
                  style={({ pressed }) => [s.hour, { opacity: pressed ? 0.5 : 1 }]}
                >
                  <LineIcon icon="move" color={theme.inkSoft} ground={theme.paperRaised} />
                </Pressable>
                <Pressable
                  onPress={() => { if (cmdOpenHit(id)) onOpen?.() }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="See it in the pad"
                  style={({ pressed }) => [s.hour, { opacity: pressed ? 0.5 : 1 }]}
                >
                  <PadIcon color={theme.inkSoft} />
                </Pressable>
              </View>
              <CardLine category={category} onCategory={() => cmdPickCategory([id])}>
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
                  style={[s.text, s.lineText, { color: theme.ink }]}
                />
              </CardLine>
              <View style={[s.subs, { borderTopColor: theme.rule }]}>
                <ScrollView style={[s.subScroll, compact && s.subScrollCompact]} keyboardShouldPersistTaps="handled">
                  {!paused && <SubRows id={id} theme={theme} onAdd={() => { if (usePad.getState().zoomId !== id) zoomTo(id); cmdAppendAtEnd() }} />}
                </ScrollView>
              </View>
            </Animated.View>
          ) : (
            <View style={s.empty} accessibilityRole="summary">
              <Text style={[s.emptyTitle, { color: theme.inkSoft }]}>{queue.length === 0 ? 'Nothing to sort in this pad.' : 'All sorted.'}</Text>
              {summary !== '' && <Text style={[s.lede, { color: theme.inkMute, marginTop: 4 }]}>{summary}</Text>}
            </View>
          )}
        </View>

        {!compact && (
          <>
          {/* Left and right are tall, with up over down between them; a cog on each side picks its pad. */}
          <View style={s.actions}>
            {gear('left')}
            {action(`← ${left.name}`, `Left: ${left.name}`, () => send('left'), !id, true)}
            <View style={s.updown}>
              {action('↑ Done', `Up: ${right.name}, done`, () => send('up'), !id)}
              {action('↓ Cycle', 'Down: cycle, to the bottom of the pad to come round again', () => send('cycle'), !id)}
            </View>
            {action(`${right.name} →`, `Right: ${right.name}`, () => send('right'), !id, true)}
            {gear('right')}
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
          </>
        )}
        {/* The pad's floating buttons, for the sub item being typed or the ones selected. */}
        {!paused && targeted && <FloatingButtons theme={theme} />}
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
  top: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8, rowGap: 10, marginBottom: 6 },
  count: { fontFamily: serif, fontSize: 13, marginRight: 'auto' },
  slot: { fontFamily: serif, fontSize: 12, paddingHorizontal: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: 3, overflow: 'hidden' },
  hour: { padding: 4, margin: -4 },
  text: { fontFamily: serif, fontSize: 21, lineHeight: 29, padding: 0 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineText: { flex: 1 },
  badge: { marginTop: (29 - 24) / 2 },
  subs: { marginTop: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  stamp: { position: 'absolute', top: 10, zIndex: 1, paddingHorizontal: 8, paddingVertical: 1, borderWidth: 1.5, borderRadius: 4 },
  stampLeft: { right: 12, transform: [{ rotate: '6deg' }] },
  stampRight: { left: 12, transform: [{ rotate: '-6deg' }] },
  stampUp: { alignSelf: 'center' },
  stampDown: { alignSelf: 'center', top: undefined, bottom: 10 },
  subScroll: { maxHeight: 220, flexGrow: 0 },
  subScrollCompact: { maxHeight: 130 },
  stampText: { fontFamily: serif, fontSize: 14, letterSpacing: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: serif, fontSize: 20 },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 6, marginTop: 12 },
  updown: { flex: 1, gap: 6 },
  gear: { width: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  gearText: { fontSize: 20 },
  actionTall: { minHeight: 48 * 2 + 6 },
  action: { flex: 1, minHeight: 48, paddingHorizontal: 6, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: serif, fontSize: 16 },
  minor: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 4 },
  minorBtn: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  minorText: { fontFamily: serif, fontSize: 16 },
})

// The card's look, shared with the new item's sheet (Create.tsx): the same card, no swipe.
export const card = { card: s.card, top: s.top, slot: s.slot, hour: s.hour, text: s.text, lineText: s.lineText, subs: s.subs }
