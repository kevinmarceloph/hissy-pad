// The top bar's icons and the mode switcher (Hours, Pad, Sort). The icons are drawn with
// plain Views: no icon font and no SVG module, so they ship in an update without a new
// native build. Each sits in a Pressable that carries the name for VoiceOver.
import { Pressable, StyleSheet, View } from 'react-native'
import type { Theme } from '../theme'
import { LineIcon } from './LineIcons'

export type Mode = 'pad' | 'hours' | 'category' | 'sort'

const W = 1.5 // stroke

// Pad: an outline, three lines with their bullets.
export function PadIcon({ color }: { color: string }) {
  return (
    <View style={i.box}>
      {[0, 1, 2].map((n) => (
        <View key={n} style={i.padRow}>
          <View style={{ width: 2.5, height: 2.5, borderRadius: 2, backgroundColor: color }} />
          <View style={{ width: 11, height: W, borderRadius: 1, backgroundColor: color }} />
        </View>
      ))}
    </View>
  )
}

// Hours: a clock, the toolbar's Hour… icon.
export function HoursIcon({ color }: { color: string }) {
  return <LineIcon icon="hour" color={color} ground="transparent" />
}

// Later: a calendar page, rings at the top.
export function CalendarIcon({ color }: { color: string }) {
  return (
    <View style={i.box}>
      <View style={{ position: 'absolute', left: 3, top: 4, width: 14, height: 13, borderRadius: 2, borderWidth: W, borderColor: color }} />
      <View style={{ position: 'absolute', left: 3, top: 8, width: 14, height: W, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: 6.25, top: 2.5, width: W, height: 3.5, borderRadius: 1, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: 12.25, top: 2.5, width: W, height: 3.5, borderRadius: 1, backgroundColor: color }} />
    </View>
  )
}

export function SearchIcon({ color }: { color: string }) {
  return (
    <View style={i.box}>
      <View style={{ position: 'absolute', left: 2, top: 2, width: 12, height: 12, borderRadius: 6, borderWidth: W, borderColor: color }} />
      <View style={{ position: 'absolute', left: 13.5, top: 11, width: W, height: 7, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
    </View>
  )
}

export function MenuIcon({ color }: { color: string }) {
  return (
    <View style={[i.box, { gap: 3.5 }]}>
      {[0, 1, 2].map((n) => (
        <View key={n} style={{ width: 16, height: W, borderRadius: 1, backgroundColor: color }} />
      ))}
    </View>
  )
}

// New item: a plus.
export function PlusIcon({ color }: { color: string }) {
  return (
    <View style={i.box}>
      <View style={{ position: 'absolute', width: 14, height: W, borderRadius: 1, backgroundColor: color }} />
      <View style={{ position: 'absolute', width: W, height: 14, borderRadius: 1, backgroundColor: color }} />
    </View>
  )
}

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'hours', label: 'Hours: the day, one row per hour' },
  { mode: 'pad', label: 'Pad: the outline' },
  { mode: 'category', label: "Categories: one category's lines from every pad" },
  { mode: 'sort', label: 'Sort: the open pad, one line at a time' },
]

// The bottom nav (Kevin, 2026-11-27): the four modes and, last, the menu (New item, Search
// and the rest), five cells across the foot of the screen in place of the top bar. The open
// mode is a raised cell with a line of the accent over it and full ink, so which one is open
// does not rest on color alone. `mode` is null on a screen that is no mode (the Archive):
// nothing is lit.
export function BottomNav({ mode, onMode, onMenu, theme }: { mode: Mode | null; onMode: (mode: Mode) => void; onMenu: () => void; theme: Theme }) {
  return (
    <View style={[i.nav, { borderTopColor: theme.rule, backgroundColor: theme.paper }]}>
      <View accessibilityRole="tablist" style={i.navModes}>
        {MODES.map((m) => {
          const on = m.mode === mode
          const color = on ? theme.ink : theme.inkMute
          const ground = on ? theme.paperRaised : theme.paper
          return (
            <Pressable
              key={m.mode}
              accessibilityRole="tab"
              accessibilityLabel={m.label}
              accessibilityState={{ selected: on }}
              onPress={() => onMode(m.mode)}
              style={[i.navCell, { backgroundColor: ground, borderTopColor: on ? theme.accent : 'transparent' }]}
            >
              {/* Sort is a line on its way into a tray: the toolbar's Move to… icon. */}
              {/* Categories is the toolbar's Category… tag. */}
              {m.mode === 'pad' ? <PadIcon color={color} /> : m.mode === 'hours' ? <HoursIcon color={color} /> : <LineIcon icon={m.mode === 'category' ? 'category' : 'move'} color={color} ground={ground} />}
            </Pressable>
          )
        })}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Menu: New item, Search, Done, Archive and Categories" onPress={onMenu} style={[i.navCell, { borderTopColor: 'transparent' }]}>
        <MenuIcon color={theme.inkSoft} />
      </Pressable>
    </View>
  )
}

const i = StyleSheet.create({
  box: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  padRow: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 5.5 },
  nav: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  navModes: { flex: 4, flexDirection: 'row' },
  navCell: { flex: 1, height: 48, borderTopWidth: 2, alignItems: 'center', justifyContent: 'center' },
})
