// The pad screen: a scroll view of visible rows, the toolbar above the keyboard, and drag
// via a long press on a bullet. Drop resolution is core's resolveDrop over the rows'
// measured layouts; this file only measures and draws.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Alert, Animated, Keyboard, LayoutAnimation, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import { buildIndex, childrenOf, countLines, descendantIds, headerGaps, flatten, listNumbers, moveNodes, resolveDrop, topmost, type DropTarget, type LayoutRow } from '@hissypad/core'
import { apply, cmdAddAt, cmdAddUnder, cmdAppendAtEnd, cmdDeleteDone, clearLog, dumpLog, logEnabled, countKey, countShown, refresh, resumeEditing, select, stopEditing, toggleCount, usePad, usePrefs, visibleIds } from '@hissypad/state'
import { GUTTER, INDENT, LINE, serif, useTheme } from '../theme'
import { Row } from './Row'
import { Toolbar } from './Toolbar'
import { FloatingButtons } from './FloatingButtons'
import { Account } from './Account'
import { DoneSheet, TrashSheet } from './Lists'
import { SortView } from './Sort'
import { CategoriesApp, CategoryPicker, HoursApp, SlotPicker } from '@hissypad/ui'
import {
  cmdAddCategory, cmdApplyCategory, cmdApplySlot, openHours, setCategoryPickerOpener, setSlotPickerOpener, targetCategory, targetSlot, useCategoryChoices,
} from '@hissypad/state/hours'
import { SearchSheet } from './Search'
import { PadChips } from './PadChips'
import { MenuIcon, ModeBar, PlusIcon, SearchIcon, type Mode } from './TopIcons'
import { CreateSheet, openCreate, useCreating } from './Create'
import { useKeyboardHeight } from '../keyboard'

interface Drag {
  ids: string[]
  moving: Set<string>
  label: string
  x: number
  y: number
  target: DropTarget | null
  // The floating + being dragged to where a new line should go: nothing moves, a
  // placeholder shows the spot. `from` is where the finger started.
  add?: { fromX: number; fromY: number }
}

// Pull to sync, as on the web: a line of words that rides down from behind the top edge
// with the finger, "Pull to sync" until it has come this far, then "Release to sync".
const PULL_THRESHOLD = 64
const PULL_MAX = 96
const PULL_SETTLE_MS = 1200 // how long the result stays
type PullPhase = 'idle' | 'pulling' | 'armed' | 'syncing' | 'done' | 'failed'
const PULL_WORDS: Record<PullPhase, string> = { idle: '', pulling: 'Pull to sync', armed: 'Release to sync', syncing: 'Syncing…', done: 'Synced', failed: 'Sync failed' }
// iOS lets a list be pulled past its top, which is what the line follows. Android does
// not, so it keeps the platform's own spinner.
const PULL_WORDS_OK = Platform.OS === 'ios'

const NONE: string[] = []

// The placeholder row of a + drag, in the displayed list.
const NEW_ROW = '\u0000new'
// A + drag let go this close to where it began adds nothing.
const ADD_CANCEL = 36

