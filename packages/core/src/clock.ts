// A one-line hybrid logical clock: wall time, but never lower than the last timestamp this
// client emitted or saw from the server. Last-write-wins per row needs timestamps that only
// move forward on a given device, even when the wall clock steps back (NTP, time zone
// games, a phone that slept with a dead battery).
export interface Clock {
  tick(): string          // next timestamp to stamp on a local edit
  observe(iso: string): void  // call with every remote updatedAt seen, so local edits sort after it
  last(): string
}

export function createClock(nowMs: () => number = Date.now, seed?: string): Clock {
  let lastMs = seed ? Date.parse(seed) : 0
  if (Number.isNaN(lastMs)) lastMs = 0
  return {
    tick() {
      lastMs = Math.max(nowMs(), lastMs + 1)
      return new Date(lastMs).toISOString()
    },
    observe(iso) {
      const ms = Date.parse(iso)
      if (!Number.isNaN(ms) && ms > lastMs) lastMs = ms
    },
    last() {
      return new Date(lastMs).toISOString()
    },
  }
}

// Node 19+, every browser and Hermes (Expo) have crypto.randomUUID; typed loosely so the
// core does not need the DOM lib.
export function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID(): string } }).crypto
  if (!c) throw new Error('crypto.randomUUID is not available')
  return c.randomUUID()
}
