import { describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen } from '../testing/rntl';
import { BoomerangPicker } from './BoomerangPicker';

// Wednesday, at noon.
const clock = () => new Date(2026, 10, 25, 12);

describe('the boomerang picker', () => {
  it('offers a few days one tap away, counted from today', async () => {
    const onPick = vi.fn();
    await render(<BoomerangPicker value={null} onPick={onPick} onCancel={() => {}} clock={clock} />);
    expect(screen.getByText('Until when is this line out?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Tomorrow/ }));
    expect(onPick).toHaveBeenLastCalledWith('2026-11-26', '2026-11-25');
    await fireEvent.press(screen.getByRole('button', { name: /^Next Monday/ }));
    expect(onPick).toHaveBeenLastCalledWith('2026-11-30', '2026-11-25');
  });

  it('takes any later day from the calendar, confirmed by the button, and no day up to today', async () => {
    const onPick = vi.fn();
    await render(<BoomerangPicker value={null} count={2} onPick={onPick} onCancel={() => {}} clock={clock} />);
    expect(screen.getByText('Until when are these 2 lines out?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Nov 25, today/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /^Tue, Nov 24$/ }).hasAttribute('disabled')).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: /^Sat, Nov 28$/ }));
    expect(onPick).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Out until Sat, Nov 28'));
    expect(onPick).toHaveBeenLastCalledWith('2026-11-28', '2026-11-25');
  });

  it('says the day the lines are out until now', async () => {
    await render(<BoomerangPicker value="2026-11-30" onPick={() => {}} onCancel={() => {}} clock={clock} />);
    expect(screen.getByText(/Out until Mon, Nov 30 now/)).toBeTruthy();
  });
});
