// The pad screen: a scroll view of visible rows, the toolbar above the keyboard, and drag
// via a long press on a bullet. Drop resolution is core's resolveDrop over the rows'
// measured layouts; this file only measures and draws.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Keyboard, LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { buildIndex, childrenOf, descendantIds, flatten, listNumbers, moveNodes, resolveDrop, topmost, type DropTarget, type LayoutRow } from '@hissypad/core'
import { apply, cmdAppendAtEnd, cmdCopySelection, cmdDeleteDone, clearLog, dumpLog, importOutline, logEnabled, select, usePad, visibleIds } from '@hissypad/state'
import { GUTTER, INDENT, serif, useTheme } from '../theme'
import { Row } from './Row'
import { Toolbar } from './Toolbar'
import { Account } from './Account'

interface Drag {
  ids: string[]
  moving: Set<string>
  label: string
  x: number
  y: number
  target: DropTarget | null
}

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
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const layouts = useRef(new Map<string, { y: number; height: number }>())
  const scrollY = useRef(0)
  const origin = useRef({ x: 0, y: 0 })
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null)
  const container = useRef<ComponentRef<typeof View>>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [logText, setLogText] = useState<string | null>(null)

  const { index, visible, numbers } = useMemo(() => {
    const index = buildIndex(rows)
    const ids = visibleIds({ ...usePad.getState(), rows })
    const depth = new Map<string, number>()
    for (const r of flatten(index, true)) depth.set(r.id, r.depth)
    return { index, visible: ids.map((id) => ({ id, depth: depth.get(id) ?? 0 })), numbers: listNumbers(index) }
  }, [rows])
  const selectedSet = useMemo(() => new Set(selection), [selection])

  // Live reorder: with a drop target, the dragged rows are shown where they would land.
  const displayed = useMemo(() => {
    const t = drag?.target
    if (!t) return visible.map((v) => ({ ...v, preview: false }))
    const anchors = visible.filter((v) => !drag!.moving.has(v.id))
    const moving = visible.filter((v) => drag!.moving.has(v.id))
    const base = moving[0]?.depth ?? 0
    const placed = moving.map((v) => ({ id: v.id, depth: v.depth - base + t.depth, preview: true }))
    return [...anchors.slice(0, t.gapIndex).map((v) => ({ ...v, preview: false })), ...placed, ...anchors.slice(t.gapIndex).map((v) => ({ ...v, preview: false }))]
  }, [visible, drag])

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
      pointerDepth: (x - origin.current.x - GUTTER) / INDENT,
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
    dragRef.current = { ids, moving, label: moving.size > 1 ? `${moving.size} lines` : state.rows[id]?.text || '(blank)', x, y, target: null }
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
          if (hit && x < GUTTER + INDENT * 6) beginDrag(hit, e.absoluteX, e.absoluteY)
        })
        .onUpdate((e) => updateDrag(e.absoluteX, e.absoluteY))
        .onEnd(() => endDrag(true))
        .onFinalize((_e, success) => {
          if (!success) endDrag(false)
        }),
    [beginDrag, updateDrag, endDrag],
  )

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    scrollY.current = e.nativeEvent.contentOffset.y
  }

  async function pasteIn() {
    const text = await Clipboard.getStringAsync()
    const ids = importOutline(text, 'top')
    setToast(ids.length ? `Added ${ids.length} ${ids.length === 1 ? 'line' : 'lines'} at the top` : 'Clipboard is empty')
    setTimeout(() => setToast(null), 2500)
  }

  function deleteDone() {
    const n = cmdDeleteDone()
    setToast(n === 0 ? 'Nothing crossed out' : `Deleted ${n} ${n === 1 ? 'line' : 'lines'}`)
    setTimeout(() => setToast(null), 2500)
  }

  function copyAll() {
    const all = Object.values(rows).filter((r) => r.deletedAt === null && r.parentId === null).map((r) => r.id)
    select(all, all[0] ?? null, all.at(-1) ?? null)
    void cmdCopySelection()
    usePad.setState({ selection: [], anchorId: null, focusId: null })
    setToast('Copied the whole pad as text')
    setTimeout(() => setToast(null), 2500)
  }

  const doneCount = Object.values(rows).filter((r) => r.deletedAt === null && r.done).length
  const lone = visible.length === 1 && rows[visible[0]!.id]!.text === ''

  return (
    <View style={[s.root, { backgroundColor: theme.paper, paddingBottom: kb > 0 ? kb : insets.bottom }]}>
      <View style={s.top}>
        <Text style={[s.title, { color: theme.inkSoft }]}>HissyPad</Text>
        <Pressable onPress={deleteDone} disabled={doneCount === 0} style={s.topBtn}><Text style={[s.topText, { color: doneCount ? theme.inkSoft : theme.inkMute }]}>Delete done</Text></Pressable>
        <Pressable onPress={() => void pasteIn()} style={s.topBtn}><Text style={[s.topText, { color: theme.inkSoft }]}>Paste in</Text></Pressable>
        <Pressable onPress={copyAll} style={s.topBtn}><Text style={[s.topText, { color: theme.inkSoft }]}>Copy all</Text></Pressable>
        {logEnabled() && (
          <Pressable onPress={() => setLogText(dumpLog())} style={s.topBtn}><Text style={[s.topText, { color: theme.inkSoft }]}>Log</Text></Pressable>
        )}
      </View>
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
      {toast && <Text style={[s.toast, { color: theme.inkSoft }]}>{toast}</Text>}
      {load === 'loading' ? (
        <Text style={[s.hint, { color: theme.inkMute }]}>Opening your pad…</Text>
      ) : (
        <GestureDetector gesture={pan}>
          <View ref={container} style={s.scroll} onLayout={() => container.current?.measureInWindow((x, y) => (origin.current = { x, y }))}>
          <ScrollView
            ref={scroller}
            style={s.scroll}
            contentContainerStyle={s.content}
            onScroll={onScroll}
            scrollEventThrottle={16}
            scrollEnabled={!drag}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {displayed.map(({ id, depth, preview }) => (
              <Row
                key={id}
                row={rows[id]!}
                depth={depth}
                childCount={childrenOf(index, id).length}
                editing={editing}
                selected={selectedSet.has(id)}
                number={numbers.get(id) ?? null}
                dragging={preview ? false : (drag?.moving.has(id) ?? false)}
                preview={preview}
                theme={theme}
                onLayout={onRowLayout}
                onBulletLongPress={() => {}}
              />
            ))}
            {lone && (
              <Text style={[s.hint, { color: theme.inkMute }]}>Type anything. Return for a new line, the toolbar for nesting and crossing out. Press and hold a bullet to drag.</Text>
            )}
            <Pressable style={s.tail} onPress={cmdAppendAtEnd} accessibilityLabel="Add a line at the end" />
            <Account theme={theme} />
          </ScrollView>
          </View>
        </GestureDetector>
      )}
      {drag && (
        <View pointerEvents="none" style={[s.ghost, { left: drag.x + 14, top: drag.y - 14, backgroundColor: theme.paperRaised, borderColor: theme.rule }]}>
          <Text numberOfLines={1} style={[s.ghostText, { color: theme.ink }]}>{drag.label}</Text>
        </View>
      )}
      <Toolbar theme={theme} />
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  title: { fontFamily: serif, fontStyle: 'italic', fontSize: 19 },
  topBtn: { minHeight: 32, justifyContent: 'center' },
  topText: { fontFamily: serif, fontSize: 15 },
  toast: { fontFamily: serif, fontStyle: 'italic', fontSize: 14, paddingHorizontal: 16, paddingBottom: 4 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 8, paddingBottom: 24 },
  hint: { fontFamily: serif, fontStyle: 'italic', fontSize: 15, lineHeight: 22, paddingHorizontal: GUTTER + 8, paddingVertical: 8 },
  tail: { height: 56 },
  ghost: { position: 'absolute', zIndex: 10, maxWidth: 260, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  ghostText: { fontFamily: serif, fontSize: 15 },
})
