// The pads as a row of chips under the title. Today, Inbox and Later come first, each with
// its icon, and stay put: no rename, move, fold or delete. Tap to open a pad; tap the open
// one (or press and hold any other) to rename, move, fold into another pad or delete it; the chevron beside a
// pad that has sub-pads jumps to one; the + chip makes a new pad. Names are asked for
// with askText (Menu.tsx): the system's prompt on iOS, our own on Android.
import { useEffect, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { askText, menu } from './Menu'
import { categoryCounts, NO_CATEGORY, type FixedPad, type PadId } from '@hissypad/core'
import { cmdDeletePad, cmdMovePad, cmdNewPad, cmdPadToLine, cmdRenamePad, cmdSetPadCategory, cmdSetPadCount, openCategory, openPad, openSubPad, subName, padList, padTopLines, placeList, usePad, type PadItem } from '@hissypad/state'
import { categoryPrefix, cmdOpenCategories, lineCategories, useCategoryChoices, useLineCategory } from '@hissypad/state/hours'
import { CategoryBadge } from '@hissypad/ui'
import { activeCategories, categoryName } from '@hissypad/core/hours'
import { serif, type Theme } from '../theme'
import { CalendarIcon, HoursIcon, PlusIcon } from './TopIcons'
import { LineIcon } from './LineIcons'

// Today is the day (Hours' clock), Inbox is what is still to sort (Sort's tray), Later is
// the calendar. Drawn at 0.8 of the toolbar size, beside the name.
function FixedIcon({ pad, color, ground }: { pad: FixedPad; color: string; ground: string }) {
  return (
    <View style={s.glyph}>
      {pad === 'Today' ? <HoursIcon color={color} /> : pad === 'Later' ? <CalendarIcon color={color} /> : <LineIcon icon="move" color={color} ground={ground} />}
    </View>
  )
}

function ask(title: string, message: string | undefined, initial: string, onName: (name: string) => void) {
  askText(title, message, initial, onName)
}

export function PadChips({ theme }: { theme: Theme }) {
  const all = usePad((s) => s.all)
  const padId = usePad((s) => s.padId)
  const shown = (p: PadItem) => p.countShown
  const pads = useMemo(() => padList(all), [all])

  function manage(id: string, name: string) {
    const lines = padTopLines(all, id)
    const i = pads.findIndex((p) => p.id === id)
    const first = pads.findIndex((p) => !p.fixed && p.id !== null)
    menu(name, undefined, [
      ...(i > first ? [{ text: '← Move left', onPress: () => void cmdMovePad(id, -1) }] : []),
      ...(i >= 0 && i < pads.length - 1 ? [{ text: 'Move right →', onPress: () => void cmdMovePad(id, 1) }] : []),
      { text: 'Rename…', onPress: () => ask('Rename pad', undefined, name, (n) => cmdRenamePad(id, n)) },
      // A category every line moved into this pad takes.
      {
        text: 'Category…',
        onPress: () =>
          menu(`Category for “${name}”`, 'Every line moved into this pad takes it.', [
            { text: all[id]?.category ? 'None' : 'None ✓', onPress: () => cmdSetPadCategory(id, null) },
            ...activeCategories(lineCategories.getState().list).map((c) => ({ text: `${categoryName(c)}${all[id]?.category === c.id ? ' ✓' : ''}`, onPress: () => cmdSetPadCategory(id, c.id) })),
            { text: 'Cancel', style: 'cancel' as const },
          ]),
      },
      // The count of open lines on this pad's tab, on or off for this pad only.
      { text: all[id]?.countHidden ? 'Show the count on this tab' : 'Hide the count on this tab', onPress: () => cmdSetPadCount(id, all[id]?.countHidden === true) },
      {
        // The opposite of Make pad: the pad becomes a line at the top of the pad picked.
        text: 'Fold into…',
        onPress: () =>
          menu(`Fold “${name}” into`, 'It becomes a line there, with its lines under it.', [
            ...placeList(all).filter((p) => p.padId !== id).map((p) => ({ text: categoryPrefix(p.category) + p.label, onPress: () => void cmdPadToLine(id, p) })),
            { text: 'Cancel', style: 'cancel' as const },
          ]),
      },
      {
        text: 'Archive pad',
        style: 'destructive',
        onPress: () =>
          menu(`Archive “${name}”?`, lines ? `Its ${lines} top-level ${lines === 1 ? 'line goes' : 'lines go'} too, with everything under them.` : 'It is empty.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Archive', style: 'destructive', onPress: () => cmdDeletePad(id) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  // The chevron beside a pad that has sub-pads (its top-level headers): pick one to jump to.
  function jump(p: PadItem) {
    menu(p.name, 'Jump to a sub-pad', [
      ...p.subs.map((sp) => ({ text: categoryPrefix(sp.category) + (shown(p) && sp.count > 0 ? `${sp.name}  ${sp.count}` : sp.name), onPress: () => void openSubPad(sp.id) })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  function tap(id: PadId, name: string, fixed: boolean) {
    if (id === padId) {
      if (id !== null && !fixed) manage(id, name)
      return
    }
    openPad(id)
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.strip} contentContainerStyle={s.inner}>
      {pads.map((p, i) => {
        const on = p.id === padId
        const after = i > 0 && pads[i - 1]!.fixed !== null && p.fixed === null
        return (
          <View key={p.id ?? 'main'} style={[s.tab, after && { marginLeft: 10 }]}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.name}
              onPress={() => tap(p.id, p.name, p.fixed !== null)}
              onLongPress={() => p.id !== null && !p.fixed && manage(p.id, p.name)}
              style={[s.chip, (p.fixed || p.category) && s.fixedChip, { borderBottomColor: on ? theme.accent : 'transparent' }]}
            >
              {p.fixed && <FixedIcon pad={p.fixed} color={on ? theme.ink : theme.inkSoft} ground={theme.paper} />}
              <ChipCategory id={p.category} />
              <Text style={[s.chipText, { color: on ? theme.ink : theme.inkSoft }]} numberOfLines={1}>
                {p.name}
                {shown(p) && p.count > 0 && <Text style={[s.chipCount, { color: theme.inkMute }]}>{'  '}{p.count}</Text>}
              </Text>
            </Pressable>
            {p.subs.length > 0 && (
              <Pressable accessibilityRole="button" accessibilityLabel={`Sub-pads of ${p.name}`} onPress={() => jump(p)} hitSlop={{ top: 4, bottom: 4, right: 6 }} style={s.subs}>
                <View style={[s.chevron, { borderColor: theme.inkMute }]} />
              </Pressable>
            )}
          </View>
        )
      })}
    </ScrollView>
  )
}

// The Pad mode's two buttons at the right of the top row: jump to any pad or sub-pad (for
// when the chips run past the edge), and a new pad.
export function PadTools({ theme }: { theme: Theme }) {
  const all = usePad((st) => st.all)
  const jump = () =>
    menu('Jump to', undefined, [
      ...placeList(all).map((p) => ({
        text: categoryPrefix(p.category) + (p.count > 0 ? `${p.label}  ${p.count}` : p.label),
        onPress: () => { if (p.subId) openSubPad(p.subId); else openPad(p.padId) },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  return (
    <View style={s.tools}>
      <Pressable accessibilityRole="button" accessibilityLabel="Jump to any pad or sub-pad" onPress={jump} style={s.tool}>
        <View style={[s.chevron, { borderColor: theme.inkSoft, width: 9, height: 9 }]} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="New pad" onPress={() => ask('New pad', 'A name for it', '', (n) => cmdNewPad(n))} style={s.tool}>
        <PlusIcon color={theme.inkSoft} />
      </Pressable>
    </View>
  )
}

// The Categories mode's dropdown, at the right of the top row: the open
// category (its mark, its name, how many lines are in it), and a tap lists them all, with
// "No category" last: the lines that have none. The open one's lines, from every pad, are
// the pad drawn under it (the store's catId, scopeCategory in core). The same as the web's CategoryTabs.
export function CategoryChips({ theme }: { theme: Theme }) {
  const all = usePad((st) => st.all)
  const catId = usePad((st) => st.catId)
  const load = usePad((st) => st.load)
  const categories = useCategoryChoices()
  const shown = useLineCategory(catId)
  const counts = useMemo(() => categoryCounts(all), [all])
  // The categories can arrive after the mode is open (they load with Hours' store).
  useEffect(() => {
    if (catId === null && load === 'ready' && categories.length > 0) cmdOpenCategories()
  }, [catId, load, categories.length])
  if (categories.length === 0 && catId === null) return null
  const none = catId === NO_CATEGORY
  const n = catId === null ? 0 : (counts.get(catId) ?? 0)
  const withCount = (label: string, id: string) => (counts.get(id) ? `${label}  ${counts.get(id)}` : label)
  const pick = () =>
    menu('Category', undefined, [
      ...categories.map((c) => ({ text: withCount(categoryName(c), c.id), onPress: () => openCategory(c.id) })),
      { text: withCount('No category', NO_CATEGORY), onPress: () => openCategory(NO_CATEGORY) },
      { text: 'Cancel', style: 'cancel' as const },
    ])
  return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Category: ${none ? 'No category' : (shown?.label ?? 'none open')}${n > 0 ? `, ${n} ${n === 1 ? 'line' : 'lines'}` : ''}. Pick another`}
        onPress={pick}
        style={[s.chip, s.fixedChip, s.pick]}
      >
        {none ? <View style={[s.noneMark, { borderColor: theme.inkMute }]} /> : shown ? <CategoryBadge category={shown} size={18} /> : null}
        <Text style={[s.chipText, { color: theme.ink, flexShrink: 1 }]} numberOfLines={1}>
          {none ? 'No category' : shown ? subName(shown.label) : 'Category'}
          {n > 0 && <Text style={[s.chipCount, { color: theme.inkMute }]}>{'  '}{n}</Text>}
        </Text>
        <View style={[s.chevron, { borderColor: theme.inkMute, marginLeft: 6 }]} />
      </Pressable>
  )
}

// The pad's category in front of its name, as a line's: its icon on its color (Kevin, 2026-11-27).
function ChipCategory({ id }: { id: string | null }) {
  const c = useLineCategory(id)
  return c ? <CategoryBadge category={c} size={18} /> : null
}

const s = StyleSheet.create({
  strip: { flexGrow: 0 },
  pick: { flexShrink: 1, maxWidth: 240, borderBottomWidth: 0, paddingRight: 4 },
  tools: { flexDirection: 'row', alignItems: 'center' },
  tool: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  noneMark: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderStyle: 'dashed' },
  inner: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, gap: 2 },
  chip: { minHeight: 36, paddingHorizontal: 10, justifyContent: 'center', borderBottomWidth: 2, maxWidth: 180 },
  tab: { flexDirection: 'row', alignItems: 'stretch' },
  fixedChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  glyph: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', transform: [{ scale: 0.8 }] },
  subs: { minHeight: 36, width: 26, marginLeft: -6, alignItems: 'center', justifyContent: 'center' },
  chevron: { width: 7, height: 7, borderRightWidth: 1.5, borderBottomWidth: 1.5, transform: [{ rotate: '45deg' }], marginTop: -4 },
  chipText: { fontFamily: serif, fontSize: 15 },
  chipCount: { fontFamily: serif, fontSize: 12, fontVariant: ['tabular-nums'] },
})
