import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Tap } from './Tap';
import { serif, useTheme } from './theme';

// The three states a line of the pad has, and an hour too: open, doing, done.
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

const SIDES: { state: MarkState; name: string }[] = [
  { state: 'open', name: 'Open' },
  { state: 'doing', name: 'Doing' },
  { state: 'done', name: 'Done' },
];

type SwitchProps = {
  // What the switch is for, for a screen reader: "This hour", or a line's words.
  label: string;
  value: MarkState;
  onChange(state: MarkState): void;
  disabled?: boolean;
};

// Open, doing, done: three sides, each its own button that sets that state (the same
// switch the pad floats over a line). The chosen side is inked in.
export function StateSwitch({ label, value, onChange, disabled = false }: SwitchProps) {
  const theme = useTheme();
  return (
    <View role="radiogroup" aria-label={label} style={[styles.switch, { borderColor: theme.line }]}>
      {SIDES.map(({ state, name }) => {
        const on = state === value;
        return (
          <Tap
            key={state}
            role="radio"
            aria-checked={on}
            aria-label={`${label}: ${name}`}
            disabled={disabled}
            onPress={() => onChange(state)}
            ringInside
            style={[styles.side, on && { backgroundColor: theme.ink }]}
            activeStyle={on ? null : { backgroundColor: theme.paper }}>
            <StateMark state={state} color={on ? theme.paper : theme.ink} />
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  cross: { fontFamily: serif, textAlign: 'center' },
  switch: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  side: { width: 42, height: 34, alignItems: 'center', justifyContent: 'center' },
});
