import { inkOn, PALETTES, type Palette } from '@hissypad/ui/palette'

// The category palette as CSS, built once from the same values Hours draws with, so the
// pad's rows need no copy of the hexes: `.cat-blue` sets --cat (the color) and --cat-ink
// (the text that reads on it), switching with the page's scheme like styles.css does.
function rules(palette: Palette, scope = ''): string {
  return Object.entries(palette)
    .map(([key, hex]) => `${scope}.cat-${key}{--cat:${hex};--cat-ink:${inkOn(hex)}}`)
    .join('')
}

export function categoryCss(): string {
  return [
    rules(PALETTES.light),
    `@media (prefers-color-scheme: dark){${rules(PALETTES.dark, ":root:not([data-theme='light']) ")}}`,
    rules(PALETTES.dark, ":root[data-theme='dark'] "),
  ].join('')
}

let added = false
export function addCategoryCss(): void {
  if (added || typeof document === 'undefined') return
  added = true
  const style = document.createElement('style')
  style.dataset.categories = ''
  style.textContent = categoryCss()
  document.head.appendChild(style)
}
