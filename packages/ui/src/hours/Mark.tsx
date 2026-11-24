import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from './theme';

type Props = {
  // The color of the inside of the box, or nothing.
  fill?: string | null;
  // The color of its outline, or nothing.
  outline?: string | null;
  // An hour that has not come yet draws its empty box lighter.
  faint?: boolean;
  style?: StyleProp<ViewStyle>;
};

// One box: a category's swatch in a list, or one hour in a strip of them, where the shape
// says the hour's state so it reads without telling hues apart (see hourBox):
//   hollow, thin grey outline  nothing in the hour
//   hollow, colored outline    something in it, still open
//   outline around a core      doing
//   solid                      done
export function Mark({ fill, outline, faint, style }: Props) {
  const theme = useTheme();

  if (fill && outline) {
    return (
      <View style={[styles.box, styles.ring, { borderColor: outline }, style]}>
        <View style={[styles.core, { backgroundColor: fill }]} />
      </View>
    );
  }
  if (fill) return <View style={[styles.box, { backgroundColor: fill, borderColor: fill }, style]} />;
  if (outline) return <View style={[styles.box, styles.ring, { borderColor: outline }, style]} />;
  return <View style={[styles.box, { borderColor: faint ? theme.rule : theme.line }, style]} />;
}

// One hour of a strip: its state, the color of the category its row shows (null for none),
// and whether there is anything in it at all.
export type HourCell = { state: 'open' | 'doing' | 'done'; color: string | null; any: boolean };

// The box an hour is drawn as in a strip. No category draws in ink.
export function hourBox(cell: HourCell | undefined, ink: string): { fill: string | null; outline: string | null } {
  if (!cell) return { fill: null, outline: null };
  const color = cell.color ?? ink;
  if (cell.state === 'done') return { fill: color, outline: null };
  if (cell.state === 'doing') return { fill: color, outline: color };
  return { fill: null, outline: cell.any ? color : null };
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 2 },
  // The gap between the outline and the core is the paper showing through.
  ring: { borderWidth: 2, padding: 1.5 },
  core: { flex: 1, borderRadius: 1 },
});
