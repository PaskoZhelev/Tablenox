// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssetThumb } from '../components/AssetThumb';

const fakeImage = { naturalWidth: 600, naturalHeight: 900 } as HTMLImageElement;

vi.mock('../objects/useAssetImage', () => ({
  useAssetImage: () => fakeImage,
  crispBitmap: (img: HTMLImageElement) => img,
}));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const hover = (el: Element, pointerType = 'mouse') => {
  fireEvent.pointerEnter(el, { pointerType });
  act(() => {
    vi.advanceTimersByTime(300);
  });
};

describe('AssetThumb zoom on hover', () => {
  it('fits the thumbnail into its box, keeping the aspect ratio', () => {
    render(<AssetThumb assetId="a" size={30} label="Face" />);
    const thumb = screen.getByTestId('asset-thumb');
    expect(thumb.style.width).toBe('20px');
    expect(thumb.style.height).toBe('30px');
  });

  it('shows an enlarged copy after the mouse rests on it and hides it when the mouse leaves', () => {
    render(<AssetThumb assetId="a" size={26} label="Face" />);
    const thumb = screen.getByTestId('asset-thumb');
    fireEvent.pointerEnter(thumb, { pointerType: 'mouse' });
    expect(screen.queryByTestId('asset-zoom')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const zoom = screen.getByTestId('asset-zoom');
    expect(parseFloat(zoom.style.height)).toBeGreaterThan(26);
    expect(parseFloat(zoom.style.width) / parseFloat(zoom.style.height)).toBeCloseTo(600 / 900, 2);
    fireEvent.pointerLeave(thumb, { pointerType: 'mouse' });
    expect(screen.queryByTestId('asset-zoom')).toBeNull();
  });

  it('does not show the preview when the mouse leaves before the delay', () => {
    render(<AssetThumb assetId="a" label="Face" />);
    const thumb = screen.getByTestId('asset-thumb');
    fireEvent.pointerEnter(thumb, { pointerType: 'mouse' });
    fireEvent.pointerLeave(thumb, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId('asset-zoom')).toBeNull();
  });

  it('hides the preview on press, and ignores touch or zoom={false}', () => {
    const { rerender } = render(<AssetThumb assetId="a" label="Face" />);
    hover(screen.getByTestId('asset-thumb'));
    fireEvent.pointerDown(screen.getByTestId('asset-thumb'));
    expect(screen.queryByTestId('asset-zoom')).toBeNull();
    hover(screen.getByTestId('asset-thumb'), 'touch');
    expect(screen.queryByTestId('asset-zoom')).toBeNull();
    rerender(<AssetThumb assetId="a" label="Face" zoom={false} />);
    hover(screen.getByTestId('asset-thumb'));
    expect(screen.queryByTestId('asset-zoom')).toBeNull();
  });
});
