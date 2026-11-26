// A new item, on Sort's card without the swipe, in a sheet: the + beside Search opens it,
// and so do the widget's + and the Add control (hissypad://add?pad=…, which used to ask
// for one line in a sheet of its own). The line is typed at the top; the pad or sub-pad it
// goes to, its hour and the way to it in its pad are on the card's top row. Under the line
// the sub items are the pad itself, zoomed into the new line (state/create.ts): the same
// rows, toolbar and floating buttons as the pad's. Return in the line or Add keeps it;
// Cancel takes it all back, and so does a line left without a word.
//
// widget.ts calls openCreate from outside React; the sheet is mounted once, in Pad.tsx.
// A + tapped from the home screen arrives while the app is still coming to the front,
// where autoFocus inside a modal fires before the sheet is up: the keyboard showed with
// no field behind it and the typing went nowhere. So the sheet opens once the app is
// active, each ask gets a modal of its own, and the field is focused in onShow.
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { AppState, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { menu } from './Menu'
import { isLive, MAIN_PLACE, slotLabel, todayKey, type Place } from '@hissypad/core'
import {
  cmdAppendAtEnd, cmdCreateBegin, cmdCreateEnd, cmdCreateItem, cmdCreateMove, cmdCreateOpen, cmdCreateSetText, createDefaultPlace, placeFromKey, placeList, placeName, usePad,
  WIDGET_INBOX, WIDGET_MAIN,
} from '@hissypad/state'
import { categoryPrefix, cmdPickCategory, cmdPickSlot, useLineCategory } from '@hissypad/state/hours'
import { useKeyboardHeight } from '../keyboard'
import { serif, type Theme, SHEET_TOP } from '../theme'
import { FloatingButtons } from './FloatingButtons'
import { card, CardField, CardLine } from './Sort'
import { SubRows } from './SubRows'
import { Toolbar } from './Toolbar'
import { HoursIcon, PadIcon } from './TopIcons'
import { LineIcon } from './LineIcons'
import { cmdPickBoomerang, dueWords } from '@hissypad/state'

// `pad` is a widget pad key ('main', 'inbox' or a pad's row id), or null for the pad shown.
// `depth` is the undo stack's length as the sheet opens (cmdCreateBegin), for Cancel.
type Ask = { pad: string | null; seq: number; depth: number }
let seq = 0
let current: Ask | null = null
const listeners = new Set<(a: Ask | null) => void>()

function set(a: Ask | null) {
  current = a
  listeners.forEach((l) => l(a))
}

export function openCreate(pad: string | null = null) {
  const mine = ++seq
  const open = () => set({ pad, seq: mine, depth: cmdCreateBegin() })
  if (AppState.currentState === 'active') return open()
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return
    sub.remove()
    if (mine === seq) open()
  })
}

function useAsk(): Ask | null {
  const [ask, setAsk] = useState<Ask | null>(current)
  useEffect(() => {
    listeners.add(setAsk)
    setAsk(current)
    return () => { listeners.delete(setAsk) }
  }, [])
  return ask
}

// True while the sheet is up: the pad behind it draws no rows and no toolbar then, since
// the sheet draws the same ones (two fields for one line would fight over the keyboard).
export function useCreating(): boolean {
  return useAsk() !== null
}

const oneLine = (t: string) => t.replace(/\r?\n/g, ' ')

// `children` are the pad's hour and category pickers, drawn inside the sheet while it is
// up so they open over it. `onOpen` runs after the pad icon: the app shows the pad.
export function CreateSheet({ theme, onOpen, children }: { theme: Theme; onOpen: () => void; children?: ReactNode }) {
  const ask = useAsk()
  if (!ask) return null
  return <Sheet key={ask.seq} ask={ask} theme={theme} onOpen={onOpen}>{children}</Sheet>
}

