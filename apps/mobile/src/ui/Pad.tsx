// The pad screen: a scroll view of visible rows, the toolbar above the keyboard, and drag
// via a long press on a bullet. Drop resolution is core's resolveDrop over the rows'
// measured layouts; this file only measures and draws.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Animated, Keyboard, LayoutAnimation, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { menu } from './Menu'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import { buildIndex, childrenOf, countLines, descendantIds, dueHeads, flatten, homeNumbers, listNumbers, pinDivider, scheduleHead, scopeCategory, moveNodes, resolveDrop, topmost, type DropTarget, type LayoutRow } from '@hissypad/core'
import { apply, categoryShown, closeCategory, cmdApplyBoomerang, setBoomerangPickerOpener, targetDue, clearSelection, cmdAddAt, cmdAppendAtEnd, cmdDeleteDone, clearLog, dumpLog, logEnabled, paintSelect, refresh, resumeEditing, select, setSortMode, stopEditing, todayShown, usePad, visibleIds } from '@hissypad/state'
import { GUTTER, INDENT, LINE, serif, useTheme, SHEET_TOP } from '../theme'
import { Row } from './Row'
import { Toolbar } from './Toolbar'
import { FloatingButtons } from './FloatingButtons'
import { Account } from './Account'
import { DoneSheet } from './Lists'
import { ArchiveView } from './Archive'
import { SortView } from './Sort'
import { SubRows } from './SubRows'
import { BoomerangPicker, CategoriesApp, CategoryPicker, HoursApp, SlotPicker } from '@hissypad/ui'
import { CategoryHead, DueHead, ScheduledHead } from './Boomerangs'
import {
  cmdAddCategory, cmdApplyCategory, cmdApplySlot, openHours, setCategoryPickerOpener, setSlotFinder, setSlotPickerOpener, targetCategory, targetSlot, targetsHaveCategory, useCategoryChoices,
  cmdOpenCategories,
} from '@hissypad/state/hours'
import { SearchSheet } from './Search'
import { CategoryChips, PadChips } from './PadChips'
import { BottomNav, type Mode } from './TopIcons'
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
// How near the list's top or bottom a drag starts it scrolling.
const EDGE = 56
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
  // An hour is open in Hours: `rows` is that hour's lines, drawn there by SubRows.
  const hourOpen = usePad((s) => s.slotId !== null)
  // A category's view: the first line of each pad's group, where the pad's name is drawn.
  const catHeads = usePad((s) => {
    const cat = categoryShown(s)
    return cat === null ? null : scopeCategory(s.all, cat).heads
  })
  // There the lines over a line may have siblings left out: a numbered line's number is the one it has in its pad.
  const home = usePad((s) => (categoryShown(s) !== null ? s.all : null))
  const load = usePad((s) => s.load)
  const session = usePad((s) => s.session)
  const padId = usePad((s) => s.padId)
  // The new item's sheet is up: it draws the pad's rows and toolbar itself (zoomed into the
  // new line), so this screen draws neither behind it.
  const creating = useCreating()
  // While the store is zoomed into one line (Sort's card, the new item's), `rows` is what is
  // under that line and the editing belongs to the card. The same while Hours has an hour open. This list, behind the sheet or
  // hidden under Sort, keeps the pad as it last was, with nothing being edited: a second
  // field for the same line would fight the card's for the keyboard, and the list keeps its place.
  const quiet = creating || zoomed || hourOpen
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
  // Pad, Hours, Categories or Sort: the switcher in the top bar. The pad stays mounted under the other
  // ones, so it is where it was left on the way back (Categories draws its lines with it).
  const [mode, setMode] = useState<Mode>('hours')
  const [sheet, setSheet] = useState<'done' | 'search' | 'categories' | null>(null)
  // The hour Search was opened for (Hours' search button), or null for a search that goes to the line.
  const [assign, setAssign] = useState<string | null>(null)
  // The Archive: a screen that is no mode, over whichever mode is open. `id` is the line it
  // opens at (an archived line picked in Search); `rev` makes a second trip scroll again.
  const [archive, setArchive] = useState<{ id: string | null; rev: number } | null>(null)
  const screen = archive ? 'archive' : mode
  // Sort keeps a pad of its own: the store swaps to it in Sort and back out of it.
  useEffect(() => { if (load === 'ready') setSortMode(screen === 'sort') }, [screen, load])
  // Categories shows a category in place of the pad (the store's catId), drawn by the same
  // list: one is opened on the way in, after Sort has given the pad back, and closed on the way out.
  const catId = usePad((s) => s.catId)
  useEffect(() => {
    if (load !== 'ready') return
    if (screen === 'category') cmdOpenCategories()
    else closeCategory()
  }, [screen, load])
  // Opening a pad from there (a pad's heading over its lines) ends the category's view: the
  // mode follows it to the Pad.
  const shownMode = useRef(mode)
  shownMode.current = mode
  useEffect(() => usePad.subscribe((st, was) => {
    if (was.catId !== null && st.catId === null && shownMode.current === 'category') setMode('pad')
  }), [])
  // The pad's list is on screen: in the Pad mode, and in Categories once a category is open.
  const padShown = screen === 'pad' || (screen === 'category' && catId !== null)
  // The hour picker the toolbar's "Hour…" (behind More) opens.
  const [picking, setPicking] = useState<{ value: string | null; count: number } | null>(null)
  // The same for "Category…".
  const [categorizing, setCategorizing] = useState<{ value: string | null; hasAny: boolean; count: number } | null>(null)
  // And for the floating Boomerang button: the day the lines are out until, if they are.
  const [sending, setSending] = useState<{ value: string | null; count: number } | null>(null)
  const categoryChoices = useCategoryChoices()
  useEffect(() => {
    // Hours' rows are opened with the pad: a line's category icon comes from its list.
    void openHours()
    setSlotPickerOpener((ids) => setPicking({ value: targetSlot(ids), count: ids.length }))
    // An hour's search button in Hours: Search, opened to put the line found in that hour.
    setSlotFinder((slot) => { setAssign(slot); setSheet('search') })
    setCategoryPickerOpener((ids) => setCategorizing({ value: targetCategory(ids), hasAny: targetsHaveCategory(ids), count: ids.length }))
    setBoomerangPickerOpener((ids) => setSending({ value: targetDue(ids), count: ids.length }))
    return () => {
      setSlotPickerOpener(null)
      setSlotFinder(null)
      setCategoryPickerOpener(null)
      setBoomerangPickerOpener(null)
    }
  }, [])

  const { index, visible, numbers } = useMemo(() => {
    const index = buildIndex(rows)
    const ids = visibleIds({ ...usePad.getState(), rows })
    const depth = new Map<string, number>()
    for (const r of flatten(index, true)) depth.set(r.id, r.depth)
    return { index, visible: ids.map((id) => ({ id, depth: depth.get(id) ?? 0 })), numbers: home ? homeNumbers(home) : listNumbers(index) }
  }, [rows, home])
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
  // The rule under the pinned lines: in a pad as itself, not in an open hour.
  const pinEnd = useMemo(() => (hourOpen || catHeads ? null : pinDivider(displayed, rows)), [hourOpen, catHeads, displayed, rows])
  // In Later: a heading before each day's group of lines out on a boomerang.
  const heads = useMemo(() => (hourOpen || catHeads ? new Map<string, string>() : dueHeads(displayed, rows)), [hourOpen, catHeads, displayed, rows])
  const firstHead = heads.keys().next().value
  // In Today: a heading before the lines with an hour, which sit under the pad's own.
  const isToday = usePad(todayShown)
  const scheduled = useMemo(() => (hourOpen || !isToday ? null : scheduleHead(displayed, rows)), [hourOpen, isToday, displayed, rows])

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
    edgeScroll(y, () => { const dd = dragRef.current; if (dd) updateDrag(dd.x, dd.y) })
  }, [])

  // Near the top or bottom of the list, a drag (or a swipe selecting bullets) keeps the list
  // scrolling for as long as the finger stays there, faster the closer it is, and re-aims
  // after each step, so a line can be dropped past what is on screen.
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const edgeScroll = useCallback((absY: number, again: () => void) => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = null
    const top = origin.current.y
    const bottom = top + viewH.current
    const step = absY < top + EDGE ? -Math.ceil((top + EDGE - absY) / 3) : absY > bottom - EDGE ? Math.ceil((absY - (bottom - EDGE)) / 3) : 0
    if (!step) return
    const max = Math.max(0, contentH.current - viewH.current)
    const next = Math.min(max, Math.max(0, scrollY.current + step))
    if (next === scrollY.current) return
    scrollY.current = next
    scroller.current?.scrollTo({ y: next, animated: false })
    scrollTimer.current = setTimeout(() => { scrollTimer.current = null; again() }, 16)
  }, [])
  const stopEdgeScroll = () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = null
  }

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
    stopEdgeScroll()
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
      stopEdgeScroll()
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
  // row under the press is found from the measured layouts. Off while a line is being edited
  // (Kevin, 2026-11-27): a press and hold there moves the caret or selects text, never a line.
  const isEditing = usePad((st) => st.editing !== null)
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isEditing)
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
          if (hit && x < GUTTER + INDENT * 6 && !dragRef.current && !usePad.getState().editing) {
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
    [beginDrag, updateDrag, endDrag, isEditing],
  )

  // With lines selected, a quick swipe up or down the bullets (no hold: a hold is the drag
  // above) selects the lines it passes (paintSelect). The touch has to start on a bullet;
  // anywhere else it is left to the scroll view.
  const rowAtY = useCallback((absY: number): string | null => {
    const y = absY - origin.current.y + scrollY.current
    const vis = visibleIds()
    let last: string | null = null
    for (const id of vis) {
      const b = layouts.current.get(id)
      if (!b) continue
      if (y < b.y + b.height) return id
      last = id
    }
    return last
  }, [])
  const painting = useRef<{ from: string; base: string[]; x: number; y: number } | null>(null)
  const paint = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .runOnJS(true)
        .onTouchesDown((e, mgr) => {
          const t = e.changedTouches[0]
          const st = usePad.getState()
          if (!t || st.selection.length === 0 || st.editing || dragRef.current) return mgr.fail()
          const id = rowAtY(t.absoluteY)
          const depth = id ? (flatten(buildIndex(st.rows), true).find((r) => r.id === id)?.depth ?? 0) : 0
          const x = t.absoluteX - origin.current.x - 8 - depth * INDENT
          if (!id || x < -8 || x > GUTTER + 8) return mgr.fail()
          painting.current = { from: id, base: [...st.selection], x: t.absoluteX, y: t.absoluteY }
          // Hold the list still while it is decided: a swipe here selects, it does not scroll.
          scroller.current?.setNativeProps({ scrollEnabled: false })
        })
        .onTouchesMove((e, mgr) => {
          const t = e.changedTouches[0]
          const p = painting.current
          if (!t || !p) return mgr.fail()
          const dx = t.absoluteX - p.x
          const dy = t.absoluteY - p.y
          if (Math.hypot(dx, dy) < 8) return
          if (Math.abs(dy) > Math.abs(dx)) mgr.activate()
          else mgr.fail()
        })
        .onStart(() => { void Haptics.selectionAsync() })
        .onUpdate((e) => {
          const step = (absY: number) => {
            const p = painting.current
            const to = p && rowAtY(absY)
            if (p && to) paintSelect(p.base, p.from, to)
            if (p) edgeScroll(absY, () => step(absY))
          }
          step(e.absoluteY)
        })
        .onFinalize(() => {
          stopEdgeScroll()
          painting.current = null
          scroller.current?.setNativeProps({ scrollEnabled: true })
        }),
    [rowAtY, edgeScroll],
  )
  const gestures = useMemo(() => Gesture.Race(pan, paint), [pan, paint])

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
    // From the Archive, a tap on any mode goes there, the one it was opened over included.
    setArchive(null)
    if (next === mode) return
    stopEditing()
    Keyboard.dismiss()
    setMode(next)
  }

  // The pad's selection is dropped on the way: its toolbar is not the Archive's.
  function openArchive(id: string | null) {
    stopEditing()
    clearSelection()
    Keyboard.dismiss()
    setArchive((was) => ({ id, rev: (was?.rev ?? 0) + 1 }))
  }

  // The hamburger: the lists that are looked at now and then.
  function openMenu() {
    stopEditing()
    menu('HissyPad', undefined, [
      { text: 'New item', onPress: () => openCreate() },
      { text: 'Search', onPress: () => { setAssign(null); setSheet('search') } },
      { text: 'Done', onPress: () => setSheet('done') },
      { text: 'Archive', onPress: () => openArchive(null) },
      { text: 'Categories', onPress: () => setSheet('categories') },
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
      {/* The hour picker is a sheet of our own at the bottom, not iOS's page sheet: that one
          follows a finger that moves down or up, and took the swipe from the hours as soon
          as it crossed from one row of them to the next (Kevin, 2026-11-25). A tap on the
          dimmed pad above it cancels. */}
      <Modal visible={picking !== null} animationType="fade" transparent onRequestClose={() => setPicking(null)} onDismiss={resumeEditing}>
        <Pressable accessibilityLabel="Cancel" onPress={() => setPicking(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <View style={{ backgroundColor: theme.paper, paddingTop: 4, paddingBottom: insets.bottom }}>
          {picking && (
            <SlotPicker
              value={picking.value}
              count={picking.count}
              onCancel={() => setPicking(null)}
              onOpenTemplate={() => {
                setPicking(null)
                setArchive(null)
                setMode('pad')
              }}
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
      <Modal visible={sending !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSending(null)} onDismiss={resumeEditing}>
        {SHEET_TOP > 0 && <View style={{ height: SHEET_TOP, backgroundColor: theme.paper }} />}
        <ScrollView style={{ flex: 1, backgroundColor: theme.paper }} contentContainerStyle={{ paddingTop: 12 }}>
          {sending && (
            <BoomerangPicker
              value={sending.value}
              count={sending.count}
              onCancel={() => setSending(null)}
              onPick={(due, today) => {
                const said = cmdApplyBoomerang(due, today)
                setSending(null)
                if (!said) return
                setToast(said)
                setTimeout(() => setToast(null), 2500)
              }}
            />
          )}
        </ScrollView>
      </Modal>
      <Modal visible={categorizing !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCategorizing(null)} onDismiss={resumeEditing}>
        {SHEET_TOP > 0 && <View style={{ height: SHEET_TOP, backgroundColor: theme.paper }} />}
        <View style={{ flex: 1, backgroundColor: theme.paper, paddingTop: 12 }}>
          {categorizing && (
            <CategoryPicker
              categories={categoryChoices}
              value={categorizing.value}
              hasAny={categorizing.hasAny}
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
    <View style={[s.root, { backgroundColor: theme.paper, paddingBottom: kb > 0 ? kb : insets.bottom }]}>
      {/* The pad chips are the pad's only: Sort picks its pad in its own title. */}
      {screen === 'pad' && <PadChips theme={theme} />}
      {screen === 'category' && <CategoryChips theme={theme} />}
      {screen === 'category' && catId === null && load === 'ready' && <Text style={[s.hint, { color: theme.inkMute }]}>No categories yet. Make one from the menu's Categories, or from Category… on a line's toolbar.</Text>}
      {/* The pad's status line: the toast on the left, Archive x completed flush right. It keeps
          its height when both are empty, so neither one pushes the pad down when it shows up. */}
      {padShown && (
        <View style={s.status}>
          <Text style={[s.statusToast, { color: theme.inkSoft }]} numberOfLines={1} accessibilityLiveRegion="polite">{toast ?? ''}</Text>
          {doneCount > 0 && screen === 'pad' && (
            <Pressable onPress={deleteDone} style={s.clear} hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="button" accessibilityLabel={`Archive ${doneCount} completed`} accessibilityHint="Archives every crossed-out line in this pad. Shake to undo.">
              <Text style={[s.clearText, { color: theme.inkMute }]}>Archive {doneCount} completed</Text>
            </Pressable>
          )}
        </View>
      )}
      <Modal visible={logText !== null} animationType="slide" onRequestClose={() => setLogText(null)}>
        {SHEET_TOP > 0 && <View style={{ height: SHEET_TOP, backgroundColor: theme.paper }} />}
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
      {!creating && pickers}
      <CreateSheet theme={theme} onOpen={() => { setArchive(null); setMode('pad') }}>{pickers}</CreateSheet>
      <Modal visible={sheet === 'categories'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
        {SHEET_TOP > 0 && <View style={{ height: SHEET_TOP, backgroundColor: theme.paper }} />}
        <View style={{ flex: 1, backgroundColor: theme.paper, paddingTop: 12 }}>
          {sheet === 'categories' && <CategoriesApp onClose={() => setSheet(null)} />}
        </View>
      </Modal>
      <SearchSheet visible={sheet === 'search'} assign={assign} onClose={() => { setSheet(null); setAssign(null) }} onOpen={() => { setArchive(null); setMode('pad') }} onArchived={openArchive} theme={theme} />
      <DoneSheet visible={sheet === 'done'} onClose={() => setSheet(null)} theme={theme} />
      {toast && !padShown && screen !== 'archive' && <Text style={[s.toast, { color: theme.inkSoft }]}>{toast}</Text>}
      {/* Hours: the shared screens (packages/ui). Sort starts over when the pad changes. */}
      {screen === 'archive' && archive && <ArchiveView at={archive.id ? { id: archive.id, rev: archive.rev } : null} onClose={() => setArchive(null)} theme={theme} bottom={0} />}
      {screen === 'hours' && (
        <View style={s.scroll}>
          {/* An open hour's lines are the pad's own rows (the store shows that hour), so
              the toolbar and the floating buttons below act on them. */}
          <HoursApp renderLines={({ slot }) => <SubRows slot={slot} theme={theme} />} />
          {hourOpen && !creating && (liveEditing !== null || liveSelection.length > 0) && <FloatingButtons theme={theme} />}
        </View>
      )}
      {screen === 'sort' && <SortView key={padId ?? 'main'} theme={theme} paused={creating} onOpen={() => setMode('pad')} />}
      {load === 'loading' ? (
        screen === 'pad' && <Text style={[s.hint, { color: theme.inkMute }]}>Opening your pad…</Text>
      ) : (
        // Keyed on whether the pad shows: a view under display: none has no native view, so
        // the detector attached at launch (the app opens on Hours) held on to nothing and no
        // drag reached the pad, its bullets or the floating + (Kevin, 2026-11-25). A fresh
        // detector each time the pad shows attaches to the views that are there.
        <GestureDetector key={padShown ? 'pad' : 'off'} gesture={gestures}>
          <View ref={container} style={padShown ? s.scroll : s.hidden} onLayout={() => container.current?.measureInWindow((x, y) => (origin.current = { x, y }))}>
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
              {heads.has(id) && <DueHead due={heads.get(id)!} first={id === firstHead} theme={theme} />}
              {id === scheduled && <ScheduledHead theme={theme} />}
              {catHeads?.has(id) && <CategoryHead padId={catHeads.get(id)!} theme={theme} />}
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
              {id === pinEnd && <View style={s.pinDivider} accessibilityRole="none" accessibilityLabel="Pinned lines end here"><View style={[s.pinRule, { backgroundColor: theme.rule }]} /></View>}
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
      {/* The line toolbar: the pad's, Sort's for the sub items on its card, and Hours' for
          the lines of the open hour. */}
      {!creating && <Toolbar theme={theme} />}
      {/* The bottom nav: the modes and the menu. Away while the keyboard is up, so the
          toolbar sits on the keyboard as before. */}
      {kb === 0 && <BottomNav mode={archive ? null : mode} onMode={switchMode} onMenu={openMenu} theme={theme} />}
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 }, // the debug log's title row
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
  pinDivider: { height: LINE / 2, justifyContent: 'center', paddingLeft: GUTTER }, // under the pinned lines
  pinRule: { height: StyleSheet.hairlineWidth * 2 },
  tail: { height: 56 },
  // The pull-to-sync line: clipped to the list, so it comes out from behind the top edge.
  pullClip: { position: 'absolute', top: 0, left: 0, right: 0, height: 44, overflow: 'hidden', alignItems: 'center', zIndex: 6 },
  pull: { paddingHorizontal: 13, paddingVertical: 5, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderTopWidth: 0 },
  pullText: { fontFamily: serif, fontStyle: 'italic', fontSize: 15 },
  ghost: { position: 'absolute', zIndex: 10, maxWidth: 260, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  ghostText: { fontFamily: serif, fontSize: 15 },
})
