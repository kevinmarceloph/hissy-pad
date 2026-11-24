import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Category } from '@hissypad/core/hours';

import { Tap } from './Tap';
import { LINE, ROW, SchemeContext, serif, SIZE, SMALL, useTheme } from './theme';

type Props = {
  // The active categories, in order.
  categories: Category[];
  // The category the lines share now, or null.
  value: string | null;
  // How many lines are being given one, for the heading.
  count?: number;
  // A category was picked, or "No category" (null).
  onPick(category: string | null): void;
  onCancel(): void;
  scheme?: 'light' | 'dark' | null;
};

// Gives lines of the pad one of Hours' categories: tap one. The pad then draws its icon
// before the line's text. Each choice shows its icon, its name and its color, so none of
// them rests on the color alone.
export function CategoryPicker({ scheme = null, ...props }: Props) {
  return (
    <SchemeContext.Provider value={scheme}>
      <Picker {...props} />
    </SchemeContext.Provider>
  );
}

function Picker({ categories, value, count = 1, onPick, onCancel }: Omit<Props, 'scheme'>) {
  const theme = useTheme();
  return (
    <View style={[styles.sheet, { backgroundColor: theme.paper }]}>
      <Text role="heading" aria-level={2} style={[styles.title, { color: theme.ink }]}>
        {count === 1 ? 'Which category is this line?' : `Which category are these ${count} lines?`}
      </Text>
      {categories.length === 0 ? (
        <Text style={[styles.small, { color: theme.inkSoft }]}>
          No categories yet. Add them in Hours, under the menu's Categories.
        </Text>
      ) : (
        <ScrollView style={styles.scroll}>
          <View role="radiogroup" aria-label="Category" style={styles.list}>
            {categories.map((c) => {
              const on = c.id === value;
              return (
                <Tap
                  key={c.id}
                  role="radio"
                  aria-checked={on}
                  aria-label={c.label}
                  onPress={() => onPick(c.id)}
                  style={[styles.choice, { borderColor: on ? theme.ink : theme.line }, on && { backgroundColor: theme.paperRaised }]}
                  activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paperRaised }}>
                  <View style={[styles.swatch, { backgroundColor: theme.palette[c.color] }]} />
                  <Text style={[styles.icon, { color: theme.ink }]}>{c.icon || ' '}</Text>
                  <Text numberOfLines={1} style={[styles.body, styles.label, { color: theme.ink }, on && { fontWeight: '700' }]}>
                    {c.label}
                  </Text>
                  {on && <Text style={[styles.body, { color: theme.ink }]}>✓</Text>}
                </Tap>
              );
            })}
          </View>
        </ScrollView>
      )}
      <View style={styles.actions}>
        <Tap
          disabled={value === null}
          onPress={() => onPick(null)}
          style={[styles.action, { borderColor: theme.line }]}
          activeStyle={{ borderColor: theme.ink, backgroundColor: theme.paperRaised }}>
          <Text style={[styles.body, { color: value === null ? theme.inkQuiet : theme.ink }]}>No category</Text>
        </Tap>
        <Tap onPress={onCancel} style={[styles.action, { borderColor: theme.ink }]} activeStyle={{ backgroundColor: theme.paperRaised }}>
          <Text style={[styles.body, { color: theme.ink }]}>Cancel</Text>
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 20, gap: 12, width: '100%', maxHeight: '100%' },
  title: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, fontWeight: '700' },
  body: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE },
  small: { fontFamily: serif, fontSize: SMALL, lineHeight: 20 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  list: { gap: 6 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: ROW, paddingHorizontal: 12, borderWidth: 1, borderRadius: 4 },
  swatch: { width: 6, alignSelf: 'stretch', marginVertical: 8, borderRadius: 3 },
  icon: { fontSize: SIZE, lineHeight: LINE, width: 24, textAlign: 'center' },
  label: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  action: { minHeight: ROW, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 4 },
});
