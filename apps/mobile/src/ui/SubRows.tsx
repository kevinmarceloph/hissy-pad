// The sub items of one line, as the pad's own rows: the store is zoomed into that line
// (`zoomTo`), so `rows` is what is under it and the pad's commands, toolbar and floating
// buttons work on it. Sort's card and the new item's sheet both draw this under the line.
// An open hour in Hours draws it too (`slot`): the store shows that hour (`openSlot`), so
// `rows` is the lines put in it and what is under them.
// No drag here: the toolbar's arrows move a line.
import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { buildIndex, childrenOf, countLines, descendantIds, flatten, homeNumbers, listNumbers } from '@hissypad/core'
import { usePad, visibleIds } from '@hissypad/state'
import { serif, type Theme } from '../theme'
import { Row } from './Row'

const noop = () => {}

// `id` is the line whose sub items these are, or null when it is not made yet; `slot` is
// the hour whose lines these are instead. `onAdd` opens a new blank sub item at the end
// (the caller makes or zooms into the line first); without it there is no button for one.
export function SubRows({ id = null, slot = null, theme, onAdd }: { id?: string | null; slot?: string | null; theme: Theme; onAdd?: () => void }) {
  const rows = usePad((st) => st.rows)
  const zoomed = usePad((st) => (slot !== null ? st.slotId === slot : id !== null && st.zoomId === id))
  const editing = usePad((st) => st.editing)
  const selection = usePad((st) => st.selection)
  const subs = zoomed ? rows : null
  // In an hour the lines are lifted out of their lists: their numbers are the ones they have at home.
  const home = usePad((st) => (slot !== null && st.slotId === slot ? st.all : null))
  const { index, visible, numbers } = useMemo(() => {
    const index = buildIndex(subs ?? {})
    const depthOf = new Map(flatten(index, true).map((r) => [r.id, r.depth]))
    const ids = subs ? visibleIds({ ...usePad.getState(), rows: subs }) : []
    return { index, visible: ids.map((v) => ({ id: v, depth: depthOf.get(v) ?? 0 })), numbers: home ? homeNumbers(home) : listNumbers(index) }
  }, [subs, home])
  const selectedSet = useMemo(() => new Set(selection), [selection])
  const selectedChildSet = useMemo(() => {
    const out = new Set<string>()
    for (const sel of selection) for (const d of descendantIds(index, sel)) if (!selectedSet.has(d)) out.add(d)
    return out
  }, [selection, selectedSet, index])

  return (
    <View>
      {subs && visible.map(({ id: sub, depth }) => (
        <Row
          key={sub}
          row={subs[sub]!}
          depth={depth}
          childCount={childrenOf(index, sub).length}
          foldCount={countLines(childrenOf(index, sub))}
          editing={editing}
          selected={selectedSet.has(sub)}
          selectedChild={selectedChildSet.has(sub)}
          number={numbers.get(sub) ?? null}
          dragging={false}
          preview={false}
          theme={theme}
          onLayout={noop}
          onBulletLongPress={noop}
          inSlot={slot}
        />
      ))}
      {onAdd && (
        <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add a sub item" style={({ pressed }) => [s.add, { opacity: pressed ? 0.5 : 1 }]}>
          <Text style={[s.addPlus, { color: theme.inkMute }]}>+</Text>
          <Text style={[s.addWords, { color: theme.inkMute }]}>Add a sub item</Text>
        </Pressable>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  add: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
  addPlus: { width: 36, textAlign: 'center', fontFamily: serif, fontSize: 17 },
  addWords: { fontFamily: serif, fontStyle: 'italic', fontSize: 16 },
})
