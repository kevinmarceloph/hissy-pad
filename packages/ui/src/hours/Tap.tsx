import type { ReactNode } from 'react';
import {
  Platform,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from './theme';

// react-native-web also reports hover and keyboard focus; React Native's own type only
// knows `pressed`.
type TapState = { pressed: boolean; hovered?: boolean; focused?: boolean };

type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  // Extra style while hovered or pressed, so every control answers the hand.
  activeStyle?: StyleProp<ViewStyle>;
  // Draws the focus ring inside the control's edge, for one with no room around it.
  ringInside?: boolean;
  children: ReactNode;
};

// Web only: React Native's own cursor type stops at 'auto' and 'pointer'.
const NOT_ALLOWED = Platform.OS === 'web' ? ({ cursor: 'not-allowed' } as unknown as ViewStyle) : null;

// Every tappable thing on the screen: a real button with hover, pressed, disabled and
// keyboard-focus states in one place.
export function Tap({ style, activeStyle, ringInside, disabled, children, ...rest }: Props) {
  const theme = useTheme();

  // react-native-web presses a button on Enter and Space but anything else on Enter only.
  // A radio, a switch, a checkbox or a list option is expected to answer Space too, and without this Space scrolls
  // the page instead.
  const spaceKey =
    Platform.OS === 'web' && !disabled && (rest.role === 'radio' || rest.role === 'switch' || rest.role === 'option' || rest.role === 'checkbox')
      ? {
          onKeyDown: (event: { key: string; preventDefault(): void }) => {
            if (event.key !== ' ') return;
            event.preventDefault();
            rest.onPress?.(event as unknown as GestureResponderEvent);
          },
        }
      : null;

  return (
    <Pressable
      role="button"
      disabled={disabled}
      {...rest}
      {...(spaceKey as object)}
      style={(state) => {
        const { pressed, hovered, focused } = state as TapState;
        return [
          style,
          (hovered || pressed) && !disabled && activeStyle,
          pressed && !disabled && { opacity: 0.7 },
          disabled && { opacity: 0.4 },
          disabled && NOT_ALLOWED,
          focused && { outlineWidth: 2, outlineStyle: 'solid', outlineColor: theme.accent, outlineOffset: ringInside ? -2 : 2 },
        ];
      }}>
      {children}
    </Pressable>
  );
}
