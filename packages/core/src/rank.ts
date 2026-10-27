// Fractional indexing over base-62 strings, same shape as the `fractional-indexing`
// package (Rocicorp): an integer part that can grow in both directions plus an optional
// fraction. Plain string comparison (`<`) gives the order, which is exactly what Postgres
// `order by rank` and SQLite do with text, so no client or server ever needs the encoding.
//
// Integer part: one letter plus a fixed number of base-62 digits set by the letter.
//   'a' + 1 digit  ('a0' is zero, 'az' is 61), 'b' + 2 digits, ... 'z' + 26 digits
//   'Z' + 1 digit  ('Zz' is -1), 'Y' + 2 digits, ... 'A' + 26 digits
// So appending at the end walks a0, a1, ... az, b00, b01 and prepending at the top walks
// Zz, Zy, ... Z0, Yzz: a run of inserts at either end costs no extra characters for a long
// time. Only repeated inserts into the same gap lengthen the fraction.
//
// Invariants:
//   - a fraction never ends in '0', so there is always room below any key's last digit
//   - between(a, b) returns k with a < k < b for a < b; null means the open end
//   - a move touches one row: give it a new rank between its new neighbours
export const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
const ZERO = DIGITS[0]!
const MAX = DIGITS[BASE - 1]!

function digitAt(s: string, i: number): number {
  const c = s[i]
  if (c === undefined) return 0
  const d = DIGITS.indexOf(c)
  if (d < 0) throw new Error(`rank: bad digit ${JSON.stringify(c)} in ${JSON.stringify(s)}`)
  return d
}

// Number of digits that follow a head letter, or -1 for a letter that is not a head.
function headDigits(letter: string): number {
  const c = letter.charCodeAt(0)
  if (c >= 97 && c <= 122) return c - 97 + 1 // a..z
  if (c >= 65 && c <= 90) return 90 - c + 1 // A..Z
  return -1
}

function intLength(key: string): number {
  const n = headDigits(key[0] ?? '')
  if (n < 0) throw new Error(`rank: bad head in ${JSON.stringify(key)}`)
  return 1 + n
}

function intPart(key: string): string {
  return key.slice(0, intLength(key))
}

function fracPart(key: string): string {
  return key.slice(intLength(key))
}

export function isValidRank(s: string): boolean {
  if (s.length === 0) return false
  const n = headDigits(s[0]!)
  if (n < 0 || s.length < 1 + n) return false
  for (let i = 1; i < s.length; i++) if (!DIGITS.includes(s[i]!)) return false
  const frac = s.slice(1 + n)
  return !frac.endsWith(ZERO)
}

function incrementInt(int: string): string {
  const head = int[0]!
  const digits = int.slice(1).split('')
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!)
    if (d + 1 < BASE) {
      digits[i] = DIGITS[d + 1]!
      return head + digits.join('')
    }
    digits[i] = ZERO
  }
  // overflow: next head letter, all zeros
  if (head === 'z') throw new Error('rank: integer overflow')
  const next = head === 'Z' ? 'a' : String.fromCharCode(head.charCodeAt(0) + 1)
  return next + ZERO.repeat(headDigits(next))
}

function decrementInt(int: string): string {
  const head = int[0]!
  const digits = int.slice(1).split('')
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!)
    if (d - 1 >= 0) {
      digits[i] = DIGITS[d - 1]!
      return head + digits.join('')
    }
    digits[i] = MAX
  }
  if (head === 'A') throw new Error('rank: integer underflow')
  const prev = head === 'a' ? 'Z' : String.fromCharCode(head.charCodeAt(0) - 1)
  return prev + MAX.repeat(headDigits(prev))
}

// A fraction strictly between `a` ('' = the integer itself) and `b` (null = next integer).
function midFraction(a: string, b: string | null): string {
  let out = ''
  let hiOpen = b === null
  for (let i = 0; ; i++) {
    const da = digitAt(a, i)
    let db: number
    if (hiOpen) db = BASE
    else {
      if (i >= b!.length) throw new Error('rank: upper fraction exhausted (unreachable)')
      db = digitAt(b!, i)
    }
    if (da === db) {
      out += DIGITS[da]
      continue
    }
    if (db - da >= 2) return out + DIGITS[Math.floor((da + db) / 2)] // >= da + 1 >= 1, never '0'
    out += DIGITS[da]
    hiOpen = true
  }
}

export function between(a: string | null, b: string | null): string {
  if (a !== null && !isValidRank(a)) throw new Error(`rank: invalid lower ${JSON.stringify(a)}`)
  if (b !== null && !isValidRank(b)) throw new Error(`rank: invalid upper ${JSON.stringify(b)}`)
  if (a !== null && b !== null && a >= b) throw new Error(`rank: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`)

  if (a === null && b === null) return 'a0'
  if (a === null) {
    const ib = intPart(b!)
    // At the very bottom of the integer range (unreachable in practice) use the fraction.
    if (ib === 'A' + ZERO.repeat(26)) return ib + midFraction('', fracPart(b!))
    return decrementInt(ib)
  }
  if (b === null) {
    const ia = intPart(a)
    if (ia === 'z' + MAX.repeat(26)) return ia + midFraction(fracPart(a), null)
    return incrementInt(ia)
  }

  const ia = intPart(a)
  const ib = intPart(b)
  if (ia === ib) return ia + midFraction(fracPart(a), fracPart(b))
  const next = incrementInt(ia)
  if (next < ib) return next
  return ia + midFraction(fracPart(a), null)
}

// n keys strictly between a and b, split from the middle so a run of inserts (a paste)
// stays short and balanced.
export function ranksBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return []
  if (n === 1) return [between(a, b)]
  const mid = between(a, b)
  const left = Math.floor((n - 1) / 2)
  const right = n - 1 - left
  return [...ranksBetween(a, mid, left), mid, ...ranksBetween(mid, b, right)]
}

export function compareRank(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
