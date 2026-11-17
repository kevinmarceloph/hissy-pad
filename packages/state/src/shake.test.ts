import { describe, expect, it } from 'vitest'
import { createShakeDetector } from './shake'

// Samples every 60ms, as the phone delivers them.
function run(mags: number[], detect = createShakeDetector(), from = 0): number[] {
  const hits: number[] = []
  mags.forEach((m, i) => {
    if (detect(m, 0, 0, from + i * 60)) hits.push(i)
  })
  return hits
}

describe('shake detector', () => {
  it('a phone at rest, or walking, is not a shake', () => {
    expect(run(Array(50).fill(1))).toEqual([])
    expect(run(Array.from({ length: 50 }, (_, i) => 1 + 0.3 * Math.sin(i)))).toEqual([])
  })
  it('one bump (set down on a table) is not a shake', () => {
    expect(run([1, 1, 1, 3.5, 2.2, 1, 1, 1, 1, 1, 1, 1])).toEqual([])
  })
  it('a sustained shake fires once, then stays quiet for the cooldown', () => {
    const shake = Array(30).fill(2.4)
    expect(run([1, 1, ...shake])).toHaveLength(2) // 1.8s of shaking: one at the start, one after the 1s cooldown
    expect(run([1, 1, ...Array(8).fill(2.4), ...Array(20).fill(1)])).toHaveLength(1)
  })
  it('a shake with a couple of calm samples in it still counts', () => {
    expect(run([2.5, 2.1, 1.1, 2.8, 2.2, 2.6, 1.2, 2.4, 2.3])).toHaveLength(1)
  })
})
