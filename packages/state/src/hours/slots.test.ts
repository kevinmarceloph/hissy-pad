import { beforeEach, describe, expect, it } from 'vitest';
import { idOf, shape, slotCounts, slotKey, slotLabel, parseSlot } from '@hissypad/core';

import { resetStore } from '../testing';
import { loadPad, usePad } from '../store';
import { edit, select, stopEditing } from '../selection';
import { redo, undo } from '../history';
import { cmdDeleteSelection } from '../commands';
import { cmdApplySlot, cmdPickSlot, cmdSetSlot, cmdSlotAdd, cmdSlotClear, cmdSlotDone, linesInSlot, setSlotPickerOpener, targetSlot } from './slots';

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
    expect(slotLabel(slotKey('2026-11-24', 14), '2026-11-23')).toBe('Tomorrow 2pm');
    expect(slotLabel(slotKey('2026-11-25', 14), '2026-11-23')).toBe('Wed, Nov 25, 2pm');
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

  it('adds a new line at the top of Today, already in the hour, whichever pad is open', () => {
    const all = () => usePad.getState().all;
    const today = Object.values(all()).find((r) => r.pad && r.text === 'Today')!;
    const made = cmdSlotAdd('2026-11-23', 9, '  call the bank ');
    expect(all()[made]).toMatchObject({ text: 'call the bank', slot: SLOT, parentId: today.id });
    // The next one goes above it.
    const next = cmdSlotAdd('2026-11-23', 9, 'send invoice');
    expect(all()[next]!.parentId).toBe(today.id);
    expect(all()[next]!.rank < all()[made]!.rank).toBe(true);
    // The open pad, the Inbox here, did not take either.
    expect(shape(usePad.getState().rows).split('\n')[0]).toBe('A');
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
