import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from './theme';

type Props = {
  // The color of the inside of the box, or nothing.
  fill?: string | null;
  // The color of its outline, or nothing.
  outline?: string | null;
  // An hour that has not come yet draws its empty box lighter.
  faint?: boolean;
  // A category's icon, drawn in the middle of the box at the size the box has room for.
  icon?: string | null;
  style?: StyleProp<ViewStyle>;
};

// One box: a category's swatch in a list, or one hour in a strip of them, where the shape
// says the hour's state so it reads without telling hues apart (see hourBox):
//   hollow, thin grey outline  nothing in the hour
//   hollow, colored outline    something in it, still open
//   outline around a core      doing
//   solid                      done
// An hour's box also holds its category's icon where the box is wide enough (see iconSize).
export function Mark({ fill, outline, faint, icon, style }: Props) {
  const theme = useTheme();
  // The box as laid out: its width is a share of a row, so the icon's size comes from it.
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const size = icon && room ? iconSize(room.width, room.height) : 0;
  const measure = icon
    ? (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
        const { width, height } = event.nativeEvent.layout;
        setRoom((was) => (was && was.width === width && was.height === height ? was : { width, height }));
      }
    : undefined;
  const drawn = size > 0 && (
    <View aria-hidden style={styles.icon}>
      <Text allowFontScaling={false} style={{ fontSize: size, lineHeight: Math.round(size * 1.25) }}>
        {icon}
      </Text>
    </View>
  );

  if (fill && outline) {
    return (
      <View onLayout={measure} style={[styles.box, styles.ring, { borderColor: outline }, style]}>
        <View style={[styles.core, { backgroundColor: fill }]} />
        {drawn}
      </View>
    );
  }
  if (fill) {
    return (
      <View onLayout={measure} style={[styles.box, { backgroundColor: fill, borderColor: fill }, style]}>
        {drawn}
      </View>
    );
  }
  if (outline) {
    return (
      <View onLayout={measure} style={[styles.box, styles.ring, { borderColor: outline }, style]}>
        {drawn}
      </View>
    );
  }
  return (
    <View onLayout={measure} style={[styles.box, { borderColor: faint ? theme.rule : theme.line }, style]}>
      {drawn}
    </View>
  );
}

// The size an icon is drawn at in a box of this width and height: clear of the outline, never
// larger than a line of text, and not at all in a box too narrow for it. Under 12 an emoji
// is a smudge that hides the shape that says the hour's state, so the phone's one-line strip
// (boxes about 13 wide) stays bare, and the rows of six and a wide window's line draw it.
export const ICON_MIN = 12;
export function iconSize(width: number, height: number): number {
  const size = Math.floor(Math.min(width - 7, height - 6, 16));
  return size >= ICON_MIN ? size : 0;
}

// One hour of a strip: its state, the color and the icon of the category its row shows (null
// for none), and whether there is anything in it at all.
export type HourCell = { state: 'open' | 'doing' | 'done'; color: string | null; icon: string | null; any: boolean };

// The box an hour is drawn as in a strip. No category draws in ink.
export function hourBox(
  cell: HourCell | undefined,
  ink: string,
): { fill: string | null; outline: string | null; icon: string | null } {
  if (!cell) return { fill: null, outline: null, icon: null };
  const color = cell.color ?? ink;
  const icon = cell.icon;
  if (cell.state === 'done') return { fill: color, outline: null, icon };
  if (cell.state === 'doing') return { fill: color, outline: color, icon };
  return { fill: null, outline: cell.any ? color : null, icon };
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 2 },
  // The gap between the outline and the core is the paper showing through.
  ring: { borderWidth: 2, padding: 1.5 },
  core: { flex: 1, borderRadius: 1 },
  icon: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
});
