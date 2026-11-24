import { beforeEach, describe, expect, it } from 'vitest';
import { idOf, shape, slotCounts, slotKey, slotLabel, parseSlot } from '@hissypad/core';

import { resetStore } from '../testing';
import { loadPad, usePad } from '../store';
import { edit, select, stopEditing } from '../selection';
import { redo, undo } from '../history';
import { cmdDeleteSelection } from '../commands';
import { cmdApplySlot, cmdPickSlot, cmdSetSlot, cmdSlotAdd, cmdSlotBreak, cmdSlotClear, cmdSlotDone, cmdSlotErase, cmdSlotShift, cmdSlotState, cmdSlotText, linesInSlot, outlineOfSlot, setSlotPickerOpener, targetSlot } from './slots';

const SLOT = slotKey('2026-11-23', 9);
const id = (text: string) => idOf(usePad.getState().rows, text);

describe('lines in an hour', () => {
  beforeEach(async () => {
    resetStore('A\n  B\nC\nD');
    await loadPad();
  });

  it('writes a slot as a calendar day and a two-digit hour, and reads it back', () => {
    expect(SLOT).toBe('2026-11-23T09');
    expect(parseSlot(SLOT)).toEqual({ day: '2026-11-23', hour: 9, hours: 1 });
    expect(parseSlot('2026-11-23T24')).toBeNull();
    expect(parseSlot(null)).toBeNull();
    expect(slotLabel(SLOT, '2026-11-23')).toBe('Today 9am');
    expect(slotLabel(slotKey('2026-11-24', 14), '2026-11-23')).toBe('Tue, Nov 24, 2pm');
  });

  it('assigns the selected lines, counts them by done and open, and undoes in one step', () => {
    select([id('A'), id('C')]);
    expect(cmdSetSlot(SLOT)).toBe(2);
    expect(targetSlot()).toBe(SLOT);
    cmdSlotDone(id('C'), true);
    expect(slotCounts(usePad.getState().all)).toEqual({ [SLOT]: { done: 1, open: 1 } });
    // Open lines first, then crossed out.
    expect(linesInSlot('2026-11-23', 9).map((r) => r.text)).toEqual(['A', 'C']);
    undo();
    expect(slotCounts(usePad.getState().all)).toEqual({ [SLOT]: { done: 0, open: 2 } });
    undo();
    expect(slotCounts(usePad.getState().all)).toEqual({});
  });

  it('takes a line out of its hour, and a deleted line stops counting', () => {
    select([id('A'), id('C'), id('D')]);
    cmdSetSlot(SLOT);
    cmdSlotClear(id('A'));
    expect(usePad.getState().all[id('A')]!.slot).toBeNull();
    select([id('D')]);
    cmdSetSlot(null);
    expect(slotCounts(usePad.getState().all)).toEqual({ [SLOT]: { done: 0, open: 1 } });
  });

  it('keeps an archived line in its hour, where it can still be ticked and taken out', () => {
    select([id('A'), id('C')]);
    cmdSetSlot(SLOT);
    const c = id('C');
    select([c]);
    cmdDeleteSelection();
    expect(usePad.getState().all[c]!.deletedAt).not.toBeNull();
    expect(linesInSlot('2026-11-23', 9).map((r) => r.text)).toEqual(['A', 'C']);
    cmdSlotDone(c, true);
    expect(usePad.getState().all[c]).toMatchObject({ done: true, deletedAt: expect.any(String) });
    expect(slotCounts(usePad.getState().all)).toEqual({ [SLOT]: { done: 1, open: 1 } });
    cmdSlotClear(c);
    expect(linesInSlot('2026-11-23', 9).map((r) => r.text)).toEqual(['A']);
  });

  it('drops an undone add from the hour, and a redo puts it back', () => {
    const made = cmdSlotAdd('2026-11-23', 9, 'call the bank');
    undo();
    expect(usePad.getState().all[made]).toMatchObject({ slot: null, deletedAt: expect.any(String) });
    expect(linesInSlot('2026-11-23', 9)).toEqual([]);
    redo();
    expect(usePad.getState().all[made]).toMatchObject({ slot: SLOT, deletedAt: null });
  });

  it('adds a new line at the top of the open pad, already in the hour', () => {
    const made = cmdSlotAdd('2026-11-23', 9, '  call the bank ');
    const row = usePad.getState().rows[made]!;
    expect(row).toMatchObject({ text: 'call the bank', slot: SLOT, parentId: null });
    expect(shape(usePad.getState().rows).split('\n')[0]).toBe('call the bank');
    expect(cmdSlotAdd('2026-11-23', 9, '   ')).toBe('');
  });

  it('counts the line being edited as selected, even after the picker ends the edit', () => {
    const opened: (readonly string[])[] = [];
    setSlotPickerOpener((ids) => opened.push(ids));
    edit(id('C'));
    cmdPickSlot();
    expect(opened).toEqual([[id('C')]]);
    stopEditing(); // the picker took focus
    expect(cmdApplySlot(SLOT)).toMatch(/^Put 1 line in /);
    expect(usePad.getState().rows[id('C')]?.slot).toBe(SLOT);
    setSlotPickerOpener(null);
  });

  it('opens the picker on lines handed over by a menu that already ended the edit', () => {
    const opened: (readonly string[])[] = [];
    setSlotPickerOpener((ids) => opened.push(ids));
    cmdPickSlot([id('D')]);
    expect(opened).toEqual([[id('D')]]);
    cmdApplySlot(SLOT);
    expect(usePad.getState().rows[id('D')]?.slot).toBe(SLOT);
    setSlotPickerOpener(null);
  });
});

