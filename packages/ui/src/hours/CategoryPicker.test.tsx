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

  it('offers No category for lines in different categories, and not for lines with none', async () => {
    const onPick = vi.fn();
    const { unmount } = await render(<CategoryPicker categories={list} value={null} hasAny count={2} onPick={onPick} onCancel={() => {}} />);
    await fireEvent.press(screen.getByText('No category'));
    expect(onPick).toHaveBeenLastCalledWith(null);
    unmount();
    onPick.mockClear();
    await render(<CategoryPicker categories={list} value={null} hasAny={false} count={2} onPick={onPick} onCancel={() => {}} />);
    await fireEvent.press(screen.getByText('No category'));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('points to where categories are made when there are none', async () => {
    await render(<CategoryPicker categories={[]} value={null} count={3} onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Which category are these 3 lines?')).toBeTruthy();
    expect(screen.getByText(/No categories yet/)).toBeTruthy();
    expect(screen.queryByText('New category')).toBeNull();
  });

  it('makes a new category in place, with a name, an icon and a color', async () => {
    const onCreate = vi.fn();
    const onPick = vi.fn();
    await render(<CategoryPicker categories={list} value={null} onPick={onPick} onCreate={onCreate} onCancel={() => {}} />);
    await fireEvent.press(screen.getByText('New category'));
    expect(screen.getByRole('heading', { name: 'New category' })).toBeTruthy();

    // A name it already has is refused, on screen.
    await fireEvent.changeText(screen.getByLabelText('Name'), list[0]!.label);
    await fireEvent.press(screen.getByText('Add'));
    expect(screen.getByRole('alert').textContent).toMatch(/already have/);
    expect(onCreate).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Name'), 'Errands');
    await fireEvent.changeText(screen.getByLabelText('Icon'), '🛒');
    await fireEvent.press(screen.getByRole('radio', { name: 'Teal' }));
    await fireEvent.press(screen.getByText('Add'));
    expect(onCreate).toHaveBeenCalledWith('Errands', '🛒', 'teal');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('goes back to the list when the new category is cancelled', async () => {
    await render(<CategoryPicker categories={list} value={null} onPick={() => {}} onCreate={() => {}} onCancel={() => {}} />);
    await fireEvent.press(screen.getByText('New category'));
    await fireEvent.press(screen.getByText('Cancel'));
    expect(screen.getByRole('radio', { name: list[0]!.label })).toBeTruthy();
  });
});
