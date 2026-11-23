// The screens' tests came from Oras-oras, written for React Native Testing Library. Here
// they run in jsdom through react-native-web, so this maps the two calls that differ onto
// React Testing Library: a press is a click, and typing is a change of the field's value.
import { act, fireEvent as dom, render, screen, within, waitFor } from '@testing-library/react';

// React Native Testing Library's events are awaited and let the work they start settle (a
// store write, the state after it), so these do the same.
const settle = (fire: () => void) =>
  act(async () => {
    fire();
    await Promise.resolve();
  });

const fireEvent = {
  press: (el: Element) => settle(() => dom.click(el)),
  changeText: (el: Element, text: string) => settle(() => dom.change(el, { target: { value: text } })),
  blur: (el: Element) => settle(() => dom.blur(el)),
};

export { act, fireEvent, render, screen, within, waitFor };
