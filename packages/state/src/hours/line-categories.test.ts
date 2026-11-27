import { beforeEach, describe, expect, it } from 'vitest';
import { idOf, normalizeRow } from '@hissypad/core';
import { fromWire, toWire } from '@hissypad/core';
import { patchCategory, SAMPLE_CATEGORIES } from '@hissypad/core/hours';

import { resetStore } from '../testing';
import { loadPad, usePad } from '../store';
import { edit, resumeEditing, select, stopEditing } from '../selection';
import { undo } from '../history';
import { cmdEnter, cmdPasteAfterSelection, cmdSetFieldText, cmdTextChanged, copyPayload, fieldText, textCaret } from '../commands';
import {
  adoptLineCategories, cmdApplyCategory, cmdPickCategory, cmdSetCategory, lineCategories, setCategoryPickerOpener, targetCategory,
} from './line-categories';

const [WORK, BODY] = [{ ...SAMPLE_CATEGORIES[0]!, icon: '💻' }, SAMPLE_CATEGORIES[1]!];
const id = (text: string) => idOf(usePad.getState().rows, text);
const cat = (text: string) => usePad.getState().rows[id(text)]!.category;

describe('a line with a category', () => {
  beforeEach(async () => {
    resetStore('A\nB\nC');
    await loadPad();
    adoptLineCategories([WORK, BODY]);
  });

  it('the picker ending the edit does not end it for good: closing it puts the caret back in the line', () => {
    let opened: readonly string[] = [];
    setCategoryPickerOpener((ids) => { opened = ids; });
    edit(id('B'), 3);
    cmdPickCategory();
    stopEditing(); // the picker took focus
    cmdApplyCategory(WORK.id);
    resumeEditing();
    expect(opened).toEqual([id('B')]);
    expect(cat('B')).toBe(WORK.id);
    expect(usePad.getState().editing?.id).toBe(id('B'));
    // Something else picked in the meantime wins, and a second resume does nothing.
    edit(id('A'));
    cmdPickCategory();
    select([id('C')]);
    resumeEditing();
    expect(usePad.getState().editing).toBeNull();
    setCategoryPickerOpener(null);
  });

  it('copies a line with its category as the emoji in front of its text', () => {
    select([id('A'), id('B')]);
    cmdSetCategory(WORK.id);
    select([id('C')]);
    cmdSetCategory(BODY.id); // no icon: nothing in front
    const all = usePad.getState().rows;
    expect(copyPayload(all, [id('A')])).toEqual({ text: '💻 A' });
    const many = copyPayload(all, [id('A'), id('B'), id('C')]);
    expect(many.text).toBe('- 💻 A\n- 💻 B\n- C');
    expect(many.html).toContain('<li>💻 A</li>');
    // Pasted back in, the emoji puts the copy in the category again and leaves the text.
    select([id('C')]);
    cmdPasteAfterSelection('- 💻 D\n- E');
    expect([cat('D'), cat('E')]).toEqual([WORK.id, null]);
  });

  it('gives the selected lines a category, reads it back, and undoes in one step', () => {
    select([id('A'), id('B')]);
    expect(cmdSetCategory(WORK.id)).toBe(2);
    expect([cat('A'), cat('B'), cat('C')]).toEqual([WORK.id, WORK.id, null]);
    expect(targetCategory()).toBe(WORK.id);
    expect(targetCategory([id('A'), id('C')])).toBeNull();
    undo();
    expect([cat('A'), cat('B')]).toEqual([null, null]);
  });

  it('opens the picker on the lines it had and says what it did', () => {
    const asked: string[][] = [];
    setCategoryPickerOpener((ids) => asked.push([...ids]));
    cmdPickCategory([id('C')]);
    expect(asked).toEqual([[id('C')]]);
    expect(cmdApplyCategory(WORK.id)).toBe('Put 1 line in 💻 Work.'.replace('Work', WORK.label));
    expect(cat('C')).toBe(WORK.id);
    cmdPickCategory([id('C')]);
    expect(cmdApplyCategory(null)).toBe('Took the category off 1 line.');
    expect(cat('C')).toBeNull();
    setCategoryPickerOpener(null);
  });

  it('keeps an archived category drawable, and follows a rename', () => {
    adoptLineCategories([patchCategory(WORK, { archived: true, label: 'Deep work' }, 9), BODY]);
    expect(lineCategories.getState().byId[WORK.id]?.label).toBe('Deep work');
  });

  it('travels to and from the server, and an older row reads as none', () => {
    cmdSetCategory(BODY.id, [id('A')]);
    const row = usePad.getState().rows[id('A')]!;
    expect(toWire(row).category).toBe(BODY.id);
    expect(fromWire(toWire(row)).row.category).toBe(BODY.id);
    const { category: _gone, ...old } = toWire(row);
    expect(fromWire(old).row.category).toBeNull();
    expect(normalizeRow({ id: 'x' }).category).toBeNull();
  });
});

