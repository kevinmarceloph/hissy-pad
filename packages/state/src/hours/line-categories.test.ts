import { beforeEach, describe, expect, it } from 'vitest';
import { idOf, normalizeRow } from '@hissypad/core';
import { fromWire, toWire } from '@hissypad/core';
import { patchCategory, SAMPLE_CATEGORIES } from '@hissypad/core/hours';

import { resetStore } from '../testing';
import { loadPad, usePad } from '../store';
import { edit, resumeEditing, select, stopEditing } from '../selection';
import { undo } from '../history';
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
