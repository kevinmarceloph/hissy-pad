// The pads as a row of chips under the title. Today, Inbox and Later come first, each with
// its icon, and stay put: no rename, move, fold or delete. Tap to open a pad; tap the open
// one (or press and hold any other) to rename, move, fold into another pad or delete it; the chevron beside a
// pad that has sub-pads jumps to one; the + chip makes a new pad. Names are asked for
// with askText (Menu.tsx): the system's prompt on iOS, our own on Android.
import { useEffect, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { askText, menu } from './Menu'
import { categoryCounts, type FixedPad, type PadId } from '@hissypad/core'
import { cmdDeletePad, cmdMovePad, cmdNewPad, cmdPadToLine, cmdRenamePad, cmdSetPadCategory, cmdSetPadCount, openCategory, openPad, openSubPad, subName, padList, padTopLines, placeList, usePad, type PadItem } from '@hissypad/state'
import { categoryPrefix, cmdOpenCategories, lineCategories, useCategoryChoices, useLineCategory } from '@hissypad/state/hours'
import { CategoryBadge } from '@hissypad/ui'
import { activeCategories, categoryName } from '@hissypad/core/hours'
import { serif, type Theme } from '../theme'
import { CalendarIcon, HoursIcon } from './TopIcons'
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
      <Pressable accessibilityRole="button" accessibilityLabel="New pad" onPress={() => ask('New pad', 'A name for it', '', (n) => cmdNewPad(n))} style={[s.chip, { borderBottomColor: 'transparent' }]}>
        <Text style={[s.chipText, { color: theme.inkMute, fontSize: 19 }]}>+</Text>
      </Pressable>
    </ScrollView>
  )
}

// The Categories mode's row of chips, where the Pad mode has its pads: one per category,
// with its mark and how many lines are in it. The open one's lines, from every pad, are the
// pad drawn under it (the store's catId, scopeCategory in core). The same as the web's CategoryTabs.
export function CategoryChips({ theme }: { theme: Theme }) {
  const all = usePad((st) => st.all)
  const catId = usePad((st) => st.catId)
  const load = usePad((st) => st.load)
  const categories = useCategoryChoices()
  const counts = useMemo(() => categoryCounts(all), [all])
  // The categories can arrive after the mode is open (they load with Hours' store).
  useEffect(() => {
    if (catId === null && load === 'ready' && categories.length > 0) cmdOpenCategories()
  }, [catId, load, categories.length])
  if (categories.length === 0) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.strip} contentContainerStyle={s.inner}>
      {categories.map((c) => {
        const on = c.id === catId
        const n = counts.get(c.id) ?? 0
        return (
          <Pressable
            key={c.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={n > 0 ? `${c.label}: ${n} ${n === 1 ? 'line' : 'lines'}` : c.label}
            onPress={() => openCategory(c.id)}
            style={[s.chip, s.fixedChip, { borderBottomColor: on ? theme.accent : 'transparent' }]}
          >
            <CategoryBadge category={c} size={18} />
            <Text style={[s.chipText, { color: on ? theme.ink : theme.inkSoft }]} numberOfLines={1}>
              {subName(c.label)}
              {n > 0 && <Text style={[s.chipCount, { color: theme.inkMute }]}>{'  '}{n}</Text>}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

// The pad's category in front of its name, as a line's: its icon on its color (Kevin, 2026-11-27).
function ChipCategory({ id }: { id: string | null }) {
  const c = useLineCategory(id)
  return c ? <CategoryBadge category={c} size={18} /> : null
}

const s = StyleSheet.create({
  strip: { flexGrow: 0 },
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
