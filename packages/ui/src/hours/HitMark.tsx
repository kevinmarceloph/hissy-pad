import { StyleSheet, Text, View } from 'react-native';
import { hitBullet, type SearchHit } from '@hissypad/state';

import { StateMark } from './StateMark';
import { serif, SIZE } from './theme';

type Props = {
  hit: SearchHit;
  color: string;     // the bullet's ink
  doneColor: string; // a done line's ink
  accent: string;    // the strike through a done "#" or number
};

// A line's bullet in a list that is not its pad (Search's hits on the phone, the lines done
// in an hour), drawn as the pad draws its own: a dot, a dot in a ring (doing), a cross
// (done), a "#" for a header, its number for a numbered line, a short rule for a divider.
// A pad's name has none. The box is the same size whatever it holds, so the words line up.
export function HitMark({ hit, color, doneColor, accent }: Props) {
  const b = hitBullet(hit);
  return (
    <View aria-hidden style={styles.box}>
      {!b ? null : b.label !== null ? (
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            b.kind === 'header' && styles.bold,
            { color: b.state === 'done' ? doneColor : color },
            b.state === 'done' && { textDecorationLine: 'line-through', textDecorationColor: accent },
            b.state === 'doing' && [styles.ringed, { borderColor: color }],
          ]}
        >
          {b.label}
        </Text>
      ) : b.kind === 'divider' ? (
        <View style={[styles.rule, { backgroundColor: doneColor }]} />
      ) : (
        <StateMark state={b.state} color={b.state === 'done' ? doneColor : color} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 24, height: 20, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: serif, fontSize: SIZE - 2, lineHeight: 18, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '700' },
  ringed: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 3, overflow: 'hidden' },
  rule: { width: 12, height: 1 },
});
