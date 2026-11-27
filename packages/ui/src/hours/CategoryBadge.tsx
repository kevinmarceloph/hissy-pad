import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { iconIsCode, type Category } from '@hissypad/core/hours';

import { inkOn } from './palette';
import { useTheme } from './theme';

type Props = {
  category: Pick<Category, 'icon' | 'label' | 'color'>;
  // The side of the square, in points. The icon is drawn at about two thirds of it.
  size?: number;
  // A category with no icon draws its name in the badge instead, as a wider pill.
  wordWhenBare?: boolean;
  // Read out on its own (a line's prefix); left out, the badge is hidden from screen readers
  // because the control around it already names the category.
  a11yLabel?: string;
  style?: StyleProp<ViewStyle>;
};

// A category as a mark: its icon inside a squircle of its color. The icon carries the
// meaning, the color only backs it (nothing rests on color alone). With no icon the
// badge holds the name (wordWhenBare) or stays an empty colored square beside a label.
export function CategoryBadge({ category, size = 22, wordWhenBare, a11yLabel, style }: Props) {
  const theme = useTheme();
  const color = theme.palette[category.color];
  const word = !category.icon && wordWhenBare;
  // A code ("HP") is text, drawn bold in the ink that reads on the color, in a pill as wide
  // as it needs.
  const code = iconIsCode(category.icon);
  return (
    <View
      aria-hidden={!a11yLabel}
      aria-label={a11yLabel}
      role={a11yLabel ? 'img' : undefined}
      style={[
        styles.badge,
        { backgroundColor: color, height: size, minWidth: size, borderRadius: size * 0.3 },
        word && { paddingHorizontal: size * 0.3 },
        code && { paddingHorizontal: size * 0.18 },
        style,
      ]}>
      {code ? (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: size * 0.5, lineHeight: size, fontWeight: '700', letterSpacing: 0.2, color: inkOn(color) }}>
          {category.icon}
        </Text>
      ) : category.icon ? (
        <Text style={{ fontSize: size * 0.64, lineHeight: size }}>{category.icon}</Text>
      ) : word ? (
        <Text numberOfLines={1} style={{ fontSize: size * 0.55, lineHeight: size, color: inkOn(color) }}>
          {category.label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // borderCurve is iOS's continuous corner: a true squircle there, a rounded square elsewhere.
  badge: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderCurve: 'continuous' },
});
