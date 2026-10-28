// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogHost } from '../components/DialogHost';
import { pickDialog, pickManyDialog, useUiStore, type PickableItem } from '../state/uiStore';

vi.mock('../objects/useAssetImage', () => ({ useAssetImage: () => undefined, crispBitmap: (img: unknown) => img }));

afterEach(() => {
  cleanup();
  useUiStore.setState({ dialog: null });
});

const items: PickableItem[] = ['Sun', 'Moon', 'Star'].map((name, i) => ({
  id: `c${i}`,
  name,
  faceText: name,
  faceColor: '#ffffff',
  backColor: ['#aa0000', '#00aa00', '#0000aa'][i],
}));

describe('pick dialog', () => {
  it('selects several cards and resolves with them in list order; the count shows on the confirm button', async () => {
    render(<DialogHost />);
    let result: Promise<string[] | null> | undefined;
    act(() => {
      result = pickManyDialog({ title: 'Pick card(s) from Deck', listLabel: 'Cards', items, confirmLabel: 'Take' });
    });
    const take = screen.getByRole('button', { name: /^Take/ });
    expect((take as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3. Star' }));
    fireEvent.click(screen.getByRole('button', { name: '1. Sun' }));
    expect(screen.getByRole('button', { name: '3. Star' }).getAttribute('aria-pressed')).toBe('true');
    expect(take.textContent).toBe('Take 2 cards');
    // Clicking again deselects.
    fireEvent.click(screen.getByRole('button', { name: '1. Sun' }));
    fireEvent.click(screen.getByRole('button', { name: '2. Moon' }));
    fireEvent.click(screen.getByRole('button', { name: '1. Sun' }));
    fireEvent.click(take);
    await expect(result).resolves.toEqual(['c0', 'c1', 'c2']);
    expect(useUiStore.getState().dialog).toBeNull();
  });

  it('switches between fronts and backs', () => {
    render(<DialogHost />);
    act(() => {
      void pickManyDialog({ title: 'Pick', listLabel: 'Cards', items });
    });
    expect(screen.queryByText('Moon', { selector: '.card-picker-text' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Backs' }));
    expect(screen.getByRole('button', { name: 'Backs' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Moon', { selector: '.card-picker-text' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Back of Moon' }).style.background).toMatch(/00aa00|0, 170, 0/);
  });

  it('single pick resolves on click; cancel resolves null', async () => {
    render(<DialogHost />);
    let one: Promise<string | null> | undefined;
    act(() => {
      one = pickDialog({ title: 'Face', listLabel: 'Faces', items });
    });
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '2. Moon' }));
    await expect(one).resolves.toBe('c1');
    let none: Promise<string[] | null> | undefined;
    act(() => {
      none = pickManyDialog({ title: 'Pick', listLabel: 'Cards', items });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(none).resolves.toBeNull();
  });
});