describe('the hour as a pad of its own', () => {
  const texts = () => outlineOfSlot('2026-11-23', 9).map((r) => `${'  '.repeat(r.depth)}${r.row.text}`);
  const all = () => usePad.getState().all;
  const at = (text: string) => idOf(all(), text);

  beforeEach(async () => {
    resetStore('A\n  B\n  C\nD');
    await loadPad();
    cmdSetSlot(SLOT, [id('A')]);
  });

  it('lists the hour\'s line with what is under it, and types into a line as one undo step', () => {
    expect(texts()).toEqual(['A', '  B', '  C']);
    cmdSlotText(at('B'), 'Bx');
    cmdSlotText(at('Bx'), 'Bxy');
    expect(texts()).toEqual(['A', '  Bxy', '  C']);
    undo();
    expect(texts()).toEqual(['A', '  B', '  C']);
  });

  it('starts a new line under the hour\'s own line, and after a line further in', () => {
    const first = cmdSlotBreak(at('A'), true);
    cmdSlotText(first, 'new');
    expect(texts()).toEqual(['A', '  new', '  B', '  C']);
    const next = cmdSlotBreak(at('B'), false);
    cmdSlotText(next, 'after B');
    expect(texts()).toEqual(['A', '  new', '  B', '  after B', '  C']);
    // Mid-text, the line splits at the caret.
    cmdSlotBreak(at('after B'), false, 5);
    expect(texts()).toEqual(['A', '  new', '  B', '  after', '   B', '  C']);
  });

  it('puts a line in one of the three states', () => {
    cmdSlotState(at('B'), 'doing');
    expect(all()[at('B')]).toMatchObject({ doing: true, done: false });
    cmdSlotState(at('B'), 'done');
    expect(all()[at('B')]).toMatchObject({ doing: false, done: true });
    cmdSlotState(at('B'), 'open');
    expect(all()[at('B')]).toMatchObject({ doing: false, done: false });
  });

  it('moves a line in and out, never out from under the hour\'s own line', () => {
    cmdSlotShift(at('C'), 1, 'in');
    expect(texts()).toEqual(['A', '  B', '    C']);
    cmdSlotShift(at('C'), 2, 'out');
    expect(texts()).toEqual(['A', '  B', '  C']);
    cmdSlotShift(at('C'), 1, 'out');
    cmdSlotShift(at('A'), 0, 'in');
    expect(texts()).toEqual(['A', '  B', '  C']);
  });

  it('takes away an empty line with nothing under it, and no other', () => {
    expect(cmdSlotErase(at('B'))).toBe(false);
    const made = cmdSlotBreak(at('B'), false);
    expect(cmdSlotErase(made)).toBe(true);
    expect(texts()).toEqual(['A', '  B', '  C']);
  });
});
