import { describe, expect, it } from 'vitest'
import { createClock } from './clock'

describe('createClock', () => {
  it('is strictly monotonic even when wall time stalls or steps back', () => {
    let wall = 1_000_000
    const c = createClock(() => wall)
    const a = c.tick()
    const b = c.tick()
    wall -= 50_000
    const d = c.tick()
    expect(b > a).toBe(true)
    expect(d > b).toBe(true)
  })

  it('jumps past timestamps observed from other devices', () => {
    const c = createClock(() => 1_000_000)
    c.observe('2030-01-01T00:00:00.000Z')
    expect(c.tick() > '2030-01-01T00:00:00.000Z').toBe(true)
    c.observe('garbage')
    expect(c.tick() > '2030-01-01T00:00:00.000Z').toBe(true)
  })

  it('follows wall time when it is ahead', () => {
    const c = createClock(() => Date.parse('2026-10-28T10:00:00.000Z'))
    expect(c.tick()).toBe('2026-10-28T10:00:00.000Z')
  })
})
