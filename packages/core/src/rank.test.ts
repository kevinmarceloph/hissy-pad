import { describe, expect, it } from 'vitest'
import { between, isValidRank, ranksBetween } from './rank'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('between', () => {
  it('returns a key strictly between its bounds', () => {
    const cases: [string | null, string | null][] = [
      [null, null], [null, 'a0'], ['a0', null], ['a0', 'a1'], ['a0', 'a0V'], ['a0z', 'a1'], ['Zz', 'a0'],
      ['Zz', 'Zz1'], ['az', 'b00'], ['a0', 'b00'], ['a0V', 'a0W'], [null, 'A' + '0'.repeat(26) + '1'],
      ['z' + 'z'.repeat(26) + 'V', null],
    ]
    for (const [a, b] of cases) {
      const k = between(a, b)
      expect(isValidRank(k), `${a},${b} -> ${k}`).toBe(true)
      if (a !== null) expect(k > a, `${k} > ${a}`).toBe(true)
      if (b !== null) expect(k < b, `${k} < ${b}`).toBe(true)
    }
  })

  it('rejects inverted or invalid bounds', () => {
    expect(() => between('a1', 'a0')).toThrow()
    expect(() => between('a0', 'a0')).toThrow()
    expect(() => between('a00', null)).toThrow()   // fraction ending in 0
    expect(() => between('V', null)).toThrow()     // no head letter
    expect(() => between('b0', null)).toThrow()    // too few digits for head
    expect(() => between(null, '')).toThrow()
  })

  it('walks short integers when appending at the end', () => {
    let k: string | null = null
    const seen: string[] = []
    for (let i = 0; i < 500; i++) seen.push((k = between(k, null)))
    expect(seen.slice(0, 3)).toEqual(['a0', 'a1', 'a2'])
    expect(seen[62]).toBe('b00')
    expect(k!.length).toBe(3)
  })

  it('walks short integers when prepending at the top (capture)', () => {
    let k: string | null = null
    const seen: string[] = []
    for (let i = 0; i < 500; i++) seen.push((k = between(null, k)))
    expect(seen.slice(0, 3)).toEqual(['a0', 'Zz', 'Zy'])
    expect(seen[63]).toBe('Yzz')
    expect(k!.length).toBe(3)
  })

  it('stays bounded when repeatedly inserting at the same gap', () => {
    let lo: string | null = 'a0'
    const hi = 'a1'
    for (let i = 0; i < 200; i++) lo = between(lo, hi)
    expect(lo!.length).toBeLessThan(60)
  })

  it('holds for random valid pairs', () => {
    const rand = rng(7)
    let keys = ranksBetween(null, null, 50)
    for (let i = 0; i < 2000; i++) {
      const j = Math.floor(rand() * (keys.length + 1))
      const a = j === 0 ? null : keys[j - 1]!
      const b = j === keys.length ? null : keys[j]!
      const k = between(a, b)
      expect(isValidRank(k)).toBe(true)
      if (a !== null) expect(k > a).toBe(true)
      if (b !== null) expect(k < b).toBe(true)
      keys = [...keys.slice(0, j), k, ...keys.slice(j)]
    }
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('ranksBetween', () => {
  it('returns n sorted distinct keys inside the bounds', () => {
    for (const n of [0, 1, 2, 3, 7, 50]) {
      const ks = ranksBetween('a0', 'a1', n)
      expect(ks).toHaveLength(n)
      for (let i = 0; i < ks.length; i++) {
        expect(isValidRank(ks[i]!)).toBe(true)
        expect(ks[i]! > 'a0').toBe(true)
        expect(ks[i]! < 'a1').toBe(true)
        if (i > 0) expect(ks[i]! > ks[i - 1]!).toBe(true)
      }
    }
  })

  it('keeps a long paste short', () => {
    const ks = ranksBetween(null, null, 1000)
    const longest = Math.max(...ks.map((k) => k.length))
    expect(longest).toBeLessThanOrEqual(4)
  })
})
