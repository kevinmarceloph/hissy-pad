// The pad screen: a scroll view of visible rows, the toolbar above the keyboard, and drag
// via a long press on a bullet. Drop resolution is core's resolveDrop over the rows'
// measured layouts; this file only measures and draws.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Alert, Keyboard, LayoutAnimation, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import { buildIndex, childrenOf, countLines, descendantIds, headerGaps, flatten, listNumbers, moveNodes, resolveDrop, topmost, type DropTarget, type LayoutRow } from '@hissypad/core'
import { apply, cmdAddAt, cmdAddUnder, cmdAppendAtEnd, cmdDeleteDone, clearLog, dumpLog, logEnabled, refresh, select, stopEditing, usePad, visibleIds } from '@hissypad/state'
import { GUTTER, INDENT, LINE, serif, useTheme } from '../theme'
import { Row } from './Row'
import { Toolbar } from './Toolbar'
import { FloatingButtons } from './FloatingButtons'
import { Account } from './Account'
import { DoneSheet, TrashSheet } from './Lists'
import { SortView } from './Sort'
import { HoursApp, SlotPicker } from '@hissypad/ui'
import { cmdApplySlot, setSlotPickerOpener, targetSlot } from '@hissypad/state/hours'
import { SearchSheet } from './Search'
import { PadChips } from './PadChips'
import { MenuIcon, ModeBar, SearchIcon, type Mode } from './TopIcons'

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

// The placeholder row of a + drag, in the displayed list.
const NEW_ROW = '\u0000new'
// A + drag let go this close to where it began adds nothing.
const ADD_CANCEL = 36

// Keyboard height, so the toolbar can sit right above it (KeyboardAvoidingView was not
// reliable here).
function useKeyboardHeight() {
  const [h, setH] = useState(0)
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow', (e) => {
      const screenH = e.endCoordinates.screenY + e.endCoordinates.height
      setH(Math.max(0, screenH - e.endCoordinates.screenY))
    })
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return h
}

