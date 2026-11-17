// Shake detection from raw accelerometer samples, in g. The rule is the one Square's
// Seismic uses: look at the last half second, and call it a shake when most of the
// samples in it are well above gravity. A single bump (the phone set down, a pocket) is
// one or two hot samples and never fills the window. Pure, so it tests without a phone.
export interface ShakeOptions {
  threshold?: number  // g; a resting phone reads 1
  windowMs?: number   // how far back to look
  minSpanMs?: number  // the hot stretch must last at least this long
  ratio?: number      // share of samples in the window that must be hot
  cooldownMs?: number // quiet time after a shake, so one shake is one event
}

export function createShakeDetector(opts: ShakeOptions = {}) {
  const threshold = opts.threshold ?? 1.5
  const windowMs = opts.windowMs ?? 500
  const minSpanMs = opts.minSpanMs ?? 250
  const ratio = opts.ratio ?? 0.75
  const cooldownMs = opts.cooldownMs ?? 1000
  let samples: { t: number; hot: boolean }[] = []
  let quietUntil = 0
  // Feed one sample; returns true on the sample that completes a shake.
  return function sample(x: number, y: number, z: number, t: number): boolean {
    if (t < quietUntil) return false
    samples.push({ t, hot: Math.hypot(x, y, z) > threshold })
    while (samples.length > 0 && t - samples[0]!.t > windowMs) samples.shift()
    if (samples.length < 4 || t - samples[0]!.t < minSpanMs) return false
    const hot = samples.filter((s) => s.hot).length
    if (hot / samples.length < ratio) return false
    samples = []
    quietUntil = t + cooldownMs
    return true
  }
}
