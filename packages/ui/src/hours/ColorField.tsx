import { StyleSheet, Text, View } from 'react-native';

import { colorLabel, COLORS, type ColorKey } from '@hissypad/core/hours';

import { Tap } from './Tap';
import { ROW, serif, SMALL, useTheme } from './theme';

// The palette as twelve swatches: what a category or a flag's option is colored with.
export function ColorField({ value, onPick }: { value: ColorKey; onPick(color: ColorKey): void }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      {/* The chosen color is also named in words, so the choice never rests on hue alone. */}
      <Text style={[styles.small, { color: theme.inkSoft }]}>Color: {colorLabel(value)}</Text>
      <View role="radiogroup" aria-label="Color" style={styles.colors}>
        {COLORS.map(({ key, label }) => {
          const on = key === value;
          return (
            <Tap
              key={key}
              role="radio"
              aria-checked={on}
              aria-label={label}
              onPress={() => onPick(key)}
              style={[styles.color, { borderColor: on ? theme.ink : 'transparent' }]}
              activeStyle={{ borderColor: on ? theme.ink : theme.inkQuiet }}>
              <View style={[styles.colorFill, { backgroundColor: theme.palette[key] }]} />
            </Tap>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  // Six to a row on every width: two even rows of colors instead of a ragged wrap.
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: 6 * ROW + 5 * 6 },
  color: { width: ROW, height: ROW, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 6 },
  colorFill: { width: 26, height: 26, borderRadius: 4 },
});
