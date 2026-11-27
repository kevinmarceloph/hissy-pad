import { vi } from 'vitest';
import { FOREVER, idOf, parseRepeat } from '@hissypad/core';
import { loadPad, repeatOf, resetStore, usePad } from '@hissypad/state';

import { fireEvent, render, screen } from '../testing/rntl';
import { SlotPicker } from './SlotPicker';

// Tuesday 2026-12-01, 10am.
const clock = () => new Date(2026, 11, 1, 10);
const all = () => usePad.getState().all;
const id = (text: string) => idOf(all(), text);
const template = () => Object.values(all()).find((r) => r.repeat)!;

beforeEach(async () => {
  resetStore('water the plants\n  the ferns\nbuy milk');
  await loadPad();
});

describe('the hour picker\'s Repeat section', () => {
  it('is one line until opened, and is not there for several lines', async () => {
    const one = await render(<SlotPicker value={null} ids={[id('buy milk')]} onPick={() => {}} onCancel={() => {}} clock={clock} />);
    expect(screen.getByRole('button', { name: 'Repeat: Does not repeat' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('radiogroup', { name: 'How it repeats' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Hours' })).toBeTruthy();
    one.unmount();
    await render(<SlotPicker value={null} count={2} ids={[id('buy milk'), id('water the plants')]} onPick={() => {}} onCancel={() => {}} clock={clock} />);
    expect(screen.queryByRole('button', { name: /^Repeat:/ })).toBeNull();
  });

  it('makes the line recurring from a draft, then writes each change to the rule', async () => {
    const line = id('water the plants');
    await render(<SlotPicker value={null} ids={[line]} onPick={() => {}} onCancel={() => {}} clock={clock} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat: Does not repeat' }));
    // Open, it takes the room of the hours.
    expect(screen.queryByRole('group', { name: 'Hours' })).toBeNull();
    await fireEvent.press(screen.getByLabelText('More'));
    await fireEvent.press(screen.getByRole('radio', { name: 'days' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Add another' }));
    // Still a draft: nothing is recurring yet.
    expect(repeatOf(line)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat: every 2 days' }));
    expect(repeatOf(line)?.role).toBe('instance');
    expect(template().due).toBe(FOREVER);
    expect(parseRepeat(template().repeat)).toMatchObject({ mode: 'every', n: 2, unit: 'd', keep: 'add', next: '2026-12-03' });
    expect(screen.getByRole('button', { name: 'Repeat: Every 2 days, next Thu, Dec 3' })).toBeTruthy();
    // Now each tap is the rule's.
    await fireEvent.press(screen.getByRole('radio', { name: 'After it is done' }));
    expect(parseRepeat(template().repeat)!.mode).toBe('after');
    expect(screen.queryByRole('radiogroup', { name: 'If the last one is still open' })).toBeNull();
    await fireEvent.press(screen.getByLabelText('Fewer'));
    expect(parseRepeat(template().repeat)!.n).toBe(1);
    expect(screen.getByLabelText('Fewer')).toHaveAttribute('aria-disabled', 'true');
  });

  it('an instance goes to its template or is unlinked; the template stops', async () => {
    const line = id('water the plants');
    const onOpenTemplate = vi.fn();
    const first = await render(<SlotPicker value={null} ids={[line]} onPick={() => {}} onCancel={() => {}} onOpenTemplate={onOpenTemplate} clock={clock} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat: Does not repeat' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat: every week' }));
    const t = template().id;
    await fireEvent.press(screen.getByRole('button', { name: 'Go to the template' }));
    expect(onOpenTemplate).toHaveBeenCalledTimes(1);
    expect(usePad.getState().selection).toEqual([t]);
    await fireEvent.press(screen.getByRole('button', { name: 'Unlink this one' }));
    expect(repeatOf(line)).toBeNull();
    expect(screen.getByRole('button', { name: 'Repeat: Does not repeat' })).toBeTruthy();
    first.unmount();

    await render(<SlotPicker value={null} ids={[t]} onPick={() => {}} onCancel={() => {}} clock={clock} />);
    await fireEvent.press(screen.getByRole('button', { name: /^Repeat: Every week/ }));
    expect(screen.getByText(/This is the template/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Stop repeating' }));
    expect(all()[t]!.repeat).toBeNull();
    expect(all()[t]!.due).toBeNull();
  });
});
