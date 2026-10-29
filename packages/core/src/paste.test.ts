import { describe, expect, it } from 'vitest'
import { insertOutline, parseOutline, toOutline } from './paste'
import { idOf, pad, shape, testCtx } from './testing'

// What Google Docs gives you when you copy the inbox as plain text: tabs per level,
// a bullet glyph per level, numbered top level, a blank line between sections.
const DOCS = [
  '1. IGS Meal Planning - tonight too',
  '2. Job Hunt (before 9pm)',
  '3. (breaktime) Bathe!',
  '6. Personal Website',
  '\t• Fix current copy: now -> about -> home',
  '\t• Write about Astro and the book tracker code',
  '\t\t○ sub point',
  '\t• Project: YTCH clone',
  '7. Make eggnog: https://cheneetoday.com/oat-milk-eggnog/',
  '',
  '',
  '• Lyrics: Review EN lyrics',
  '• Government req: review timeline',
  '',
  'WL:',
  '   -   Audre Lorde on Eroticism',
  '   -   Ben Rosenberg',
  '',
].join('\n')

describe('parseOutline', () => {
  it('reads depth from indentation and strips bullets', () => {
    expect(parseOutline(DOCS)).toEqual([
      { text: 'IGS Meal Planning - tonight too', depth: 0, numbered: true },
      { text: 'Job Hunt (before 9pm)', depth: 0, numbered: true },
      { text: '(breaktime) Bathe!', depth: 0, numbered: true },
      { text: 'Personal Website', depth: 0, numbered: true },
      { text: 'Fix current copy: now -> about -> home', depth: 1 },
      { text: 'Write about Astro and the book tracker code', depth: 1 },
      { text: 'sub point', depth: 2 },
      { text: 'Project: YTCH clone', depth: 1 },
      { text: 'Make eggnog: https://cheneetoday.com/oat-milk-eggnog/', depth: 0, numbered: true },
      { text: '', depth: 0 },
      { text: 'Lyrics: Review EN lyrics', depth: 0 },
      { text: 'Government req: review timeline', depth: 0 },
      { text: '', depth: 0 },
      { text: 'WL:', depth: 0 },
      { text: 'Audre Lorde on Eroticism', depth: 1 },
      { text: 'Ben Rosenberg', depth: 1 },
    ])
  })

  it('handles 2-space and 4-space indents and CRLF', () => {
    expect(parseOutline('a\r\n  b\r\n    c\r\n  d\r\ne')).toEqual([
      { text: 'a', depth: 0 }, { text: 'b', depth: 1 }, { text: 'c', depth: 2 }, { text: 'd', depth: 1 }, { text: 'e', depth: 0 },
    ])
    expect(parseOutline('a\n    b\n        c').map((l) => l.depth)).toEqual([0, 1, 2])
  })

  it('does not strip a bullet-like start that has no space after it', () => {
    expect(parseOutline('-rc1 is out\n1.5 hours\n*emphasis*')).toEqual([
      { text: '-rc1 is out', depth: 0 }, { text: '1.5 hours', depth: 0 }, { text: '*emphasis*', depth: 0 },
    ])
  })

  it('returns nothing for whitespace', () => {
    expect(parseOutline('\n\n  \n')).toEqual([])
  })
})

describe('insertOutline', () => {
  it('builds the tree, clamping depth jumps', () => {
    const ctx = testCtx()
    const { rows, ids } = insertOutline({}, ctx, [
      { text: 'a', depth: 0 }, { text: 'b', depth: 3 }, { text: 'c', depth: 1 }, { text: 'd', depth: 0 },
    ], { parentId: null, afterId: null })
    expect(ids).toHaveLength(4)
    expect(shape(rows)).toBe('a\n  b\n  c\nd')
  })

  it('inserts between existing siblings at the placement', () => {
    const ctx = testCtx()
    const rows = pad('A\nB\n  B1\nC', ctx)
    const { rows: out } = insertOutline(rows, ctx, parseOutline('x\n  y\nz'), { parentId: null, afterId: idOf(rows, 'B') })
    expect(shape(out)).toBe('A\nB\n  B1\nx\n  y\nz\nC')
    const { rows: out2 } = insertOutline(rows, ctx, parseOutline('first'), { parentId: idOf(rows, 'B'), afterId: null })
    expect(shape(out2)).toBe('A\nB\n  first\n  B1\nC')
  })

  it('round-trips the Docs inbox', () => {
    const ctx = testCtx()
    const rows = pad(DOCS, ctx)
    expect(shape(rows)).toBe(
      [
        '1.IGS Meal Planning - tonight too', '2.Job Hunt (before 9pm)', '3.(breaktime) Bathe!', '4.Personal Website',
        '  Fix current copy: now -> about -> home', '  Write about Astro and the book tracker code', '    sub point',
        '  Project: YTCH clone', '5.Make eggnog: https://cheneetoday.com/oat-milk-eggnog/', '', 'Lyrics: Review EN lyrics',
        'Government req: review timeline', '', 'WL:', '  Audre Lorde on Eroticism', '  Ben Rosenberg',
      ].join('\n'),
    )
    const text = toOutline(rows, Object.keys(rows))
    expect(shape(pad(text, testCtx()))).toBe(shape(rows))
  })
})

describe('toOutline', () => {
  it('writes topmost nodes with their subtrees and marks done', () => {
    const ctx = testCtx()
    const rows = pad('A\n  A1\n    A1a\n  A2\nB', ctx)
    const a1 = idOf(rows, 'A1')
    const done = { ...rows, [a1]: { ...rows[a1]!, done: true } }
    expect(toOutline(done, [idOf(rows, 'A'), a1])).toBe('- A\n  - A1 (done)\n    - A1a\n  - A2')
    expect(toOutline(done, [a1], { bullet: '', indent: '\t', done: ' x' })).toBe('A1 x\n\tA1a')
  })
})

describe('header lines', () => {
  it('keeps "# " markers as headers and round-trips them', () => {
    const lines = parseOutline('# Title\n\t## Sub\n\t- plain\n#hashtag stays text')
    expect(lines.map((l) => [l.text, l.header === true])).toEqual([
      ['Title', true], ['Sub', true], ['plain', false], ['#hashtag stays text', false],
    ])
    const ctx = testCtx()
    const rows = pad('# Title\n\t1. one\n\t2. two\n# Next', ctx)
    expect(shape(rows)).toBe('#Title\n  1.one\n  2.two\n#Next')
    const text = toOutline(rows, Object.keys(rows), { bullet: '', indent: '\t' })
    expect(text).toBe('# Title\n\t1. one\n\t2. two\n# Next')
    expect(shape(pad(text, testCtx()))).toBe(shape(rows))
  })
})

describe('numbered lines', () => {
  it('keeps "1." markers as numbered lines and round-trips them', () => {
    const lines = parseOutline('1. one\n2. two\n• plain\n1) again\n\t3. nested')
    expect(lines.map((l) => [l.text, l.numbered === true])).toEqual([
      ['one', true], ['two', true], ['plain', false], ['again', true], ['nested', true],
    ])
    const ctx = testCtx()
    const rows = pad('1. one\n2. two\n• plain\n1) again\n\t3. nested', ctx)
    expect(shape(rows)).toBe('1.one\n2.two\nplain\n1.again\n  1.nested')
    const text = toOutline(rows, Object.keys(rows), { bullet: '', indent: '\t' })
    expect(text).toBe('1. one\n2. two\nplain\n1. again\n\t1. nested')
    expect(shape(pad(text, testCtx()))).toBe(shape(rows))
  })
})
