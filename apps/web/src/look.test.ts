import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LINE_RATIO_WEB, LINE_WEB, TEXT_SIZE } from '@hissypad/core'

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
})
