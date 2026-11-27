// Inline marks, detected from the text and never stored: **bold**, *italic* or _italic_,
// __underline__, ~~strikethrough~~, ==highlight== and `code`. The symbols stay in the text
// and stay visible; a span only says how to draw a stretch of it.
//
// Code goes first, as in Markdown: a run of backticks closes on the next run of the same
// length on the same line, and nothing inside it is a mark, an escape or a link. Outside
// code, a backslash before any ASCII punctuation makes that character plain (\*not italic\*);
// the backslash stays in the text too.
//
// What keeps stray symbols from styling a line (the flanking rule Markdown uses, a notch
// stricter): an opening mark touches the word after it and no letter or digit before it,
// a closing mark touches the word before it and no letter or digit after it. So 2 * 3 * 4,
// 5*3*2, snake_case_name and *.txt stay plain. Marks inside a URL are not marks, a mark
// never reaches across a line break, and one with no partner is just a character.

export interface InlineSpan {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  highlight: boolean
  code: boolean
}
type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'code'

// A URL ends before any trailing mark characters, so **see https://x.com** still closes.
export const URL_RE = /https?:\/\/[^\s<>"')\]]*[^\s<>"')\]*_~=`]/g

const WORD = /[\p{L}\p{N}]/u
const SPACE = /\s/
const PUNCT = /[!-/:-@[-`{-~]/
const MARKS: Record<string, Mark> = { '**': 'bold', '*': 'italic', _: 'italic', __: 'underline', '~~': 'strike', '==': 'highlight' }

interface Token { at: number; len: number; sym: string; open: boolean; close: boolean }

// The code spans (backticks included) and the positions a backslash made plain.
function literals(text: string): { code: [number, number][]; escaped: Set<number> } {
  const code: [number, number][] = []
  const escaped = new Set<number>()
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\' && i + 1 < text.length && PUNCT.test(text[i + 1]!)) {
      escaped.add(i + 1)
      i += 2
    } else if (ch === '`') {
      let j = i
      while (text[j] === '`') j++
      const n = j - i
      let end = -1
      for (let k = j; k < text.length && text[k] !== '\n'; ) {
        if (text[k] !== '`') { k++; continue }
        let m = k
        while (text[m] === '`') m++
        if (m - k === n) { end = m; break }
        k = m
      }
      if (end > j) {
        code.push([i, end])
        i = end
      } else i = j
    } else i++
  }
  return { code, escaped }
}

function tokens(text: string, code: [number, number][], escaped: Set<number>): Token[] {
  const skip: [number, number][] = [...code]
  for (const m of text.matchAll(URL_RE)) skip.push([m.index!, m.index! + m[0].length])
  const out: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if ((ch !== '*' && ch !== '_' && ch !== '~' && ch !== '=') || escaped.has(i)) { i++; continue }
    let j = i
    while (text[j] === ch && !escaped.has(j)) j++
    const at = i
    const n = j - i
    i = j
    if (skip.some(([a, b]) => at >= a && at < b)) continue
    const prev = text[at - 1]
    const next = text[j]
    const open = next !== undefined && !SPACE.test(next) && (prev === undefined || !WORD.test(prev))
    const close = prev !== undefined && !SPACE.test(prev) && (next === undefined || !WORD.test(next))
    if (!open && !close) continue
    const one = { open, close }
    if (ch === '~' || ch === '=') {
      if (n === 2) out.push({ at, len: 2, sym: ch + ch, ...one })
    } else if (n === 1 || n === 2) {
      out.push({ at, len: n, sym: ch.repeat(n), ...one })
    } else if (n === 3) {
      // ***both***: the double mark is the outer one on either side.
      const outer = { len: 2, sym: ch + ch, ...one }
      const inner = { len: 1, sym: ch, ...one }
      if (close && !open) out.push({ at, ...inner }, { at: at + 1, ...outer })
      else out.push({ at, ...outer }, { at: at + 2, ...inner })
    }
  }
  return out
}

export function inlineSpans(text: string): InlineSpan[] {
  const plain = (t: string): InlineSpan => ({ text: t, bold: false, italic: false, underline: false, strike: false, highlight: false, code: false })
  if (text === '') return []
  if (!/[*_~=`]/.test(text)) return [plain(text)]
  const { code, escaped } = literals(text)
  // Pair the marks with a stack: a closer takes the nearest opener of its own symbol on the
  // same line, and whatever was opened after that one and never closed is dropped.
  const ranges: { from: number; to: number; mark: Mark }[] = code.map(([from, to]) => ({ from, to, mark: 'code' as const }))
  const stack: Token[] = []
  for (const t of tokens(text, code, escaped)) {
    let k = -1
    if (t.close) {
      for (let s = stack.length - 1; s >= 0; s--) {
        const o = stack[s]!
        if (o.sym !== t.sym) continue
        if (o.at + o.len < t.at && !text.slice(o.at, t.at).includes('\n')) k = s
        break
      }
    }
    if (k >= 0) {
      ranges.push({ from: stack[k]!.at, to: t.at + t.len, mark: MARKS[t.sym]! })
      stack.length = k
    } else if (t.open) stack.push(t)
  }
  if (ranges.length === 0) return [plain(text)]
  const cuts = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.from, r.to])])].sort((a, b) => a - b)
  const out: InlineSpan[] = []
  for (let c = 0; c + 1 < cuts.length; c++) {
    const a = cuts[c]!
    const b = cuts[c + 1]!
    const span = plain(text.slice(a, b))
    for (const r of ranges) if (r.from <= a && b <= r.to) span[r.mark] = true
    out.push(span)
  }
  return out
}

// Small caps drawn by hand, for a platform whose font has none to switch on (Charter on
// iOS): the text in capitals, cut into runs of letters that were already capitals (`small`
// false, drawn at full size) and the rest (`small` true, drawn a size down). A section
// divider's words are drawn this way on the phone; the web asks the browser for small caps.
export function smallCapsRuns(text: string): { text: string; small: boolean }[] {
  const out: { text: string; small: boolean }[] = []
  for (const ch of text) {
    const small = ch !== ch.toUpperCase()
    const last = out.at(-1)
    if (last && last.small === small) last.text += ch.toUpperCase()
    else out.push({ text: ch.toUpperCase(), small })
  }
  return out
}