function Sheet({ ask, theme, onOpen, children }: { ask: Ask; theme: Theme; onOpen: () => void; children?: ReactNode }) {
  const kb = useKeyboardHeight()
  const all = usePad((st) => st.all)
  const rows = usePad((st) => st.rows)
  const zoomed = usePad((st) => st.zoomId !== null)
  const editing = usePad((st) => st.editing)
  const selection = usePad((st) => st.selection)
  const depth = ask.depth
  const [place, setPlace] = useState<Place>(() => {
    if (ask.pad === null) return createDefaultPlace()
    if (ask.pad === WIDGET_MAIN || ask.pad === WIDGET_INBOX) return MAIN_PLACE
    return placeFromKey(usePad.getState().all, ask.pad) ?? MAIN_PLACE
  })
  // The line's id, in a ref as well as in state: keystrokes can arrive faster than a render,
  // and each one must find the line the first one made instead of making another.
  const [id, setIdState] = useState<string | null>(null)
  const idRef = useRef<string | null>(null)
  const setId = (next: string | null) => {
    idRef.current = next
    setIdState(next)
  }
  const liveId = () => (idRef.current !== null && isLive(usePad.getState().all[idRef.current]) ? idRef.current : null)
  const [draft, setDraft] = useState('')
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const ended = useRef(false)
  const row = id !== null && isLive(all[id]) ? all[id] : null

  // An undo (a shake) can take the line away again: the card goes back to a blank one.
  useEffect(() => {
    if (id !== null && !row) {
      setId(null)
      setDraft('')
    }
  }, [id, row])

  // Whether the line has sub items: the pad's rows while the store is zoomed into it.
  const hasSubs = zoomed && row !== null && Object.keys(rows).length > 0

  // The line, made now if it was not yet (the hour or a sub item before a word is typed).
  function ensure(): string {
    const have = liveId()
    if (have) return have
    const made = cmdCreateItem(place, draft)
    setId(made)
    return made
  }

  function finish(keep: boolean) {
    if (ended.current) return
    ended.current = true
    Keyboard.dismiss()
    cmdCreateEnd(depth, liveId(), keep)
    set(null)
  }

  function seeInPad() {
    if (ended.current || !row) return
    ended.current = true
    Keyboard.dismiss()
    if (cmdCreateOpen(depth, row.id)) onOpen()
    set(null)
  }

  function onText(value: string) {
    const text = oneLine(value)
    const have = liveId()
    if (have) cmdCreateSetText(have, text)
    else if (text.trim() === '') setDraft(text)
    else setId(cmdCreateItem(place, text))
  }

  // Every pad and sub-pad (iOS stacks them).
  function pickPlace() {
    menu('Add to', undefined, [
      ...placeList(all).map((p) => ({
        text: categoryPrefix(p.category) + p.label,
        onPress: () => {
          setPlace({ padId: p.padId, subId: p.subId })
          if (row) cmdCreateMove(row.id, p)
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  const text = row ? row.text : draft
  const slot = row?.slot ?? null
  const due = row?.due ?? null
  const category = useLineCategory(row?.category)
  const can = text.trim() !== '' || hasSubs
  const where = placeName(all, place)

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => finish(true)} onShow={() => input.current?.focus()}>
      {SHEET_TOP > 0 && <View style={{ height: SHEET_TOP, backgroundColor: theme.paper }} />}
      <View style={[s.root, { backgroundColor: theme.paper, paddingBottom: kb }]}>
        <View style={s.head}>
          <Pressable onPress={() => finish(false)} style={s.btn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel" accessibilityHint="Takes it back: nothing is added">
            <Text style={[s.btnText, { color: theme.inkSoft }]}>Cancel</Text>
          </Pressable>
          <Text numberOfLines={1} style={[s.title, { color: theme.ink }]}>New item</Text>
          <Pressable onPress={() => finish(true)} disabled={!can} style={s.btn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Add" accessibilityState={{ disabled: !can }}>
            <Text style={[s.btnText, s.addText, { color: can ? theme.accent : theme.inkMute }]}>Add</Text>
          </Pressable>
        </View>
        <View style={s.scroll}>
        <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View style={[card.card, { backgroundColor: theme.paperRaised, borderColor: theme.rule }]}>
            <View style={card.top}>
              <Pressable onPress={pickPlace} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Goes to ${where}, change`} style={({ pressed }) => [s.place, { opacity: pressed ? 0.5 : 1 }]}>
                <Text numberOfLines={1} style={[s.placeText, { color: theme.inkMute }]}>
                  In <Text style={{ color: theme.ink, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: theme.inkMute }}>{where}</Text> ▾
                </Text>
              </Pressable>
              {slot && <Text style={[card.slot, { color: theme.inkSoft, borderColor: theme.rule }]}>{slotLabel(slot, todayKey())}</Text>}
              {due && <Text style={[card.slot, { color: theme.inkSoft, borderColor: theme.rule }]}>Out until {dueWords(due)}</Text>}
              <Pressable
                onPress={() => cmdPickSlot([ensure()])}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={slot ? `Hour: ${slotLabel(slot, todayKey())}, change` : 'Put in an hour'}
                style={({ pressed }) => [card.hour, { opacity: pressed ? 0.5 : 1 }]}
              >
                <HoursIcon color={theme.inkSoft} />
              </Pressable>
              {/* The floating buttons' order: hour, category, boomerang, move; the pad icon last. */}
              <Pressable
                onPress={() => cmdPickCategory([ensure()])}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Give a category"
                style={({ pressed }) => [card.hour, { opacity: pressed ? 0.5 : 1 }]}
              >
                <LineIcon icon="category" color={theme.inkSoft} ground={theme.paperRaised} />
              </Pressable>
              {/* Out until a later day from the start: the sheet stays up, the line is under Later. */}
              <Pressable
                onPress={() => cmdPickBoomerang([ensure()])}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={due ? `Out until ${dueWords(due)}, change` : 'Boomerang: send out until a later day'}
                style={({ pressed }) => [card.hour, { opacity: pressed ? 0.5 : 1 }]}
                >
                <LineIcon icon="boomerang" color={theme.inkSoft} ground={theme.paperRaised} />
                </Pressable>
              {/* The same choice as "In" at the left, where the pad's own buttons have it. */}
              <Pressable
                onPress={pickPlace}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Move to another pad or a sub-pad"
                style={({ pressed }) => [card.hour, { opacity: pressed ? 0.5 : 1 }]}
              >
                <LineIcon icon="move" color={theme.inkSoft} ground={theme.paperRaised} />
              </Pressable>
              <Pressable
                onPress={seeInPad}
                disabled={!row || !can}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="See it in the pad"
                accessibilityHint="Adds it and goes to it in its pad"
                style={({ pressed }) => [card.hour, { opacity: !row || !can ? 0.4 : pressed ? 0.5 : 1 }]}
              >
                <PadIcon color={theme.inkSoft} />
              </Pressable>
            </View>
            <CardLine category={category} onCategory={() => cmdPickCategory([ensure()])}>
              <CardField
                ref={input}
                value={text}
                onChangeText={onText}
                multiline
                scrollEnabled={false}
                autoCapitalize="sentences"
                submitBehavior="blurAndSubmit"
                returnKeyType="done"
                enablesReturnKeyAutomatically
                // Return passes the field's own text: the last keystrokes (or the word
                // autocorrect fixes on return) can reach the field a moment before the store.
                onSubmitEditing={(e) => {
                  const last = oneLine(e.nativeEvent.text)
                  if (last !== text) onText(last)
                  if (last.trim() !== '' || hasSubs) finish(true)
                }}
                placeholder="A new line"
                placeholderTextColor={theme.inkMute}
                accessibilityLabel="Line text"
                style={[card.text, card.lineText, { color: theme.ink }]}
              />
            </CardLine>
            <View style={[card.subs, { borderTopColor: theme.rule }]}>
              <SubRows id={row?.id ?? null} theme={theme} onAdd={() => { ensure(); cmdAppendAtEnd() }} />
            </View>
          </View>
        </ScrollView>
        {/* The pad's own floating buttons and toolbar, for the sub item being typed or the
            ones selected. With nothing targeted neither shows: this sheet has its own +. */}
        {(editing || selection.length > 0) && <FloatingButtons theme={theme} />}
        </View>
        <Toolbar theme={theme} />
        {children}
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 8, paddingHorizontal: 16 },
  title: { flex: 1, textAlign: 'center', fontFamily: serif, fontSize: 17, fontWeight: '600' },
  btn: { minHeight: 44, minWidth: 56, justifyContent: 'center' },
  btnText: { fontFamily: serif, fontSize: 16 },
  addText: { textAlign: 'right', fontWeight: '600' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 96 },
  place: { flexShrink: 1, marginRight: 'auto' },
  placeText: { fontFamily: serif, fontSize: 14 },
})
