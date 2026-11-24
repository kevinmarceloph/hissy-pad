import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LINE_RATIO_WEB, LINE_WEB, PAPER_DARK, PAPER_LIGHT, TEXT_SIZE } from '@hissypad/core'

// The stylesheet cannot import the shared sizes (core/look.ts), so this holds it to them:
// the pad here, the phone's pad and Hours all draw a line of text from the same numbers.
describe('the pad\'s type sizes', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
  const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim()

  it('are the shared ones', () => {
    expect(token('size')).toBe(`${TEXT_SIZE}px`)
    expect(Number(token('lh'))).toBe(LINE_RATIO_WEB)
    expect(LINE_WEB).toBe(25.5)
  })

  // The stylesheet's colors, by block: the light ones first, then the dark ones twice (the
  // device's setting, and the Dark choice in the menu).
  it('draws in the shared paper and inks, light and dark', () => {
    const blocks = css.split('}').filter((b) => b.includes('--paper:'))
    const read = (block: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()
    const names = { paper: 'paper', paperRaised: 'paper-raised', ink: 'ink', inkSoft: 'ink-soft', inkMute: 'ink-mute', rule: 'rule', accent: 'accent' } as const
    expect(blocks).toHaveLength(3)
    for (const [key, name] of Object.entries(names) as [keyof typeof names, string][]) {
      expect(read(blocks[0]!, name)).toBe(PAPER_LIGHT[key])
      expect(read(blocks[1]!, name)).toBe(PAPER_DARK[key])
      expect(read(blocks[2]!, name)).toBe(PAPER_DARK[key])
    }
  })
})
