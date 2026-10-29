import { memo, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type TextInputKeyPressEvent, type TextInputSelectionChangeEvent } from 'react-native'
import type { NodeRow } from '@hissypad/core'
import { clickSelect, edit, usePad, type Editing, cmdBackspaceAtStart, cmdTextChanged } from '@hissypad/state'
import { GUTTER, INDENT, INPUT_SHIFT, LINE, SIZE, serif, type Theme } from '../theme'

interface Props {
  row: NodeRow
  depth: number
  hasChildren: boolean
  editing: Editing | null
  selected: boolean
  number: number | null
  dragging: boolean
  preview: boolean
  theme: Theme
  onLayout: (id: string, e: LayoutChangeEvent) => void
  onBulletLongPress: (id: string, x: number, y: number) => void
}

export const Row = memo(function Row({ row, depth, hasChildren, editing, selected, number, dragging, preview, theme, onLayout, onBulletLongPress }: Props) {
  const isEditing = editing?.id === row.id
  const sel = useRef({ start: 0, end: 0 })
  // Local mirror of the text while editing, so each keystroke renders before the store.
  const [draft, setDraft] = useState(row.text)
  // The caret is placed declaratively: a one-shot controlled `selection` on mount (or when
  // the store asks again via rev), released as soon as the input reports a selection. No
  // imperative calls on a ref that may be mid-unmount.
  const [pendingSel, setPendingSel] = useState<{ start: number; end: number } | undefined>(undefined)
  useEffect(() => {
    if (!isEditing) setDraft(row.text)
  }, [row.text, isEditing])
  useEffect(() => {
    if (!isEditing) return
    // Do not reset the draft here: it is seeded on mount and keystrokes may already have
    // landed by the time this effect runs.
    const pos = editing!.caret === 'end' ? row.text.length : Math.min(editing!.caret, row.text.length)
    setPendingSel({ start: pos, end: pos })
    // Hand the selection back to the native input right after it has been applied; a
    // controlled selection left in place holds back typed text until the next event.
    const t = setTimeout(() => setPendingSel(undefined), 80)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, editing?.rev])

  function onChange(text: string) {
    setDraft(cmdTextChanged(row.id, text))
  }

  function onKeyPress(e: TextInputKeyPressEvent) {
    if (e.nativeEvent.key === 'Backspace' && sel.current.start === 0 && sel.current.end === 0) {
      cmdBackspaceAtStart(row.id)
    }
  }

  function onSelectionChange(e: TextInputSelectionChangeEvent) {
    sel.current = e.nativeEvent.selection
    if (pendingSel) setPendingSel(undefined)
  }

  const bullet = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={selected ? 'Deselect line' : 'Select line'}
      hitSlop={{ top: 0, bottom: 0, left: 12, right: 4 }}
      onPress={() => clickSelect(row.id, { shift: false, meta: false })}
      onLongPress={(e) => onBulletLongPress(row.id, e.nativeEvent.pageX, e.nativeEvent.pageY)}
      delayLongPress={280}
      style={s.bullet}
    >
      {number !== null ? (
        <Text style={[s.num, { color: isEditing ? theme.accent : theme.inkSoft }, row.done && { color: theme.inkMute, textDecorationLine: 'line-through' }]}>{number}.</Text>
      ) : row.header ? (
        <Text style={[s.hash, { color: isEditing ? theme.accent : row.done ? theme.inkMute : theme.inkSoft }, row.done && { textDecorationLine: 'line-through' }]}>#</Text>
      ) : row.done ? (
        <Text style={[s.cross, { color: theme.inkMute }]}>×</Text>
      ) : (
        <View
          style={[
            s.dot,
            { backgroundColor: isEditing ? theme.accent : theme.inkSoft },
            row.text === '' && { backgroundColor: isEditing ? theme.rule : 'transparent' },
            row.collapsed && hasChildren && { borderWidth: 5, borderColor: theme.rule, width: 16, height: 16, borderRadius: 8 },
          ]}
        />
      )}
    </Pressable>
  )

  return (
    <View
      onLayout={(e) => onLayout(row.id, e)}
      style={[s.row, { paddingLeft: depth * INDENT }, selected && { backgroundColor: theme.accentSoft }, dragging && { opacity: 0.35 }, preview && { backgroundColor: theme.accentSoft, opacity: 0.75 }]}
    >
      {bullet}
      {isEditing ? (
        <TextInput
          autoFocus
          selection={pendingSel}
          value={draft}
          multiline
          scrollEnabled={false}
          autoCorrect
          onChangeText={onChange}
          onKeyPress={onKeyPress}
          onSelectionChange={onSelectionChange}
          onBlur={() => {
            if (usePad.getState().editing?.id === row.id) usePad.setState({ editing: null })
          }}
          style={[s.text, s.input, { color: row.done ? theme.inkMute : theme.ink }, row.header && s.bold, row.done && { textDecorationLine: 'line-through', textDecorationColor: theme.accent }]}
          accessibilityLabel="Line text"
        />
      ) : (
        <Pressable style={s.textWrap} onPress={() => edit(row.id, 'end')}>
          <Text style={[s.text, { color: row.done ? theme.inkMute : theme.ink }, row.header && s.bold, row.done && { textDecorationLine: 'line-through', textDecorationColor: theme.accent }]}>
            {row.text === '' ? ' ' : row.text}
          </Text>
        </Pressable>
      )}
    </View>
  )
})

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 4, paddingRight: 8 },
  bullet: { width: GUTTER, minHeight: LINE, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cross: { fontFamily: serif, fontSize: SIZE + 2, lineHeight: LINE },
  hash: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, fontWeight: '700' },
  bold: { fontWeight: '700' },
  num: { fontFamily: serif, fontSize: SIZE - 1, lineHeight: LINE, fontVariant: ['tabular-nums'] },
  textWrap: { flex: 1, minHeight: LINE },
  text: { flex: 1, fontFamily: serif, fontSize: SIZE, lineHeight: LINE, padding: 0, margin: 0, textAlignVertical: 'top' },
  input: { transform: [{ translateY: -INPUT_SHIFT }] },
})
