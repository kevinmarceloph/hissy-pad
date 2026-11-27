// The menu, as a screen of its own (Kevin, 2026-11-28): the bottom nav's fifth cell. It has
// what the top bar's +, Search and hamburger had, and what Hours' own menu had (its settings
// and the recurring plans), laid out to be read: the two things done most as tiles at the
// top, then the lists to look at, then what is set up once, then the account.
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { serif, type Theme } from '../theme'
import { Account } from './Account'
import { PlusIcon, SearchIcon } from './TopIcons'

export interface MenuActions {
  onNew(): void
  onSearch(): void
  onDone(): void
  onArchive(): void
  onCategories(): void
  onPlans(): void
  onSettings(): void
  onLog?: (() => void) | undefined // only where the debug log is on
}

export function MenuScreen({ theme, actions }: { theme: Theme; actions: MenuActions }) {
  const tile = (label: string, hint: string, icon: ReactNode, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} style={({ pressed }) => [s.tile, { backgroundColor: theme.paperRaised, borderColor: pressed ? theme.accent : theme.rule }]}>
      {icon}
      <Text style={[s.tileText, { color: theme.ink }]}>{label}</Text>
      <Text style={[s.says, { color: theme.inkMute }]} numberOfLines={2}>{hint}</Text>
    </Pressable>
  )
  const row = (label: string, says: string, onPress: () => void, last = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={says} onPress={onPress} style={({ pressed }) => [s.row, !last && { borderBottomColor: theme.rule, borderBottomWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: theme.accentFaint }]}>
      <View style={s.rowText}>
        <Text style={[s.label, { color: theme.ink }]}>{label}</Text>
        <Text style={[s.says, { color: theme.inkMute }]} numberOfLines={1}>{says}</Text>
      </View>
      <View style={[s.chevron, { borderColor: theme.inkMute }]} />
    </Pressable>
  )
  const group = (title: string, children: ReactNode) => (
    <View style={s.group}>
      <Text accessibilityRole="header" style={[s.heading, { color: theme.inkMute }]}>{title.toUpperCase()}</Text>
      <View style={[s.card, { backgroundColor: theme.paperRaised, borderColor: theme.rule }]}>{children}</View>
    </View>
  )
  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.tiles}>
        {tile('New item', 'A line with its pad, hour and category', <PlusIcon color={theme.ink} />, actions.onNew)}
        {tile('Search', 'Every pad, archived lines too', <SearchIcon color={theme.ink} />, actions.onSearch)}
      </View>
      {group('Look back', <>
        {row('Recently done', 'What was crossed out, newest first', actions.onDone)}
        {row('Archive', 'Archived lines, each with its pad', actions.onArchive, true)}
      </>)}
      {group('Set up', <>
        {row('Categories', 'Names, icons and colors', actions.onCategories)}
        {row('Recurring plans', 'Hours that repeat on chosen days', actions.onPlans)}
        {row('Hours settings', 'When a day starts, and the chimes', actions.onSettings, !actions.onLog)}
        {actions.onLog && row('Debug log', 'Every op, selection and sync step', actions.onLog, true)}
      </>)}
      <View style={s.group}>
        <Text accessibilityRole="header" style={[s.heading, { color: theme.inkMute }]}>ACCOUNT</Text>
        <Account theme={theme} />
      </View>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 22 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, minHeight: 104, padding: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth * 2, gap: 6, alignItems: 'flex-start' },
  tileText: { fontFamily: serif, fontSize: 18, fontWeight: '700', marginTop: 4 },
  group: { gap: 8 },
  heading: { fontFamily: serif, fontSize: 12, letterSpacing: 0.8, paddingHorizontal: 4 },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden' },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 12 },
  rowText: { flex: 1 },
  label: { fontFamily: serif, fontSize: 17 },
  says: { fontFamily: serif, fontSize: 13, lineHeight: 17 },
  chevron: { width: 8, height: 8, borderRightWidth: 1.5, borderTopWidth: 1.5, transform: [{ rotate: '45deg' }] },
})
