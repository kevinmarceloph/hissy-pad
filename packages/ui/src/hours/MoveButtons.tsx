import { StyleSheet, Text, View } from 'react-native';

import { Tap } from './Tap';
import { ROW, SIZE, useTheme } from './theme';

type Props = {
  // What is being moved, for the spoken label: "Move Deep work up".
  name: string;
  first: boolean;
  last: boolean;
  onMove(by: -1 | 1): void;
};

// Up and down, at the right of a row in a list the user orders (categories, flags,
// recurring plans). On the row itself, not inside its editor, so the order can be changed
// without opening anything. A list of one has nothing to move.
export function MoveButtons({ name, first, last, onMove }: Props) {
  const theme = useTheme();
  if (first && last) return null;
  const button = (by: -1 | 1, glyph: string, word: string, disabled: boolean) => (
    <Tap
      disabled={disabled}
      aria-label={`Move ${name} ${word}`}
      onPress={() => onMove(by)}
      style={styles.button}
      activeStyle={{ backgroundColor: theme.paperRaised }}>
      <Text aria-hidden style={[styles.glyph, { color: theme.ink }]}>
        {glyph}
      </Text>
    </Tap>
  );
  return (
    <View style={styles.pair}>
      {button(-1, '↑', 'up', first)}
      {button(1, '↓', 'down', last)}
    </View>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', flexShrink: 0 },
  button: { width: 40, minHeight: ROW, alignItems: 'center', justifyContent: 'center', borderRadius: 4 },
  glyph: { fontSize: SIZE, lineHeight: 24 },
});
