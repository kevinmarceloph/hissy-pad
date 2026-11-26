// The keyboard: keys inside a line being edited (Row) and keys with lines selected (Pad).
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { idOf, shape } from '@hissypad/core'
import { resetStore, select, setClipboard, usePad } from '@hissypad/state'
import { copyText } from '../platform/clipboard'
import { App } from '../app/App'

async function mount(outline: string) {
  resetStore(outline)
  render(<App />)
  await screen.findByRole('tree')
}

const texts = () => shape(usePad.getState().rows)
const id = (t: string) => idOf(usePad.getState().rows, t)
const picked = () => usePad.getState().selection.map((i) => usePad.getState().rows[i]!.text)
const rowByText = (t: string) => screen.getAllByRole('treeitem').find((el) => (el.textContent ?? '').replace(/​/g, '').trim() === t)!
async function editLine(t: string) {
  const row = rowByText(t)
  await userEvent.pointer({ keys: '[MouseLeft>]', target: row.querySelector('.text')! })
  return (await within(row).findByRole('textbox')) as HTMLTextAreaElement
}
const pick = (...ts: string[]) => select(ts.map(id), id(ts[0]!), id(ts.at(-1)!))

describe('keys while editing a line', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('Shift+Down at the end of the line selects it with its next sibling; Shift+Up at the start with the previous one', async () => {
    const user = userEvent.setup()
    await mount('A\nB\n  B1\nC')
    await editLine('B')
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(usePad.getState().editing).toBeNull()
    expect(picked()).toEqual(['B', 'C'])
    await editLine('B')
    const ta = (await within(rowByText('B')).findByRole('textbox')) as HTMLTextAreaElement
    ta.setSelectionRange(0, 0)
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}')
    expect(picked()).toEqual(['A', 'B'])
  })

  it('Tab nests, Shift+Tab unnests, Alt+arrows and Cmd+Shift+arrows move, Cmd+. folds, Cmd+Shift+7 numbers', async () => {
    const user = userEvent.setup()
    await mount('a\nb\n  b1\nc')
    await editLine('c')
    await user.keyboard('{Tab}')
    expect(texts()).toBe('a\nb\n  b1\n  c')
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(texts()).toBe('a\nb\n  b1\nc')
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(texts()).toBe('a\nc\nb\n  b1')
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(texts()).toBe('a\nb\n  b1\nc')
    await user.keyboard('{Meta>}{Shift>}{ArrowUp}{/Shift}{/Meta}')
    expect(texts()).toBe('a\nc\nb\n  b1')
    await user.keyboard('{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}')
    expect(texts()).toBe('a\nb\n  b1\nc')
    await user.keyboard('{Control>}{Shift>}7{/Shift}{/Control}')
    expect(texts()).toBe('1.a\n2.b\n  b1\n3.c')
    await editLine('b')
    await user.keyboard('{Control>}.{/Control}')
    expect(usePad.getState().rows[id('b')]!.collapsed).toBe(true)
  })

  it('Cmd+Enter crosses out, Cmd+Z undoes and Shift+Cmd+Z redoes, Cmd+Shift+Backspace deletes the line', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    await editLine('a')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(texts()).toBe('~a\nb')
    await user.keyboard('{Control>}z{/Control}')
    expect(texts()).toBe('a\nb')
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(texts()).toBe('~a\nb')
    await editLine('b')
    await user.keyboard('{Control>}{Shift>}{Backspace}{/Shift}{/Control}')
    expect(texts()).toBe('~a')
  })

  it('Enter with text selected replaces it with the split; Esc selects the line; arrows cross lines', async () => {
    const user = userEvent.setup()
    await mount('hello\nb')
    const ta = await editLine('hello')
    ta.setSelectionRange(1, 3)
    await user.keyboard('{Enter}')
    expect(texts()).toBe('h\nlo\nb')
    await user.keyboard('{ArrowDown}')
    expect(usePad.getState().editing?.id).toBe(id('b'))
    await user.keyboard('{ArrowUp}')
    expect(usePad.getState().editing?.id).toBe(id('lo'))
    await user.keyboard('{Escape}')
    expect(picked()).toEqual(['lo'])
    expect(usePad.getState().editing).toBeNull()
  })

  it('pasting several lines into a line makes lines of them', async () => {
    const user = userEvent.setup()
    await mount('a')
    await editLine('a')
    await user.paste('x\n  y')
    expect(texts()).toBe('a\nx\n  y')
  })
})

describe('keys with lines selected', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('arrows step and Shift extends; Tab, Alt+arrows, Cmd+Enter, Cmd+. and Cmd+Shift+7 act on the selection', async () => {
    const user = userEvent.setup()
    await mount('a\nb\n  b1\nc')
    pick('a')
    await user.keyboard('{ArrowDown}')
    expect(picked()).toEqual(['b'])
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(picked()).toEqual(['b', 'b1'])
    await user.keyboard('{ArrowUp}')
    expect(picked()).toEqual(['b'])
    await user.keyboard('{Control>}.{/Control}')
    expect(usePad.getState().rows[id('b')]!.collapsed).toBe(true)
    await user.keyboard('{Control>}.{/Control}')
    pick('c')
    await user.keyboard('{Tab}')
    expect(texts()).toBe('a\nb\n  b1\n  c')
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(texts()).toBe('a\nc\nb\n  b1')
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(texts()).toBe('a\nb\n  b1\n~c')
    await user.keyboard('{Control>}{Shift>}7{/Shift}{/Control}')
    expect(texts()).toBe('1.a\n2.b\n  b1\n3.~c')
  })

  it('Enter edits, Esc clears, Delete removes, Cmd+A selects all, Cmd+Z undoes', async () => {
    const user = userEvent.setup()
    await mount('a\nb\nc')
    pick('b')
    await user.keyboard('{Delete}')
    expect(texts()).toBe('a\nc')
    expect(picked()).toEqual(['c'])
    await user.keyboard('{Control>}z{/Control}')
    expect(texts()).toBe('a\nb\nc')
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(texts()).toBe('a\nc')
    await user.keyboard('{Escape}')
    expect(picked()).toEqual([])
    await user.keyboard('{Control>}a{/Control}')
    expect(picked()).toEqual(['a', 'c'])
    pick('c')
    await user.keyboard('{Enter}')
    expect(usePad.getState().editing).toMatchObject({ id: id('c'), caret: 'end' })
  })

  it('Cmd+C copies the outline, Cmd+X cuts it, and a paste lands after the selection', async () => {
    const user = userEvent.setup()
    setClipboard(copyText) // main.tsx does this in the real app
    await mount('a\n  a1\nb')
    pick('a')
    await user.keyboard('{Control>}c{/Control}')
    expect(await navigator.clipboard.readText()).toBe('- a\n  - a1')
    pick('b')
    fireEvent.paste(window, { clipboardData: { getData: () => 'p\n  q' } })
    expect(texts()).toBe('a\n  a1\nb\np\n  q')
    expect(picked()).toEqual(['p', 'q'])
    pick('b')
    await user.keyboard('{Control>}x{/Control}')
    expect(texts()).toBe('a\n  a1\np\n  q')
    usePad.setState({ selection: [] })
    fireEvent.paste(window, { clipboardData: { getData: () => 'ignored' } })
    expect(texts()).toBe('a\n  a1\np\n  q') // nothing selected: the paste is left alone
  })
})
