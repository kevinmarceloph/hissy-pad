import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_CATEGORIES } from '@hissypad/core/hours';

import { fireEvent, render, screen } from '../testing/rntl';
import { CategoryPicker } from './CategoryPicker';

const list = [{ ...SAMPLE_CATEGORIES[0]!, icon: '💻' }, SAMPLE_CATEGORIES[1]!];

describe('the category picker', () => {
  it('shows each category with its icon and name, marks the current one, and picks', async () => {
    const onPick = vi.fn();
    await render(<CategoryPicker categories={list} value={list[0]!.id} onPick={onPick} onCancel={() => {}} />);
    expect(screen.getByText('Which category is this line?')).toBeTruthy();
    expect(screen.getByText('💻')).toBeTruthy();
    expect(screen.getByRole('radio', { name: list[0]!.label }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.press(screen.getByRole('radio', { name: list[1]!.label }));
    expect(onPick).toHaveBeenLastCalledWith(list[1]!.id);
    await fireEvent.press(screen.getByText('No category'));
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it('points to where categories are made when there are none', async () => {
    await render(<CategoryPicker categories={[]} value={null} count={3} onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Which category are these 3 lines?')).toBeTruthy();
    expect(screen.getByText(/No categories yet/)).toBeTruthy();
  });
});
