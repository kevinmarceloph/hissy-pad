import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { shape } from '@hissypad/core'
import { App } from '../app/App'
import { configureLocalStore, resetStore, usePad } from '@hissypad/state'
import { adoptLineCategories, cmdSetCategory } from '@hissypad/state/hours'
import { SAMPLE_CATEGORIES } from '@hissypad/core/hours'

async function mount(outline?: string) {
  resetStore(outline)
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

  it('seeds a welcome pad on first visit; clearing it leaves one line and the hint', async () => {
    const user = userEvent.setup()
    await mount()
    expect(rowByText('Welcome to HissyPad')).toBeTruthy()
    await user.click(within(rowByText('Today')).getByRole('button', { name: /Select line/ }))
    await user.keyboard('{Meta>}a{/Meta}{Delete}')
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

  it('Cmd+Shift+Backspace deletes the line being edited, caret anywhere', async () => {
    const user = userEvent.setup()
    await mount('one\ntwo\nthree')
    const ta = await startEditing('two')
    ta.setSelectionRange(2, 2)
    await user.keyboard('{Meta>}{Shift>}{Backspace}{/Shift}{/Meta}')
    expect(texts()).toBe('one\nthree')
    expect(usePad.getState().editing).toBeNull()
    expect(usePad.getState().selection).toEqual([rowByText('three').dataset.id])
  })

  it('Escape selects the line; Cmd+Enter crosses it out; Delete removes it', async () => {
    const user = userEvent.setup()
    await mount('one\ntwo')
    await startEditing('one')
    expect(screen.getByRole('toolbar', { name: 'Current line' })).toBeInTheDocument()
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

  it('bullet click selects, shift-click ranges; Fold in the toolbar folds, with no arrow beside the line', async () => {
    const user = userEvent.setup()
    await mount('p\n  c1\n  c2\nq')
    await user.click(within(rowByText('p')).getByRole('button', { name: /Select line/ }))
    await user.keyboard('{Shift>}')
    await user.click(within(rowByText('q')).getByRole('button', { name: /Select line/ }))
    await user.keyboard('{/Shift}')
    expect(usePad.getState().selection).toHaveLength(4)
    await user.keyboard('{Escape}')
    expect(within(rowByText('p')).queryByRole('button', { name: /Collapse|Expand$/ })).toBeNull()
    await user.click(within(rowByText('p')).getByRole('button', { name: /Select line/ }))
    await user.click(within(screen.getByRole('toolbar', { name: 'Selected lines' })).getByRole('button', { name: /^Fold/ }))
    expect(screen.getAllByRole('treeitem')).toHaveLength(2)
    expect(within(screen.getAllByRole('treeitem')[0]!).getByRole('button', { name: 'Expand 2 lines' })).toBeInTheDocument()
  })

  it('Clear completed removes crossed-out lines and says how to undo', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    expect(screen.queryByRole('button', { name: /completed/ })).toBeNull()
    await startEditing('a')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(texts()).toBe('~a\nb')
    expect(rowByText('a').className).toContain('is-done')
    await user.click(screen.getByRole('button', { name: 'Archive 1 completed' }))
    expect(texts()).toBe('b')
    expect(screen.getByRole('status')).toHaveTextContent(/Archived 1 line/)
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

  it('a header has a line of space under its group; clicking it adds a sub item to the header', async () => {
    const user = userEvent.setup()
    await mount('a\n  a1\nb')
    expect(screen.queryByRole('button', { name: /Add a line under/ })).toBeNull()
    await user.click(within(rowByText('a')).getByRole('button', { name: 'Select line' }))
    await user.click(screen.getByRole('button', { name: 'Header' }))
    const gap = screen.getByRole('button', { name: 'Add a line under a' })
    expect(gap.previousElementSibling).toBe(rowByText('a1')) // after the group, not the header
    await user.click(gap)
    await user.keyboard('a2')
    expect(texts()).toBe('#a\n  a1\n  a2\nb')
  })

  it('a tap on a line\'s category selects the line, as its bullet does', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    adoptLineCategories(SAMPLE_CATEGORIES)
    const a = Object.values(usePad.getState().rows).find((r) => r.text === 'a')!
    act(() => void cmdSetCategory('deep', [a.id]))
    const badge = await screen.findByRole('button', { name: 'Category: Deep work' })
    const row = badge.closest('[role="treeitem"]')!
    expect(row).toHaveAttribute('aria-selected', 'false')
    await user.click(badge)
    expect(row).toHaveAttribute('aria-selected', 'true')
    await user.click(badge)
    expect(row).toHaveAttribute('aria-selected', 'false')
    act(() => adoptLineCategories([]))
  })

  it('the type switcher turns a line into a header and back to a bullet', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    await user.click(within(rowByText('a')).getByRole('button', { name: /Select line/ }))
    expect(screen.getByRole('button', { name: 'Bullet' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Header' }))
    expect(texts()).toBe('#a\nb')
    expect(rowByText('a').className).toContain('is-header')
    expect(screen.getByRole('button', { name: 'Header' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Numbered list' }))
    expect(texts()).toBe('1.a\nb')
    expect(rowByText('a').className).not.toContain('is-header')
    await user.click(screen.getByRole('button', { name: 'Bullet' }))
    expect(texts()).toBe('a\nb')
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
    usePad.setState({ all: {}, rows: {}, padId: null, load: 'loading', storageError: null, editing: null, selection: [], anchorId: null, focusId: null, past: [], future: [] })
    render(<App />)
    await screen.findByRole('tree')
    expect(screen.getByRole('alert')).toHaveTextContent(/Local storage is unavailable/)
    await act(async () => {})
  })
})

describe('toolbar iteration', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('Enter at the start of a line adds a blank line above and moves the caret into it', async () => {
    const user = userEvent.setup()
    await mount('first\nsecond')
    const ta = await startEditing('second')
    ta.setSelectionRange(0, 0)
    await user.keyboard('{Enter}')
    expect(texts()).toBe('first\n\nsecond')
    expect(usePad.getState().rows[usePad.getState().editing!.id]!.text).toBe('')
    await user.keyboard('x')
    expect(texts()).toBe('first\nx\nsecond')
  })

  it('Enter mid-line splits and Enter at the end adds below', async () => {
    const user = userEvent.setup()
    await mount('abcd')
    const ta = await startEditing('abcd')
    ta.setSelectionRange(2, 2)
    await user.keyboard('{Enter}')
    expect(texts()).toBe('ab\ncd')
    await user.keyboard('{End}{Enter}z')
    expect(texts()).toBe('ab\ncd\nz')
  })

  it('shows the toolbar while editing, with impossible actions disabled', async () => {
    await mount('top\n  child\nlast')
    await startEditing('top')
    const bar = screen.getByRole('toolbar', { name: 'Current line' })
    expect(within(bar).getByRole('button', { name: 'Indent' })).toBeDisabled()   // first sibling
    expect(within(bar).getByRole('button', { name: 'Outdent' })).toBeDisabled()  // root
    expect(within(bar).getByRole('button', { name: 'Move up' })).toBeDisabled()  // already first
    expect(within(bar).getByRole('button', { name: 'Move down' })).toBeEnabled()
    expect(within(bar).getByRole('button', { name: 'Fold' })).toBeEnabled()      // has a child
    await startEditing('child')
    expect(within(bar).getByRole('button', { name: 'Fold' })).toBeDisabled()     // leaf
    expect(within(bar).getByRole('button', { name: 'Outdent' })).toBeEnabled()
    expect(within(bar).getByRole('button', { name: 'Indent' })).toBeDisabled()   // only child
    expect(within(bar).getByRole('button', { name: 'Move up' })).toBeDisabled()
    expect(within(bar).getByRole('button', { name: 'Move down' })).toBeDisabled()
  })

  it('+ above and + below insert blank lines next to the current one and edit them', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    await startEditing('a')
    await user.click(screen.getByRole('button', { name: 'Add a line below' }))
    await user.keyboard('a2')
    expect(texts()).toBe('a\na2\nb')
    await user.click(screen.getByRole('button', { name: 'Add a line above' }))
    await user.keyboard('a1')
    expect(texts()).toBe('a\na1\na2\nb')
  })

  it('the floating switch and Archive act on the line being edited', async () => {
    const user = userEvent.setup()
    await mount('x\ny')
    await startEditing('x')
    await user.click(screen.getByRole('radio', { name: 'Done' }))
    expect(texts()).toBe('~x\ny')
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(texts()).toBe('y')
  })

  it('selecting a parent washes its descendants fainter; a selected child keeps the full wash', async () => {
    const user = userEvent.setup()
    await mount('p\n  c\n    g\nq')
    await user.click(within(rowByText('p')).getByRole('button', { name: /Select line/ }))
    expect(rowByText('p')).toHaveClass('is-selected')
    expect(rowByText('c')).toHaveClass('is-selected-child')
    expect(rowByText('g')).toHaveClass('is-selected-child')
    expect(rowByText('q')).not.toHaveClass('is-selected-child')
    await user.keyboard('{Shift>}')
    await user.click(within(rowByText('c')).getByRole('button', { name: /Select line/ }))
    await user.keyboard('{/Shift}')
    expect(rowByText('p')).toHaveClass('is-selected')
    expect(rowByText('c')).toHaveClass('is-selected')
    expect(rowByText('c')).not.toHaveClass('is-selected-child')
    expect(rowByText('g')).toHaveClass('is-selected-child')
  })
})

describe('Archive and Done panels', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
  })

  it('a deleted line shows up in Archive and Restore puts it back, selected', async () => {
    const user = userEvent.setup()
    await mount('keep\ngone\n  gone child')
    await user.click(within(rowByText('gone')).getByRole('button', { name: /Select line/ }))
    await user.keyboard('{Delete}')
    expect(texts()).toBe('keep')
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))
    const dlg = screen.getByRole('dialog', { name: 'Archive' })
    expect(dlg).toHaveTextContent('Today')
    expect(dlg).toHaveTextContent('gone')
    expect(dlg).toHaveTextContent('+1 line under it')
    expect(dlg).toHaveTextContent('Archived lines stay here for 30 days.')
    await user.click(within(dlg).getByRole('button', { name: 'Restore' }))
    expect(texts()).toBe('keep\ngone\n  gone child')
    expect(usePad.getState().selection).toEqual([rowByText('gone').dataset.id])
    expect((dlg as HTMLDialogElement).open).toBe(false)
  })

  it('a crossed-out line shows up under Done and Undone clears it', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Recently done' }))
    let dlg = screen.getByRole('dialog', { name: 'Recently done' })
    expect(dlg).toHaveTextContent('Nothing is crossed out.')
    await user.click(within(dlg).getByRole('button', { name: 'Close' }))
    await startEditing('a')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(texts()).toBe('~a\nb')
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Recently done' }))
    dlg = screen.getByRole('dialog', { name: 'Recently done' })
    expect(within(dlg).getByText('a')).toHaveClass('is-done')
    await user.click(within(dlg).getByRole('button', { name: 'Undone' }))
    expect(texts()).toBe('a\nb')
    expect(dlg).toHaveTextContent('Nothing is crossed out.')
  })

  it('Ungroup in the toolbar brings a line\'s children out to its level; off for a leaf; one undo', async () => {
    const user = userEvent.setup()
    await mount('top\n  child\n    grand\n  other\nlast')
    await startEditing('last')
    const bar = screen.getByRole('toolbar', { name: 'Current line' })
    // Ungroup sits in the bar's dropdown with the other less used actions.
    await user.click(within(bar).getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Ungroup' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await startEditing('top')
    await user.click(within(bar).getByRole('button', { name: 'More actions' }))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Pin to top', 'Ungroup', 'Split off open', 'Make pad'])
    await user.click(screen.getByRole('menuitem', { name: 'Ungroup' }))
    expect(texts()).toBe('top\nchild\n  grand\nother\nlast')
    expect(usePad.getState().past.at(-1)?.label).toBe('cmdUngroup')
  })

  it('Pin to top in the dropdown puts the line first with a pin for a bullet and a divider under it; Unpin takes them away', async () => {
    const user = userEvent.setup()
    await mount('a\nb\nc')
    await startEditing('c')
    const bar = screen.getByRole('toolbar', { name: 'Current line' })
    await user.click(within(bar).getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Pin to top' }))
    expect(texts()).toBe('^c\na\nb')
    expect(rowByText('c')).toHaveClass('is-pinned')
    expect(screen.getByRole('separator', { name: 'Pinned lines end here' })).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Unpin' }))
    expect(texts()).toBe('c\na\nb')
    expect(screen.queryByRole('separator', { name: 'Pinned lines end here' })).not.toBeInTheDocument()
  })

  it('the toolbar draws icons with their names: Fold turns into Unfold, Top moves a line up to first, Cut takes it out', async () => {
    const user = userEvent.setup()
    await mount('a\nb\n  b1\nc')
    await startEditing('b')
    const bar = screen.getByRole('toolbar', { name: 'Current line' })
    for (const name of ['Add a line above', 'Add a line below', 'Outdent', 'Indent', 'Move down', 'Move up', 'Move to top', 'Fold', 'Copy', 'Cut', 'Paste above', 'Paste below', 'Archive']) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument()
    }
    // Done, Hour… and Category… float above the bar instead.
    for (const name of ['Done', 'Put in an hour', 'Give a category']) expect(within(bar).queryByRole('button', { name })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Put in an hour' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Give a category' })).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Fold' }))
    expect(within(bar).queryByRole('button', { name: 'Fold' })).not.toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Unfold' }))
    expect(within(bar).getByRole('button', { name: 'Fold' })).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Move to top' }))
    expect(texts()).toBe('b\n  b1\na\nc')
    expect(within(bar).getByRole('button', { name: 'Move to top' })).toBeDisabled()
    await user.click(within(bar).getByRole('button', { name: 'Cut' }))
    expect(texts()).toBe('a\nc')
  })

  it('the floating buttons: + adds a line at the top; each side of the switch puts the line in its state; the chevron ends the edit', async () => {
    const user = userEvent.setup()
    await mount('a\nb')
    await user.click(screen.getByRole('button', { name: 'Add a line at the top' }))
    expect(texts()).toBe('\na\nb')
    // While a line is open the + is away and the toolbar's own two are there.
    expect(screen.queryByRole('button', { name: 'Add a line at the top' })).not.toBeInTheDocument()
    await startEditing('b')
    const line = () => usePad.getState().rows[usePad.getState().editing!.id]!
    const side = (name: string) => within(screen.getByRole('radiogroup', { name: 'Line state' })).getByRole('radio', { name })
    expect(side('Open')).toHaveAttribute('aria-checked', 'true')
    await user.click(side('Done'))
    expect(line()).toMatchObject({ doing: false, done: true })
    expect(side('Done')).toHaveAttribute('aria-checked', 'true')
    await user.click(side('Doing'))
    expect(line()).toMatchObject({ doing: true, done: false })
    expect(rowByText('b')).toHaveClass('is-doing')
    expect(side('Open')).toHaveAttribute('aria-checked', 'false')
    await user.click(side('Open'))
    expect(line()).toMatchObject({ doing: false, done: false })
    await user.click(screen.getByRole('button', { name: 'Done editing' }))
    expect(usePad.getState().editing).toBeNull()
    expect(screen.getByRole('button', { name: 'Add a line at the top' })).toBeInTheDocument()
  })

  it('inline marks are drawn with their symbols left in; stray symbols and the line being edited stay plain', async () => {
    await mount('a **bold** and _it_ ~~gone~~ __under__\n2 * 3 * 4 and snake_case_name\n**see https://x.com/a_b**')
    const row = rowByText('a **bold** and _it_ ~~gone~~ __under__')
    expect([...row.querySelectorAll('.mark')].map((el) => `${el.className}|${el.textContent}`)).toEqual([
      'mark b|**bold**', 'mark i|_it_', 'mark s|~~gone~~', 'mark u|__under__',
    ])
    expect(rowByText('2 * 3 * 4 and snake_case_name').querySelector('.mark')).toBeNull()
    const link = rowByText('**see https://x.com/a_b**').querySelector('.mark.b a')!
    expect(link.getAttribute('href')).toBe('https://x.com/a_b')
    const ta = await startEditing('a **bold** and _it_ ~~gone~~ __under__')
    expect(ta.value).toBe('a **bold** and _it_ ~~gone~~ __under__')
  })
})
