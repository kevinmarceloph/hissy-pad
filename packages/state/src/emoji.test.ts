// A category's emoji in front of a line puts the line in that category.
import { beforeEach, describe, expect, it } from 'vitest'
import { emojiCategory, idOf, iconMap } from '@hissypad/core'
import { resetStore } from './testing'
import { loadPad, usePad } from './store'
import { undo } from './history'
import { cmdSetText, cmdTextChanged } from './commands'
import { adoptLineCategories, EMOJI_DONE_KEY, resetEmojiClassify } from './hours/line-categories'

const cats = [
  { id: 'cart', label: 'Errands', icon: '🛒', color: 'blue', position: 0, archived: false, updatedAt: 0 },
  { id: 'heart', label: 'Health', icon: '❤️', color: 'red', position: 1, archived: false, updatedAt: 0 },
  { id: 'old', label: 'Old', icon: '📦', color: 'grey', position: 2, archived: true, updatedAt: 0 },
] as Parameters<typeof adoptLineCategories>[0]
const all = () => usePad.getState().all
const row = (t: string) => all()[idOf(all(), t)]!

describe('the rule', () => {
  const icons = iconMap(cats)
  it('needs the emoji, then a space; matches with or without the variation selector; skips archived ones', () => {
    expect(emojiCategory('🛒 oat milk', icons)).toEqual({ category: 'cart', text: 'oat milk' })
    expect(emojiCategory('🛒', icons)).toBeNull()
    expect(emojiCategory('🛒oat', icons)).toBeNull()
    expect(emojiCategory('❤ run', icons)).toEqual({ category: 'heart', text: 'run' })
    expect(emojiCategory('📦 box', icons)).toBeNull()
    expect(emojiCategory('oat 🛒 milk', icons)).toBeNull()
  })
})

describe('in the store', () => {
  let mem: ReturnType<typeof resetStore>
  beforeEach(async () => {
    adoptLineCategories([])
    resetEmojiClassify()
    mem = resetStore('🛒 milk\n  ❤️ walk\nplain')
    await loadPad()
  })

  it('once per device, lines already there are classified, with no undo step', async () => {
    expect(row('🛒 milk').category).toBeNull()
    adoptLineCategories(cats)
    await new Promise((r) => setTimeout(r, 0))
    expect(row('milk').category).toBe('cart')
    expect(row('walk').category).toBe('heart')
    expect(row('plain').category).toBeNull()
    expect(usePad.getState().past).toHaveLength(0)
    expect(await mem.getMeta(EMOJI_DONE_KEY)).toBe('1')
  })

  it('typing the emoji and a space classifies the line as an edit, and undo takes it back', async () => {
    await mem.setMeta(EMOJI_DONE_KEY, '1')
    adoptLineCategories(cats)
    await new Promise((r) => setTimeout(r, 0))
    const id = idOf(all(), 'plain')
    expect(cmdTextChanged(id, '🛒')).toBe('🛒')
    expect(cmdTextChanged(id, '🛒 ')).toBe('')
    expect(all()[id]!.category).toBe('cart')
    cmdSetText(id, 'eggs')
    expect(all()[id]!.category).toBe('cart')
    undo()
    undo()
    expect(all()[id]!.text).toBe('plain')
    expect(all()[id]!.category).toBeNull()
  })
})