// While a line is edited, its field shows its category's icon or code in front, and reads it
// back on every change (commands.ts, fieldPrefix).
describe('the prefix in the field', () => {
  const HP = { ...SAMPLE_CATEGORIES[1]!, icon: 'HP' };
  const row = (text: string) => usePad.getState().rows[id(text)]!;
  beforeEach(async () => {
    resetStore('fix the drag\nB');
    await loadPad();
    adoptLineCategories([WORK, HP]);
    select([id('fix the drag')]);
    cmdSetCategory(HP.id);
  });

  it('shows the icon or code before the text, and none for a line with no category', () => {
    expect(fieldText(id('fix the drag'))).toBe('HP fix the drag');
    expect(fieldText(id('B'))).toBe('B');
  });

  it('typing after the prefix edits the text and keeps the category, an icon there included', () => {
    const line = id('fix the drag');
    cmdSetFieldText(line, 'HP fix the drag now');
    expect(row('fix the drag now')).toMatchObject({ category: HP.id });
    cmdSetFieldText(line, 'HP 💻 fix the drag now');
    expect(usePad.getState().rows[line]).toMatchObject({ text: '💻 fix the drag now', category: HP.id });
  });

  it('deleting the prefix takes the category off, typing another puts the line in that one', () => {
    const line = id('fix the drag');
    cmdSetFieldText(line, 'HPfix the drag'); // Backspace into the prefix: no category any more
    expect(usePad.getState().rows[line]).toMatchObject({ text: 'HPfix the drag', category: null });
    cmdSetFieldText(line, 'HP fix the drag'); // and the space back reads it again
    expect(usePad.getState().rows[line]).toMatchObject({ text: 'fix the drag', category: HP.id });
    cmdSetFieldText(line, '💻 fix the drag');
    expect(usePad.getState().rows[line]).toMatchObject({ text: 'fix the drag', category: WORK.id });
    cmdSetFieldText(line, 'fix the drag');
    expect(usePad.getState().rows[line]!.category).toBeNull();
    undo();
    expect(usePad.getState().rows[line]!.category).toBe(HP.id); // the keystrokes were one undo step
  });

  it('counts the caret in the text: the prefix is the start, and Enter splits where the field says', () => {
    const line = id('fix the drag');
    expect(textCaret(line, 7)).toBe(4);
    expect(textCaret(line, 1)).toBe(0);
    expect(textCaret(id('B'), 1)).toBe(1);
    cmdEnter(line, textCaret(line, 'HP fix'.length));
    expect(row('fix')).toMatchObject({ category: HP.id });
    expect(usePad.getState().editing).toMatchObject({ caret: 0 });
    expect(fieldText(usePad.getState().editing!.id)).toBe(' the drag'); // the prefix stays with the first half, as Markdown's would
  });

  it('the phone reports the whole field: a newline in it splits the text at the same place', () => {
    const line = id('fix the drag');
    edit(line, 'end');
    expect(cmdTextChanged(line, 'HP fix\n the drag')).toBe('HP fix the drag');
    expect(row('fix').category).toBe(HP.id);
    expect(fieldText(usePad.getState().editing!.id)).toBe(' the drag'); // the prefix stays with the first half, as Markdown's would
  });
});