export function Pad() {
  const theme = useTheme()
  const kb = useKeyboardHeight()
  const insets = useSafeAreaInsets()
  const liveRows = usePad((s) => s.rows)
  const liveEditing = usePad((s) => s.editing)
  const liveSelection = usePad((s) => s.selection)
  const zoomed = usePad((s) => s.zoomId !== null)
  const load = usePad((s) => s.load)
  const session = usePad((s) => s.session)
  const padId = usePad((s) => s.padId)
  // The new item's sheet is up: it draws the pad's rows and toolbar itself (zoomed into the
  // new line), so this screen draws neither behind it.
  const creating = useCreating()
  // While the store is zoomed into one line (Sort's card, the new item's), `rows` is what is
  // under that line and the editing belongs to the card. This list, behind the sheet or
  // hidden under Sort, keeps the pad as it last was, with nothing being edited: a second
  // field for the same line would fight the card's for the keyboard, and the list keeps its place.
  const quiet = creating || zoomed
  const kept = useRef(liveRows)
  if (!quiet) kept.current = liveRows
  const rows = quiet ? kept.current : liveRows
  const editing = quiet ? null : liveEditing
  const selection = quiet ? NONE : liveSelection
  const [refreshing, setRefreshing] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const layouts = useRef(new Map<string, { y: number; height: number }>())
  const scrollY = useRef(0)
  const origin = useRef({ x: 0, y: 0 })
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null)
  const container = useRef<ComponentRef<typeof View>>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [logText, setLogText] = useState<string | null>(null)
  // Pad, Hours or Sort: the switcher in the top bar. The pad stays mounted under the other
  // two, so it is where it was left on the way back.
  const [mode, setMode] = useState<Mode>('hours')
  const [sheet, setSheet] = useState<'trash' | 'done' | 'search' | 'categories' | null>(null)
  // The hour picker the toolbar's "Hour…" (behind More) opens.
  const [picking, setPicking] = useState<{ value: string | null; count: number } | null>(null)
  // The same for "Category…".
  const [categorizing, setCategorizing] = useState<{ value: string | null; count: number } | null>(null)
  const categoryChoices = useCategoryChoices()
  useEffect(() => {
    // Hours' rows are opened with the pad: a line's category icon comes from its list.
    void openHours()
    setSlotPickerOpener((ids) => setPicking({ value: targetSlot(ids), count: ids.length }))
    setCategoryPickerOpener((ids) => setCategorizing({ value: targetCategory(ids), count: ids.length }))
    return () => {
      setSlotPickerOpener(null)
      setCategoryPickerOpener(null)
    }
  }, [])

  const { index, visible, numbers } = useMemo(() => {
    const index = buildIndex(rows)
    const ids = visibleIds({ ...usePad.getState(), rows })
    const depth = new Map<string, number>()
    for (const r of flatten(index, true)) depth.set(r.id, r.depth)
    return { index, visible: ids.map((id) => ({ id, depth: depth.get(id) ?? 0 })), numbers: listNumbers(index) }
  }, [rows])
  const selectedSet = useMemo(() => new Set(selection), [selection])
  // Descendants of a selected line come along with it, so they get a fainter wash.
  const selectedChildSet = useMemo(() => {
    const set = new Set<string>()
    for (const id of selection) for (const d of descendantIds(index, id)) if (!selectedSet.has(d)) set.add(d)
    return set
  }, [selection, selectedSet, index])

  // Live reorder: with a drop target, the dragged rows are shown where they would land.
  const displayed = useMemo(() => {
    const t = drag?.target
    if (!t) return visible.map((v) => ({ ...v, preview: false }))
    if (drag!.add) {
      const plain = visible.map((v) => ({ ...v, preview: false }))
      return [...plain.slice(0, t.gapIndex), { id: NEW_ROW, depth: t.depth, preview: true }, ...plain.slice(t.gapIndex)]
    }
    const anchors = visible.filter((v) => !drag!.moving.has(v.id))
    const moving = visible.filter((v) => drag!.moving.has(v.id))
    const base = moving[0]?.depth ?? 0
    const placed = moving.map((v) => ({ id: v.id, depth: v.depth - base + t.depth, preview: true }))
    return [...anchors.slice(0, t.gapIndex).map((v) => ({ ...v, preview: false })), ...placed, ...anchors.slice(t.gapIndex).map((v) => ({ ...v, preview: false }))]
  }, [visible, drag])
  // The line of space under each header's group; a tap adds a sub item to the header.
  const gaps = useMemo(() => headerGaps(displayed, rows), [displayed, rows])

  // A jump to a line (a sub-pad, a search hit, Sort's pad icon): scroll it to the top. The pad
  // may have just been switched, so wait a beat for the rows to be laid out. `room` is space
  // under the last line, so a line near the end can still reach the top; another pad drops it.
  const reveal = usePad((st) => st.reveal)
  const [room, setRoom] = useState(0)
  const roomRef = useRef(0)
  const viewH = useRef(0)
  const contentH = useRef(0)
  useEffect(() => { roomRef.current = 0; setRoom(0) }, [padId])
  useEffect(() => {
    if (!reveal) return
    let t2: ReturnType<typeof setTimeout> | undefined
    const t = setTimeout(() => {
      const box = layouts.current.get(reveal.id)
      if (!box) return
      const y = Math.max(0, box.y - 8)
      const need = Math.max(0, Math.ceil(viewH.current - (contentH.current - roomRef.current - y)))
      roomRef.current = need
      setRoom(need)
      t2 = setTimeout(() => scroller.current?.scrollTo({ y, animated: true }), 50)
    }, 120)
    return () => { clearTimeout(t); clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.n])

  const onRowLayout = useCallback((id: string, e: LayoutChangeEvent) => {
    layouts.current.set(id, { y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height })
  }, [])

  const updateDrag = useCallback((x: number, y: number) => {
    const d = dragRef.current
    if (!d) return
    const state = usePad.getState()
    const idx = buildIndex(state.rows)
    const vis = visibleIds(state)
    const depth = new Map(flatten(idx, true).map((r) => [r.id, r.depth]))
    const layout: LayoutRow[] = vis
      .map((id) => ({ id, depth: depth.get(id) ?? 0, box: layouts.current.get(id) }))
      .filter((r) => r.box)
      .map((r) => ({ id: r.id, depth: r.depth, top: r.box!.y, height: r.box!.height }))
    const target = resolveDrop({
      rows: state.rows,
      index: idx,
      layout,
      moving: d.moving,
      pointerY: y - origin.current.y + scrollY.current,
      // A new line lands level with the line below it (the shallowest the gap allows); a
      // moved row follows the finger's x.
      pointerDepth: d.add ? 0 : (x - origin.current.x - GUTTER) / INDENT,
    })
    const prev = d.target
    const changed = (prev?.gapIndex ?? -1) !== (target?.gapIndex ?? -1) || prev?.depth !== target?.depth
    dragRef.current = { ...d, x, y, target }
    // Live reorder: slide the rows when the target changes (position updates alone are cheap).
    if (changed) LayoutAnimation.configureNext(LayoutAnimation.create(140, 'easeInEaseOut', 'opacity'))
    setDrag(dragRef.current)
  }, [])

  const beginDrag = useCallback((id: string, x: number, y: number) => {
    const state = usePad.getState()
    const idx = buildIndex(state.rows)
    const base = state.selection.includes(id) ? state.selection : [id]
    const ids = topmost(idx, base)
    const moving = new Set(ids)
    for (const t of ids) for (const dd of descendantIds(idx, t)) moving.add(dd)
    if (state.editing) usePad.setState({ editing: null })
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const counted = countLines([...moving].map((m) => state.rows[m]))
    dragRef.current = { ids, moving, label: counted > 1 ? `${counted} lines` : state.rows[id]?.text || '(blank)', x, y, target: null }
    setDrag(dragRef.current)
    updateDrag(x, y)
  }, [updateDrag])

  const endDrag = useCallback((commit: boolean) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d) return
    if (commit && d.target) {
      const t = d.target
      apply((rows, ctx) => moveNodes(rows, ctx, d.ids, t.placement), { label: 'drag' })
      const vis = new Set(visibleIds())
      const kept = d.ids.filter((i) => vis.has(i))
      if (kept.length) select(kept, kept[0]!, kept.at(-1)!)
      void Haptics.selectionAsync()
    }
  }, [])

  // The floating + dragged like in Things: a placeholder follows the finger between the
  // lines, and letting go opens a new line there. Let go near where it started, or with
  // no spot found, and nothing is added.
  const addDrag = useMemo(() => ({
    begin(x: number, y: number) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      dragRef.current = { ids: [], moving: new Set<string>(), label: 'New line', x, y, target: null, add: { fromX: x, fromY: y } }
      setDrag(dragRef.current)
      updateDrag(x, y)
    },
    move(x: number, y: number) {
      if (dragRef.current?.add) updateDrag(x, y)
    },
    end(commit: boolean) {
      const d = dragRef.current
      if (!d?.add) return
      dragRef.current = null
      setDrag(null)
      const far = Math.hypot(d.x - d.add.fromX, d.y - d.add.fromY) > ADD_CANCEL
      if (commit && far && d.target) {
        cmdAddAt(d.target.placement)
        void Haptics.selectionAsync()
      }
    },
  }), [updateDrag])

  // True while the list's own pan (a row being moved) owns the drag, so it leaves a +
  // drag alone if both gestures are active.
  const rowDrag = useRef(false)

  // One pan gesture over the whole list: it only activates after a long press, and the
  // row under the press is found from the measured layouts.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(280)
        .runOnJS(true)
        .onStart((e) => {
          const y = e.absoluteY - origin.current.y + scrollY.current
          const vis = visibleIds()
          const hit = vis.find((id) => {
            const b = layouts.current.get(id)
            return b && y >= b.y && y < b.y + b.height
          })
          const x = e.absoluteX - origin.current.x
          if (hit && x < GUTTER + INDENT * 6 && !dragRef.current) {
            rowDrag.current = true
            beginDrag(hit, e.absoluteX, e.absoluteY)
          }
        })
        .onUpdate((e) => {
          if (rowDrag.current) updateDrag(e.absoluteX, e.absoluteY)
        })
        .onEnd(() => {
          if (rowDrag.current) endDrag(true)
        })
        .onFinalize((_e, success) => {
          if (rowDrag.current && !success) endDrag(false)
          rowDrag.current = false
        }),
    [beginDrag, updateDrag, endDrag],
  )

  // Pull to sync (iOS). The line's position follows the scroll without a render; only a
  // change of phase renders.
  const pullY = useRef(new Animated.Value(0)).current
  const [pull, setPull] = useState<PullPhase>('idle')
  const pullRef = useRef<PullPhase>('idle')
  const touching = useRef(false)
  const goPull = (p: PullPhase) => {
    pullRef.current = p
    setPull(p)
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = e.nativeEvent.contentOffset.y
    scrollY.current = y
    const p = pullRef.current
    if (!PULL_WORDS_OK || !session || !touching.current || (p !== 'idle' && p !== 'pulling' && p !== 'armed')) return
    const over = Math.max(0, -y)
    pullY.setValue(Math.min(over, PULL_MAX))
    const next: PullPhase = over <= 0 ? 'idle' : over >= PULL_THRESHOLD ? 'armed' : 'pulling'
    if (next === p) return
    if (next === 'armed') void Haptics.selectionAsync().catch(() => {})
    goPull(next)
  }

  async function onPullEnd() {
    touching.current = false
    const p = pullRef.current
    if (p === 'pulling') {
      goPull('idle')
      pullY.setValue(0)
    }
    if (p !== 'armed') return
    goPull('syncing')
    Animated.timing(pullY, { toValue: PULL_THRESHOLD, duration: 160, useNativeDriver: false }).start()
    // At least half a second, so a fast sync is still seen to happen.
    await Promise.all([refresh(), new Promise((r) => setTimeout(r, 500))])
    goPull(usePad.getState().sync?.state === 'error' ? 'failed' : 'done')
    await new Promise((r) => setTimeout(r, PULL_SETTLE_MS))
    Animated.timing(pullY, { toValue: 0, duration: 160, useNativeDriver: false }).start(() => goPull('idle'))
  }

  // Android: pull down at the top to sync now. The spinner stays up until the push and pull are
  // done, and at least half a second so a fast sync is still seen to happen.
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([refresh(), new Promise((r) => setTimeout(r, 500))])
    setRefreshing(false)
  }, [])

  function deleteDone() {
    const n = cmdDeleteDone()
    setToast(n === 0 ? 'Nothing crossed out' : `Archived ${n} ${n === 1 ? 'line' : 'lines'}`)
    setTimeout(() => setToast(null), 2500)
  }

  function switchMode(next: Mode) {
    if (next === mode) return
    stopEditing()
    Keyboard.dismiss()
    setMode(next)
  }

  // The hamburger: the lists that are looked at now and then.
  function openMenu() {
    stopEditing()
    Alert.alert('HissyPad', undefined, [
      { text: 'Done', onPress: () => setSheet('done') },
      { text: 'Archive', onPress: () => setSheet('trash') },
      { text: 'Categories', onPress: () => setSheet('categories') },
      (() => {
        // This pad's count in the tabs, on or off for this pad only.
        const key = countKey(usePad.getState().all, usePad.getState().padId)
        const on = countShown(usePrefs.getState().hiddenCounts, key)
        return { text: on ? "Hide this pad's count" : "Show this pad's count", onPress: () => toggleCount(key) }
      })(),
      ...(logEnabled() ? [{ text: 'Log', onPress: () => setLogText(dumpLog()) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  const doneCount = Object.values(rows).filter((r) => r.deletedAt === null && r.done).length
  const lone = visible.length === 1 && rows[visible[0]!.id]!.text === ''

  // The hour and category pickers. They are drawn here, or inside the new item's sheet
  // while it is up, so they open over it.
  const pickers = (
    <>
      <Modal visible={picking !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicking(null)} onDismiss={resumeEditing}>
        <View style={{ flex: 1, backgroundColor: theme.paper, paddingTop: 12 }}>
          {picking && (
            <SlotPicker
              value={picking.value}
              count={picking.count}
              onCancel={() => setPicking(null)}
              onPick={(slot) => {
                const said = cmdApplySlot(slot)
                setPicking(null)
                setToast(said)
                setTimeout(() => setToast(null), 2500)
              }}
            />
          )}
        </View>
      </Modal>
      <Modal visible={categorizing !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCategorizing(null)} onDismiss={resumeEditing}>
        <View style={{ flex: 1, backgroundColor: theme.paper, paddingTop: 12 }}>
          {categorizing && (
            <CategoryPicker
              categories={categoryChoices}
              value={categorizing.value}
              count={categorizing.count}
              onCancel={() => setCategorizing(null)}
              onPick={(category) => {
                const said = cmdApplyCategory(category)
                setCategorizing(null)
                setToast(said)
                setTimeout(() => setToast(null), 2500)
              }}
              onCreate={(label, icon, color) => {
                setCategorizing(null)
                void cmdAddCategory(label, icon, color).then((made) => {
                  setToast(made ? cmdApplyCategory(made.id) : 'That category was not saved.')
                  setTimeout(() => setToast(null), 2500)
                })
              }}
            />
          )}
        </View>
      </Modal>
    </>
  )

  return (
    <View style={[s.root, { backgroundColor: theme.paper, paddingBottom: (mode === 'pad' || mode === 'sort') && kb > 0 ? kb : insets.bottom }]}>
      <View style={s.top}>
        <Text style={[s.title, { color: theme.inkSoft }]}>HissyPad</Text>
        <ModeBar mode={mode} onMode={switchMode} theme={theme} />
        <View style={s.grow} />
        <Pressable onPress={() => { stopEditing(); openCreate() }} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="New item"><PlusIcon color={theme.inkSoft} /></Pressable>
        <Pressable onPress={() => { stopEditing(); setSheet('search') }} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Search every pad"><SearchIcon color={theme.inkSoft} /></Pressable>
        <Pressable onPress={openMenu} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="More: Done, Archive and Categories"><MenuIcon color={theme.inkSoft} /></Pressable>
      </View>
      {/* The pad chips are the pad's only: Sort picks its pad in its own title. */}
      {mode === 'pad' && <PadChips theme={theme} />}
      {/* The pad's status line: the toast on the left, Archive x completed flush right. It keeps
          its height when both are empty, so neither one pushes the pad down when it shows up. */}
      {mode === 'pad' && (
        <View style={s.status}>
          <Text style={[s.statusToast, { color: theme.inkSoft }]} numberOfLines={1} accessibilityLiveRegion="polite">{toast ?? ''}</Text>
          {doneCount > 0 && (
            <Pressable onPress={deleteDone} style={s.clear} hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="button" accessibilityLabel={`Archive ${doneCount} completed`} accessibilityHint="Archives every crossed-out line in this pad. Shake to undo.">
              <Text style={[s.clearText, { color: theme.inkMute }]}>Archive {doneCount} completed</Text>
            </Pressable>
          )}
        </View>
      )}
      <Modal visible={logText !== null} animationType="slide" onRequestClose={() => setLogText(null)}>
        <View style={{ flex: 1, backgroundColor: theme.paper, paddingTop: 48 }}>
          <View style={[s.top, { gap: 16 }]}>
            <Text style={[s.title, { color: theme.inkSoft }]}>Debug log</Text>
            <Pressable onPress={() => { clearLog(); setLogText('') }} style={s.topBtn}><Text style={[s.topText, { color: theme.inkSoft }]}>Clear</Text></Pressable>
            <Pressable onPress={() => setLogText(null)} style={s.topBtn}><Text style={[s.topText, { color: theme.inkSoft }]}>Close</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 12 }}>
            <Text selectable style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10, lineHeight: 14, color: theme.ink }}>{logText}</Text>
          </ScrollView>
        </View>
      </Modal>
      <TrashSheet visible={sheet === 'trash'} onClose={() => setSheet(null)} theme={theme} />
      {!creating && pickers}
      <CreateSheet theme={theme} onOpen={() => setMode('pad')}>{pickers}</CreateSheet>
      <Modal visible={sheet === 'categories'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
        <View style={{ flex: 1, backgroundColor: theme.paper, paddingTop: 12 }}>
          {sheet === 'categories' && <CategoriesApp onClose={() => setSheet(null)} />}
        </View>
      </Modal>
      <SearchSheet visible={sheet === 'search'} onClose={() => setSheet(null)} onOpen={() => setMode('pad')} theme={theme} />
      <DoneSheet visible={sheet === 'done'} onClose={() => setSheet(null)} theme={theme} />
      {toast && mode !== 'pad' && <Text style={[s.toast, { color: theme.inkSoft }]}>{toast}</Text>}
      {/* Hours: the shared screens (packages/ui). Sort starts over when the pad changes. */}
      {mode === 'hours' && <View style={s.scroll}><HoursApp /></View>}
      {mode === 'sort' && <SortView key={padId ?? 'main'} theme={theme} paused={creating} onOpen={() => setMode('pad')} />}
      {load === 'loading' ? (
        mode === 'pad' && <Text style={[s.hint, { color: theme.inkMute }]}>Opening your pad…</Text>
      ) : (
        <GestureDetector gesture={pan}>
          <View ref={container} style={mode === 'pad' ? s.scroll : s.hidden} onLayout={() => container.current?.measureInWindow((x, y) => (origin.current = { x, y }))}>
          <ScrollView
            ref={scroller}
            style={s.scroll}
            contentContainerStyle={[s.content, room > 0 && { paddingBottom: 24 + room }]}
            onLayout={(e) => { viewH.current = e.nativeEvent.layout.height }}
            onContentSizeChange={(_, h) => { contentH.current = h }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            scrollEnabled={!drag}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScrollBeginDrag={() => { touching.current = true }}
            onScrollEndDrag={() => void onPullEnd()}
            refreshControl={session && !PULL_WORDS_OK ? <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.inkMute} colors={[theme.accent]} progressBackgroundColor={theme.paperRaised} /> : undefined}
          >
            {displayed.map(({ id, depth, preview }) => (
              <Fragment key={id}>
              {id === NEW_ROW ? (
                <View style={[s.newRow, { marginLeft: depth * INDENT, backgroundColor: theme.accentSoft }]}>
                  <Text style={[s.newBullet, { color: theme.accent }]}>+</Text>
                </View>
              ) : (
              <Row
                row={rows[id]!}
                depth={depth}
                childCount={childrenOf(index, id).length}
                foldCount={countLines(childrenOf(index, id))}
                editing={editing}
                selected={selectedSet.has(id)}
                selectedChild={selectedChildSet.has(id)}
                number={numbers.get(id) ?? null}
                dragging={preview ? false : (drag?.moving.has(id) ?? false)}
                preview={preview}
                theme={theme}
                onLayout={onRowLayout}
                onBulletLongPress={() => {}}
              />
              )}
              {gaps.get(id)?.map((h) => (
                <Pressable key={`gap:${h}`} style={s.gap} onPress={() => cmdAddUnder(h)} accessibilityRole="button" accessibilityLabel="Add a line under this header" />
              ))}
              </Fragment>
            ))}
            {lone && !quiet && (
              <Text style={[s.hint, { color: theme.inkMute }]}>Type anything. Return for a new line, the toolbar for nesting and crossing out. Press and hold a bullet to drag.</Text>
            )}
            <Pressable style={s.tail} onPress={cmdAppendAtEnd} accessibilityLabel="Add a line at the end" />
            <Account theme={theme} />
          </ScrollView>
          {pull !== 'idle' && (
            <View pointerEvents="none" style={s.pullClip} accessibilityLiveRegion="polite">
              <Animated.View style={[s.pull, { backgroundColor: theme.paperRaised, borderColor: theme.rule, transform: [{ translateY: Animated.subtract(pullY, PULL_THRESHOLD) }] }]}>
                <Text style={[s.pullText, { color: pull === 'armed' ? theme.accent : theme.inkSoft }]}>{PULL_WORDS[pull]}</Text>
              </Animated.View>
            </View>
          )}
          {!quiet && <FloatingButtons theme={theme} onAdd={() => scroller.current?.scrollTo({ y: 0, animated: true })} addDrag={addDrag} dragging={!!drag?.add} />}
          </View>
        </GestureDetector>
      )}
      {drag && (
        <View pointerEvents="none" style={[s.ghost, { left: drag.x + 14, top: drag.y - 14, backgroundColor: theme.paperRaised, borderColor: theme.rule }]}>
          <Text numberOfLines={1} style={[s.ghostText, { color: theme.ink }]}>{drag.label}</Text>
        </View>
      )}
      {/* The line toolbar: the pad's, and Sort's for the sub items on its card. */}
      {(mode === 'pad' || mode === 'sort') && !creating && <Toolbar theme={theme} />}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 },
  grow: { flex: 1 },
  iconBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', height: 24, paddingLeft: 16, paddingRight: 6, gap: 12 },
  statusToast: { flex: 1, fontFamily: serif, fontStyle: 'italic', fontSize: 14 },
  clear: { height: 24, paddingHorizontal: 10, justifyContent: 'center' },
  clearText: { fontFamily: serif, fontSize: 13 },
  hidden: { display: 'none' },
  title: { fontFamily: serif, fontStyle: 'italic', fontSize: 19 },
  topBtn: { minHeight: 32, justifyContent: 'center' },
  topText: { fontFamily: serif, fontSize: 15 },
  toast: { fontFamily: serif, fontStyle: 'italic', fontSize: 14, paddingHorizontal: 16, paddingBottom: 4 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 8, paddingBottom: 24 },
  hint: { fontFamily: serif, fontStyle: 'italic', fontSize: 15, lineHeight: 22, paddingHorizontal: GUTTER + 8, paddingVertical: 8 },
  newRow: { height: LINE, borderRadius: 4, justifyContent: 'center' }, // where a dragged + would add a line
  newBullet: { width: GUTTER, textAlign: 'center', fontFamily: serif, fontSize: 17, lineHeight: LINE },
  gap: { height: LINE }, // the line of space under a header's group
  tail: { height: 56 },
  // The pull-to-sync line: clipped to the list, so it comes out from behind the top edge.
  pullClip: { position: 'absolute', top: 0, left: 0, right: 0, height: 44, overflow: 'hidden', alignItems: 'center', zIndex: 6 },
  pull: { paddingHorizontal: 13, paddingVertical: 5, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderTopWidth: 0 },
  pullText: { fontFamily: serif, fontStyle: 'italic', fontSize: 15 },
  ghost: { position: 'absolute', zIndex: 10, maxWidth: 260, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  ghostText: { fontFamily: serif, fontSize: 15 },
})
