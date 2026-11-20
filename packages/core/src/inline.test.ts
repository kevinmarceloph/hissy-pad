import { describe, expect, it } from 'vitest'
import { inlineSpans, URL_RE } from './inline'

// "b:**x**" style shorthand: each styled span as flags:text, plain spans as the text.
const show = (text: string) =>
  inlineSpans(text).map((s) => {
    const f = (s.bold ? 'b' : '') + (s.italic ? 'i' : '') + (s.underline ? 'u' : '') + (s.strike ? 's' : '')
    return f ? `${f}:${s.text}` : s.text
  })

describe('inline marks', () => {
  it('bold, italic, underline and strikethrough, symbols kept in the text', () => {
    expect(show('a **b** c')).toEqual(['a ', 'b:**b**', ' c'])
    expect(show('*i* and _i_')).toEqual(['i:*i*', ' and ', 'i:_i_'])
    expect(show('__u__ ~~s~~')).toEqual(['u:__u__', ' ', 's:~~s~~'])
    expect(show('**two words**, then.')).toEqual(['b:**two words**', ', then.'])
    expect(inlineSpans('**b** x').map((s) => s.text).join('')).toBe('**b** x')
  })

  it('marks nest, and three stars are bold and italic', () => {
    expect(show('**a _b_ c**')).toEqual(['b:**a ', 'bi:_b_', 'b: c**'])
    expect(show('***x***')).toEqual(['b:**', 'bi:*x*', 'b:**'])
    expect(show('~~__x__~~')).toEqual(['s:~~', 'us:__x__', 's:~~'])
  })

  it('stray symbols stay plain', () => {
    for (const t of [
      '2 * 3 * 4', '5*3*2', 'snake_case_name', 'a_b and c_d', '*.txt and *.md', '* a list item * here',
      '**', '****', '** **', '*', 'a ** b ** c', '~tilde~', '1 ~ 2 ~ 3', '~/code and ~/docs', '_ _', '**open only', 'close only**',
      'mid*word*mid', '* spaced *', '****x****',
    ]) expect(show(t), t).toEqual([t])
    expect(show('')).toEqual([])
  })

  it('a mark does not reach across a line break or out of order', () => {
    expect(show('*a\nb*')).toEqual(['*a\nb*'])
    expect(show('*a **b* c**')).toEqual(['i:*a **b*', ' c**'])
    expect(show('*a *b*')).toEqual(['*a ', 'i:*b*'])
  })

  it('marks inside a URL are not marks, and a URL stops before a closing mark', () => {
    expect(show('https://x.com/_a_/b_c_d and _e_')).toEqual(['https://x.com/_a_/b_c_d and ', 'i:_e_'])
    expect(show('**see https://x.com/a_b**')).toEqual(['b:**see https://x.com/a_b**'])
    expect('**see https://x.com/a_b**'.match(URL_RE)).toEqual(['https://x.com/a_b'])
  })

  it('works beside punctuation and other scripts', () => {
    expect(show('("*quoted*")')).toEqual(['("', 'i:*quoted*', '")'])
    expect(show('está_bien_así')).toEqual(['está_bien_así'])
    expect(show('**日本語**')).toEqual(['b:**日本語**'])
  })
})
