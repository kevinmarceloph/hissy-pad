import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { flagMark, type Flag, type FlagOption } from '@hissypad/core/hours';

import { serif, useTheme } from './theme';

type Props = {
  flag: Pick<Flag, 'id' | 'icon' | 'label'>;
  // The answer the hour carries. Null draws the icon alone: an answer this device does not
  // know yet, or a flag shown on its own in a list.
  option: FlagOption | null;
  style?: StyleProp<ViewStyle>;
};

// A flag as it stands on an hour: its icon (or the first letter of its name) on the color
// of the answer. Decoration for the eye: whoever draws it also says the answer in words.
export function FlagMark({ flag, option, style }: Props) {
  const theme = useTheme();
  const mark = flagMark(flag);
  return (
    <View
      aria-hidden
      testID={option ? `flag-${flag.id}-${option.id}` : `flag-${flag.id}`}
      style={[styles.box, option && { backgroundColor: theme.palette[option.color] }, style]}>
      <Text
        style={[
          styles.mark,
          // A letter needs to read against the color; an emoji brings its own.
          { color: option ? theme.paper : theme.inkSoft },
          !flag.icon && styles.letter,
        ]}>
        {mark}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 26, height: 26, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  mark: { fontFamily: serif, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  letter: { fontWeight: '700' },
});
