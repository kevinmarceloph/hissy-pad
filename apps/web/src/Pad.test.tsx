import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryStore, pad, shape } from '@hissypad/core'
import { App } from './App'
import { configureLocalStore, usePad } from './store'

async function mount(outline?: string) {
  const rows = outline ? pad(outline) : {}
  configureLocalStore(createMemoryStore(Object.values(rows)))
  usePad.setState({ rows: {}, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [] })
  const utils = render(<App />)
  await screen.findByRole('tree')
  return utils
}

const texts = () => shape(usePad.getState().rows)
const rowByText = (t: string) => screen.getAllByRole('treeitem').find((el) => (el.textContent ?? '').replace(/\u200b/g, '').trim() === t)!
const startEditing = async (t: string) => {
  const row = rowByText(t)
  // Clicking the static text starts editing; jsdom has no caret-from-point so it lands at the end.
  await userEvent.pointer({ keys: '[MouseLeft>]', target: row.querySelector('.text')! })
  const ta = await within(row).findByRole('textbox')
  return ta as HTMLTextAreaElement
}

describe('Pad', () => {
  beforeEach(() => {
    // jsdom lacks scrollIntoView
    Element.prototype.scrollIntoView = () => {}
  })

  it('shows the hint on a fresh pad and lets you type', async () => {
    await mount()
    expect(screen.getByText(/Type anything/)).toBeInTheDocument()
    const ta = await startEditing('')
    await userEvent.type(ta, 'hello')
    expect(texts()).toBe('hello')
  })

  it('Enter splits, Tab indents, Shift+Tab outdents', async () => {
    const user = userEvent.setup()
    await mount('first')
    await startEditing('first')
    await user.keyboard('{Enter}second')
    expect(texts()).toBe('first\nsecond')
    await user.keyboard('{Tab}')
    expect(texts()).toBe('first\n  second')
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(texts()).toBe('first\nsecond')
  })

  it('Backspace at the start merges into the line above', async () => {
    const user = userEvent.setup()
    await mount('ab\ncd')
    const ta = await startEditing('cd')
    ta.setSelectionRange(0, 0)
    await user.keyboard('{Backspace}')
    expect(texts()).toBe('abcd')
    const editing = usePad.getState().editing!
    expect(editing.caret).toBe(2)
  })

  it('Escape selects the line; Cmd+Enter crosses it out; Delete removes it', async () => {
    const user = userEvent.setup()
    await mount('one\ntwo')
    await startEditing('one')
    await user.keyboard('{Escape}')
    expect(usePad.getState().selection).toHaveLength(1)
    expect(screen.getByRole('toolbar', { name: 'Selected lines' })).toBeInTheDocument()
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(texts()).toBe('~one\ntwo')
    await user.keyboard('{Delete}')
    expect(texts()).toBe('two')
  })

  it('Shift+Down extends the selection and Tab indents the block', async () => {
    const user = userEvent.setup()
    await mount('a\nb\nc\nd')
    await startEditing('b')
    await user.keyboard('{Escape}{Shift>}{ArrowDown}{/Shift}')
    expect(usePad.getState().selection).toHaveLength(2)
    await user.keyboard('{Tab}')
    expect(texts()).toBe('a\n  b\n  c\nd')
  })

  it('multi-line paste becomes nested lines after the current one', async () => {
    const user = userEvent.setup()
    await mount('top\nlast')
    await startEditing('top')
    await user.paste('x\n\ty\nz')
    expect(texts()).toBe('top\nx\n  y\nz\nlast')
  })

  it('bullet click selects, shift-click ranges, toggle folds', async () => {
    const user = userEvent.setup()
    await mount('p\n  c1\n  c2\nq')
    await user.click(within(rowByText('p')).getByRole('button', { name: /Select line/ }))
    await user.keyboard('{Shift>}')
    await user.click(within(rowByText('q')).getByRole('button', { name: /Select line/ }))
    await user.keyboard('{/Shift}')
    expect(usePad.getState().selection).toHaveLength(4)
    await user.keyboard('{Escape}')
    await user.click(within(rowByText('p')).getByRole('button', { name: 'Collapse' }))
    expect(screen.getAllByRole('treeitem')).toHaveLength(2)
  })

  it('Delete done removes crossed-out lines and says how to undo', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    expect(screen.getByRole('button', { name: 'Delete done' })).toBeDisabled()
    await startEditing('a')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(texts()).toBe('~a\nb')
    expect(rowByText('a').className).toContain('is-done')
    await user.click(screen.getByRole('button', { name: 'Delete done' }))
    expect(texts()).toBe('b')
    expect(screen.getByRole('status')).toHaveTextContent(/Deleted 1 line/)
  })

  it('Cmd+Shift+7 numbers a run of lines; Enter continues the numbering', async () => {
    const user = userEvent.setup()
    await mount('a\nb\nc')
    await startEditing('a')
    await user.keyboard('{Escape}{Shift>}{ArrowDown}{/Shift}')
    await user.keyboard('{Meta>}{Shift>}7{/Shift}{/Meta}')
    expect(texts()).toBe('1.a\n2.b\nc')
    expect(within(rowByText('a')).getByRole('button', { name: /Select line|Deselect line/ })).toHaveAttribute('data-num', '1.')
    await user.keyboard('{Enter}') // edit b
    await user.keyboard('{Enter}b2')
    expect(texts()).toBe('1.a\n2.b\n3.b2\nc')
    await user.keyboard('{Escape}')
    await user.click(within(rowByText('c')).getByRole('button', { name: /Select line/ }))
    await user.click(screen.getByRole('button', { name: 'Numbered list' }))
    expect(texts()).toBe('1.a\n2.b\n3.b2\n4.c')
  })

  it('empty lines have no visible bullet until text is typed', async () => {
    const user = userEvent.setup()
    await mount('x')
    await startEditing('x')
    await user.keyboard('{Enter}')
    const blank = screen.getAllByRole('treeitem')[1]!
    expect(blank.className).toContain('is-empty')
    await user.keyboard('y')
    expect(blank.className).not.toContain('is-empty')
  })

  it('shows the storage banner when the store fails', async () => {
    configureLocalStore({
      getAll: async () => { throw new Error('quota') },
      upsertMany: async () => {}, dirtyIds: async () => [], markClean: async () => {},
      getMeta: async () => null, setMeta: async () => {},
    })
    usePad.setState({ rows: {}, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [] })
    render(<App />)
    await screen.findByRole('tree')
    expect(screen.getByRole('alert')).toHaveTextContent(/Local storage is unavailable/)
    await act(async () => {})
  })
})