export function Pad() {
  const theme = useTheme()
  const kb = useKeyboardHeight()
  const insets = useSafeAreaInsets()
  const rows = usePad((s) => s.rows)
  const editing = usePad((s) => s.editing)
  const selection = usePad((s) => s.selection)
  const load = usePad((s) => s.load)
  const session = usePad((s) => s.session)
  const padId = usePad((s) => s.padId)
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
  const [mode, setMode] = useState<Mode>('pad')
  const [sheet, setSheet] = useState<'trash' | 'done' | 'search' | null>(null)
  // The hour picker the toolbar's "Hour…" (behind More) opens.
  const [picking, setPicking] = useState<{ value: string | null; count: number } | null>(null)
  useEffect(() => {
    setSlotPickerOpener((ids) => setPicking({ value: targetSlot(ids), count: ids.length }))
    return () => setSlotPickerOpener(null)
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

  // A jump to a sub-pad: scroll its header to the top. The pad may have just been switched,
  // so wait a beat for the rows to be laid out.
  const reveal = usePad((st) => st.reveal)
  useEffect(() => {
    if (!reveal) return
    const t = setTimeout(() => {
      const box = layouts.current.get(reveal.id)
      if (box) scroller.current?.scrollTo({ y: Math.max(0, box.y - 8), animated: true })
    }, 120)
    return () => clearTimeout(t)
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

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    scrollY.current = e.nativeEvent.contentOffset.y
  }

  // Pull down at the top to sync now. The spinner stays up until the push and pull are
  // done, and at least half a second so a fast sync is still seen to happen.
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([refresh(), new Promise((r) => setTimeout(r, 500))])
    setRefreshing(false)
  }, [])

  function deleteDone() {
    const n = cmdDeleteDone()
    setToast(n === 0 ? 'Nothing crossed out' : `Deleted ${n} ${n === 1 ? 'line' : 'lines'}`)
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
      { text: 'Trash', onPress: () => setSheet('trash') },
      ...(logEnabled() ? [{ text: 'Log', onPress: () => setLogText(dumpLog()) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  const doneCount = Object.values(rows).filter((r) => r.deletedAt === null && r.done).length
  const lone = visible.length === 1 && rows[visible[0]!.id]!.text === ''

  return (
    <View style={[s.root, { backgroundColor: theme.paper, paddingBottom: mode === 'pad' && kb > 0 ? kb : insets.bottom }]}>
      <View style={s.top}>
        <Text style={[s.title, { color: theme.inkSoft }]}>HissyPad</Text>
        <ModeBar mode={mode} onMode={switchMode} theme={theme} />
        <View style={s.grow} />
        <Pressable onPress={() => { stopEditing(); setSheet('search') }} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Search every pad"><SearchIcon color={theme.inkSoft} /></Pressable>
        <Pressable onPress={openMenu} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="More: Done and Trash"><MenuIcon color={theme.inkSoft} /></Pressable>
      </View>
      {/* Sort sits above the pads: the chips pick which pad's lines come next. */}
      {mode !== 'hours' && <PadChips theme={theme} />}
      {mode === 'pad' && doneCount > 0 && (
        <Pressable onPress={deleteDone} style={s.clear} accessibilityRole="button" accessibilityLabel={`Clear ${doneCount} completed`} accessibilityHint="Deletes every crossed-out line in this pad. Shake to undo.">
          <Text style={[s.clearText, { color: theme.inkMute }]}>Clear {doneCount} completed</Text>
        </Pressable>
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
      <Modal visible={picking !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicking(null)}>
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
      <SearchSheet visible={sheet === 'search'} onClose={() => setSheet(null)} onOpen={() => setMode('pad')} theme={theme} />
      <DoneSheet visible={sheet === 'done'} onClose={() => setSheet(null)} theme={theme} />
      {toast && <Text style={[s.toast, { color: theme.inkSoft }]}>{toast}</Text>}
      {/* Hours: the shared screens (packages/ui). Sort starts over when the pad changes. */}
      {mode === 'hours' && <View style={s.scroll}><HoursApp /></View>}
      {mode === 'sort' && <SortView key={padId ?? 'main'} theme={theme} />}
      {load === 'loading' ? (
        mode === 'pad' && <Text style={[s.hint, { color: theme.inkMute }]}>Opening your pad…</Text>
      ) : (
        <GestureDetector gesture={pan}>
          <View ref={container} style={mode === 'pad' ? s.scroll : s.hidden} onLayout={() => container.current?.measureInWindow((x, y) => (origin.current = { x, y }))}>
          <ScrollView
            ref={scroller}
            style={s.scroll}
            contentContainerStyle={s.content}
            onScroll={onScroll}
            scrollEventThrottle={16}
            scrollEnabled={!drag}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            refreshControl={session ? <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.inkMute} colors={[theme.accent]} progressBackgroundColor={theme.paperRaised} /> : undefined}
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
            {lone && (
              <Text style={[s.hint, { color: theme.inkMute }]}>Type anything. Return for a new line, the toolbar for nesting and crossing out. Press and hold a bullet to drag.</Text>
            )}
            <Pressable style={s.tail} onPress={cmdAppendAtEnd} accessibilityLabel="Add a line at the end" />
            <Account theme={theme} />
          </ScrollView>
          <FloatingButtons theme={theme} onAdd={() => scroller.current?.scrollTo({ y: 0, animated: true })} addDrag={addDrag} dragging={!!drag?.add} />
          </View>
        </GestureDetector>
      )}
      {drag && (
        <View pointerEvents="none" style={[s.ghost, { left: drag.x + 14, top: drag.y - 14, backgroundColor: theme.paperRaised, borderColor: theme.rule }]}>
          <Text numberOfLines={1} style={[s.ghostText, { color: theme.ink }]}>{drag.label}</Text>
        </View>
      )}
      {mode === 'pad' && <Toolbar theme={theme} />}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 },
  grow: { flex: 1 },
  iconBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  clear: { alignSelf: 'flex-start', minHeight: 30, paddingHorizontal: 22, justifyContent: 'center' },
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
  ghost: { position: 'absolute', zIndex: 10, maxWidth: 260, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  ghostText: { fontFamily: serif, fontSize: 15 },
})
