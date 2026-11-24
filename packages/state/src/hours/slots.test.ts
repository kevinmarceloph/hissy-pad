import { beforeEach, describe, expect, it } from 'vitest';
import { idOf, shape, slotCounts, slotKey, slotLabel, parseSlot } from '@hissypad/core';

import { resetStore } from '../testing';
import { loadPad, usePad } from '../store';
import { edit, select, stopEditing } from '../selection';
import { undo } from '../history';
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
    expect(parseSlot(SLOT)).toEqual({ day: '2026-11-23', hour: 9 });
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
