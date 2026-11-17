import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'
import { MOD, shortcut } from './os'

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

describe('copyText', () => {
  afterEach(() => {
    setClipboard(undefined)
    vi.unstubAllGlobals()
    document.querySelector('dialog.copy-fallback')?.remove()
  })

  it('writes plain text when there is no HTML half', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard({ writeText })
    expect(await copyText('hello')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('writes both flavours when the browser can, so a rich-text box gets the list', async () => {
    class Item {
      parts: Record<string, Blob>
      constructor(parts: Record<string, Blob>) { this.parts = parts }
    }
    vi.stubGlobal('ClipboardItem', Item)
    const write = vi.fn(async (_items: Item[]) => {})
    const writeText = vi.fn(async () => {})
    setClipboard({ write, writeText })
    expect(await copyText('- a', '<ul><li>a</li></ul>')).toBe(true)
    expect(Object.keys(write.mock.calls[0]![0][0]!.parts)).toEqual(['text/plain', 'text/html'])
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to plain text when the rich write is refused', async () => {
    vi.stubGlobal('ClipboardItem', class {})
    const writeText = vi.fn(async () => {})
    setClipboard({ write: async () => { throw new Error('denied') }, writeText })
    expect(await copyText('- a', '<ul></ul>')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('- a')
  })

  it('with no clipboard at all, shows the text in a dialog, selected, and one dialog at a time', async () => {
    setClipboard({ writeText: async () => { throw new Error('denied') } })
    expect(await copyText('first')).toBe(false)
    setClipboard(undefined)
    expect(await copyText('copy me')).toBe(false)
    const dialogs = document.querySelectorAll('dialog.copy-fallback')
    expect(dialogs).toHaveLength(1)
    const ta = dialogs[0]!.querySelector('textarea')!
    expect(ta.value).toBe('copy me')
    expect(document.activeElement).toBe(ta)
    ;(dialogs[0] as HTMLDialogElement).close()
    expect(document.querySelector('dialog.copy-fallback')).toBeNull()
  })
})

describe('shortcut hints', () => {
  it('are written for the platform the page runs on (not a Mac here)', () => {
    expect(MOD).toBe('Ctrl')
    expect(shortcut('⌘Enter')).toBe('Ctrl+Enter')
    expect(shortcut('⌘⇧7')).toBe('Ctrl+Shift+7')
    expect(shortcut('Tab')).toBe('Tab')
  })
})
