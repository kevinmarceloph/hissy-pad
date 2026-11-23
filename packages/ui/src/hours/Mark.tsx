import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Category } from '@hissypad/core/hours';
import { hasPlan, type Entry } from '@hissypad/core/hours';

import { useTheme, type Theme } from './theme';

type Props = {
  // The color of what was done, or nothing.
  fill?: string | null;
  // The color of what was planned, or nothing.
  outline?: string | null;
  // The plan and the deed are the same category.
  kept?: boolean;
  // An hour that has not come yet draws its empty box lighter.
  faint?: boolean;
  style?: StyleProp<ViewStyle>;
};

// One box that says both things about an hour: the outline is the plan, the fill is what
// happened. The shapes differ, not only the colors, so they read without telling hues
// apart:
//   hollow, colored outline    planned, nothing done yet
//   solid                      done (as planned, or with no plan)
//   outline around a core      done, but not what was planned
//   hollow, thin grey outline  nothing planned, nothing done
export function Mark({ fill, outline, kept, faint, style }: Props) {
  const theme = useTheme();

  if (fill && outline && !kept) {
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

// The outline of an hour's box: its planned category's color. A plan that is words alone
// draws in ink, and only until something is logged: around a fill it would read as an hour
// that went elsewhere.
export function planOutline(entry: Entry | undefined, plan: Category | undefined, logged: boolean, theme: Theme): string | null {
  if (!hasPlan(entry)) return null;
  if (entry.planned === null) return logged ? null : theme.ink;
  return plan ? theme.palette[plan.color] : theme.ink;
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 2 },
  // The gap between the outline and the core is the paper showing through.
  ring: { borderWidth: 2, padding: 1.5 },
  core: { flex: 1, borderRadius: 1 },
});
