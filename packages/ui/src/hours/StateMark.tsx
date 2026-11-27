import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { serif } from './theme';

// The three states a line of the pad has: open, doing, done. An hour draws its first line's.
export type MarkState = 'open' | 'doing' | 'done';

type Props = {
  state: MarkState;
  color: string;
  // The hour's own mark is a little larger than a line's bullet.
  large?: boolean;
  style?: StyleProp<ViewStyle>;
};

// The pad's three bullets: a dot (open), a dot in a ring (doing), a cross (done). Three
// shapes, so the state never rests on a color.
export function StateMark({ state, color, large = false, style }: Props) {
  const box = large ? 18 : 16;
  const dot = large ? 8 : 6;
  return (
    <View style={[styles.box, { width: box, height: box }, style]}>
      {state === 'done' ? (
        <Text style={[styles.cross, { color, fontSize: large ? 22 : 19, lineHeight: box }]}>×</Text>
      ) : (
        <View style={[styles.ring, { width: box, height: box, borderRadius: box / 2 }, state === 'doing' && { borderColor: color }]}>
          <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  cross: { fontFamily: serif, textAlign: 'center' },
});
