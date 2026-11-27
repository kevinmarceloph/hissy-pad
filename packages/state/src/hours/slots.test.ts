import { beforeEach, describe, expect, it } from 'vitest';
import { idOf, setDone, shape, slotCounts, slotKey, slotLabel, parseSlot } from '@hissypad/core';

import { resetStore } from '../testing';
import { applyAll, loadPad, openSlot, usePad } from '../store';
import { edit, select, stopEditing } from '../selection';
import { redo, undo } from '../history';
import { cmdDeleteSelection, cmdSetText } from '../commands';
import { dayOf } from '@hissypad/core/hours';
import { cmdApplySlot, cmdFindForSlot, cmdPickSlot, cmdSetSlot, cmdSlotAdd, cmdSlotFresh, cmdSlotPut, cmdSlotUnarchive, inSlot, linesInSlot, setSlotFinder, setSlotPickerOpener, targetSlot } from './slots';

const SLOT = slotKey('2026-11-23', 9);
const id = (text: string) => idOf(usePad.getState().all, text);
const cross = (line: string) => applyAll((all, ctx) => setDone(all, ctx, [line], true, true));

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

  it('an hour typed in front of a line puts it in that hour and leaves the rest of the text; one undo takes it back', () => {
    const today = dayOf(new Date(), 0);
    cmdSetText(id('C'), '3pm-5pm call');
    const c = usePad.getState().rows[idOf(usePad.getState().rows, 'call')]!;
    expect(c.slot).toBe(slotKey(today, 15, 2));
    cmdSetText(id('D'), '10am');
    expect(usePad.getState().rows[id('10am')]!.slot).toBeNull(); // no space after it yet: still being typed
    undo();
    expect(usePad.getState().rows[id('D')]).toBeDefined();
  });

  it('assigns the selected lines, counts them by done and open, and undoes in one step', () => {
    select([id('A'), id('C')]);
    expect(cmdSetSlot(SLOT)).toBe(2);
    expect(targetSlot()).toBe(SLOT);
    cross(id('C'));
    expect(slotCounts(usePad.getState().all)).toEqual({ [SLOT]: { done: 1, open: 1 } });
    // As the pad has them, crossed out or not.
    expect(linesInSlot('2026-11-23', 9).map((r) => r.text)).toEqual(['A', 'C']);
    undo();
    expect(slotCounts(usePad.getState().all)).toEqual({ [SLOT]: { done: 0, open: 2 } });
    undo();
    expect(slotCounts(usePad.getState().all)).toEqual({});
  });

  it('takes a line out of its hour, and a deleted line stops counting', () => {
    select([id('A'), id('C'), id('D')]);
    cmdSetSlot(SLOT);
    cmdSetSlot(null, [id('A')]);
    expect(usePad.getState().all[id('A')]!.slot).toBeNull();
    select([id('D')]);
    cmdSetSlot(null);
    expect(slotCounts(usePad.getState().all)).toEqual({ [SLOT]: { done: 0, open: 1 } });
  });

  it('keeps an archived line in its hour, where it was, and brings it back in place', () => {
    select([id('A'), id('C'), id('D')]);
    cmdSetSlot(SLOT);
    const c = id('C');
    cross(c);
    select([c]);
    cmdDeleteSelection();
    expect(usePad.getState().all[c]!.deletedAt).not.toBeNull();
    // Between A and D, as in its pad, not after them.
    expect(linesInSlot('2026-11-23', 9).map((r) => r.text)).toEqual(['A', 'C', 'D']);
    // The open hour draws it with the others, and says which it is.
    openSlot(SLOT);
    expect(shape(usePad.getState().rows)).toBe('A\n  B\n~C\nD');
    // Typing in it there leaves it archived.
    cmdSetText(c, 'C, again');
    expect(usePad.getState().all[c]).toMatchObject({ text: 'C, again', deletedAt: expect.any(String) });
    // The mark brings it back where it was, still crossed out. One undo step.
    cmdSlotUnarchive(c);
    expect(usePad.getState().all[c]).toMatchObject({ deletedAt: null, done: true, slot: SLOT });
    openSlot(null);
    expect(shape(usePad.getState().rows)).toBe('A\n  B\n~C, again\nD');
    undo();
    expect(usePad.getState().all[c]!.deletedAt).not.toBeNull();
  });

  it('starts an hour fresh: the lines not crossed out leave it, marked as back', () => {
    select([id('A'), id('C'), id('D')]);
    cmdSetSlot(SLOT);
    cross(id('C'));
    // D is in the next hour too, and keeps that one.
    cmdSetSlot(slotKey('2026-11-23', 9, 2), [id('D')]);
    expect(cmdSlotFresh('2026-11-23', 9)).toBe(2);
    const all = usePad.getState().all;
    expect(all[id('A')]).toMatchObject({ slot: null, fresh: true });
    expect(all[id('D')]).toMatchObject({ slot: slotKey('2026-11-23', 10), fresh: true });
    // What was done stays: it is what the hour was.
    expect(all[id('C')]).toMatchObject({ slot: SLOT, fresh: false });
    expect(linesInSlot('2026-11-23', 9).map((r) => r.text)).toEqual(['C']);
    // Nothing left to take out; and one undo puts both back.
    expect(cmdSlotFresh('2026-11-23', 9)).toBe(0);
    undo();
    expect(linesInSlot('2026-11-23', 9).map((r) => r.text)).toEqual(['A', 'C', 'D']);
    expect(usePad.getState().all[id('A')]!.fresh).toBe(false);
  });

  it('asks the app for its search with the hour, and puts the line found in it', () => {
    const asked: string[] = [];
    setSlotFinder((slot) => asked.push(slot));
    cmdFindForSlot('2026-11-23', 9);
    expect(asked).toEqual([SLOT]);
    setSlotFinder(null);
    expect(inSlot(id('D'), SLOT)).toBe(false);
    cmdSlotPut(id('D'), '2026-11-23', 9);
    expect(inSlot(id('D'), SLOT)).toBe(true);
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
