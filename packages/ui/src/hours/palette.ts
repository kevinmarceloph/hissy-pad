// The category palette, one set of values per scheme. Plain TypeScript with no React Native
// in it, so the web pad (which draws a line's category before Hours is ever loaded) can use
// the same values: import it as '@hissypad/ui/palette'. Why these colors: see theme.ts.
import type { ColorKey } from '@hissypad/core/hours';

export type Palette = Record<ColorKey, string>;

export const PALETTES: { light: Palette; dark: Palette } = {
  light: {
    blue: '#5589e0',
    sky: '#135377',
    teal: '#067a83',
    moss: '#4fa002',
    olive: '#332f00',
    ochre: '#755b00',
    brown: '#8e7364',
    rose: '#f93aa6',
    plum: '#781db9',
    indigo: '#2103a2',
    night: '#2a1f67',
    stone: '#44403d',
    cobalt: '#4866fc',
    azure: '#0c2afc',
    magenta: '#ae18ba',
    mauve: '#7e424e',
    lagoon: '#4290a8',
    brick: '#841206',
    orchid: '#fc18de',
    vermilion: '#fc4872',
    amber: '#a26000',
    royal: '#0000d2',
  },
  dark: {
    blue: '#145dff',
    sky: '#aed7ef',
    teal: '#007c60',
    moss: '#c9ff4c',
    olive: '#c0d995',
    ochre: '#ff9900',
    brown: '#a25a29',
    rose: '#f13350',
    plum: '#d889ff',
    indigo: '#8f7aff',
    night: '#5587c2',
    stone: '#c3b4ac',
    cobalt: '#306cba',
    azure: '#66a2cc',
    magenta: '#c64e90',
    mauve: '#de7296',
    lagoon: '#007890',
    brick: '#fc8a72',
    orchid: '#cca8de',
    vermilion: '#fc6036',
    amber: '#f6c648',
    royal: '#6672de',
  },
};

// The text color that reads on a palette color: black or white, whichever has the
// higher contrast (WCAG relative luminance). Used where a category's name sits on its color.
export function inkOn(hex: string): string {
  const lum = luminance(hex);
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? '#000000' : '#ffffff';
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
