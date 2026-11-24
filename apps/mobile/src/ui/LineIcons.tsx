// The line toolbar's icons, drawn with plain Views like the top bar's (no icon font, no
// SVG module, so they ship in an update). The same set as the web's SVGs in
// apps/web/src/app/icons.tsx, on the same 20-point box: change both together.
import { StyleSheet, View, type ViewStyle } from 'react-native'
import type { LineIcon as LineIconId } from '@hissypad/state'

const W = 1.5 // stroke

// A straight stroke from its left end, `len` long, turned `deg` about its middle.
function Stroke({ x, y, len, deg = 0, color }: { x: number; y: number; len: number; deg?: number; color: string }) {
  return <View style={{ position: 'absolute', left: x, top: y - W / 2, width: len, height: W, borderRadius: 1, backgroundColor: color, transform: [{ rotate: `${deg}deg` }] }} />
}
const H = ({ x, y, len, color }: { x: number; y: number; len: number; color: string }) => <Stroke x={x} y={y} len={len} color={color} />
const V = ({ x, y, len, color }: { x: number; y: number; len: number; color: string }) => (
  <View style={{ position: 'absolute', left: x - W / 2, top: y, width: W, height: len, borderRadius: 1, backgroundColor: color }} />
)
// A chevron whose point is at (x, y), opening away from `dir`.
function Chevron({ x, y, dir, size = 5.5, color }: { x: number; y: number; dir: 'up' | 'down'; size?: number; color: string }) {
  const up = dir === 'up'
  const box: ViewStyle = {
    position: 'absolute', left: x - size / 2, top: up ? y + size * 0.21 : y - size * 1.21, width: size, height: size,
    borderColor: color, transform: [{ rotate: '45deg' }],
    ...(up ? { borderTopWidth: W, borderLeftWidth: W } : { borderBottomWidth: W, borderRightWidth: W }),
  }
  return <View style={box} />
}

function Clipboard({ color, dir }: { color: string; dir: 'up' | 'down' }) {
  return (
    <>
      <View style={{ position: 'absolute', left: 4.5, top: 4, width: 11, height: 13, borderRadius: 1.5, borderWidth: W, borderColor: color }} />
      <View style={{ position: 'absolute', left: 7.5, top: 2.5, width: 5, height: 3, borderRadius: 0.5, backgroundColor: color }} />
      <V x={10} y={9} len={5.5} color={color} />
      {dir === 'up' ? <Chevron x={10} y={8.6} dir="up" size={4} color={color} /> : <Chevron x={10} y={15} dir="down" size={4} color={color} />}
    </>
  )
}

export function LineIcon({ icon, color, ground }: { icon: LineIconId; color: string; ground: string }) {
  let body: React.ReactNode
  switch (icon) {
    // A new line (the plus and its stroke) over, or under, the two that are there.
    case 'addAbove':
      body = <><V x={5} y={3} len={5} color={color} /><H x={2.5} y={5.5} len={5} color={color} /><H x={10.5} y={5.5} len={7} color={color} /><H x={3} y={11} len={14} color={color} /><H x={3} y={15.5} len={14} color={color} /></>
      break
    case 'addBelow':
      body = <><H x={3} y={4.5} len={14} color={color} /><H x={3} y={9} len={14} color={color} /><V x={5} y={12} len={5} color={color} /><H x={2.5} y={14.5} len={5} color={color} /><H x={10.5} y={14.5} len={7} color={color} /></>
      break
    // An arrow up to a bar.
    case 'top':
      body = <><H x={4} y={3.5} len={12} color={color} /><V x={10} y={7.5} len={9.5} color={color} /><Chevron x={10} y={7} dir="up" size={6} color={color} /></>
      break
    // Two chevrons closing on each other; the same two opening.
    case 'fold':
      body = <><Chevron x={10} y={8} dir="down" color={color} /><Chevron x={10} y={12} dir="up" color={color} /></>
      break
    case 'unfold':
      body = <><Chevron x={10} y={3.5} dir="up" color={color} /><Chevron x={10} y={16.5} dir="down" color={color} /></>
      break
    // A sheet over its copy. `ground` hides the corner of the one behind.
    case 'copy':
      body = (
        <>
          <View style={{ position: 'absolute', left: 6.5, top: 3, width: 10.5, height: 10.5, borderRadius: 1.5, borderWidth: W, borderColor: color }} />
          <View style={{ position: 'absolute', left: 3, top: 6.5, width: 10.5, height: 10.5, borderRadius: 1.5, borderWidth: W, borderColor: color, backgroundColor: ground }} />
        </>
      )
      break
    case 'cut':
      body = (
        <>
          <Stroke x={4.3} y={8} len={11.4} deg={-52.5} color={color} />
          <Stroke x={4.3} y={8} len={11.4} deg={52.5} color={color} />
          <View style={{ position: 'absolute', left: 3.5, top: 12, width: 5, height: 5, borderRadius: 2.5, borderWidth: W, borderColor: color, backgroundColor: ground }} />
          <View style={{ position: 'absolute', left: 11.5, top: 12, width: 5, height: 5, borderRadius: 2.5, borderWidth: W, borderColor: color, backgroundColor: ground }} />
        </>
      )
      break
    case 'pasteAbove':
      body = <Clipboard color={color} dir="up" />
      break
    case 'pasteBelow':
      body = <Clipboard color={color} dir="down" />
      break
    // An arrow into a tray: put it somewhere. Also the Sort mode.
    case 'move':
      body = (
        <>
          <View style={{ position: 'absolute', left: 3, top: 11, width: 14, height: 6, borderBottomLeftRadius: 1.5, borderBottomRightRadius: 1.5, borderWidth: W, borderTopWidth: 0, borderColor: color }} />
          <V x={10} y={3} len={9} color={color} />
          <Chevron x={10} y={12.6} dir="down" size={6} color={color} />
        </>
      )
      break
    case 'delete':
      body = (
        <>
          <H x={3.5} y={5.5} len={13} color={color} />
          <View style={{ position: 'absolute', left: 8, top: 3, width: 4, height: 2.5, borderWidth: W, borderBottomWidth: 0, borderTopLeftRadius: 1, borderTopRightRadius: 1, borderColor: color }} />
          <View style={{ position: 'absolute', left: 5.5, top: 5.5, width: 9, height: 11.5, borderWidth: W, borderTopWidth: 0, borderBottomLeftRadius: 1.5, borderBottomRightRadius: 1.5, borderColor: color }} />
          <V x={8.5} y={8.5} len={5} color={color} />
          <V x={11.5} y={8.5} len={5} color={color} />
        </>
      )
      break
    case 'more':
      body = <>{[4.5, 10, 15.5].map((x) => <View key={x} style={{ position: 'absolute', left: x - 1.4, top: 8.6, width: 2.8, height: 2.8, borderRadius: 1.4, backgroundColor: color }} />)}</>
      break
  }
  return <View style={s.box}>{body}</View>
}

const s = StyleSheet.create({ box: { width: 20, height: 20 } })
