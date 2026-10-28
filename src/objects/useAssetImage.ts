import { createContext, useContext, useEffect, useState } from 'react';
import { repo } from '../persistence/repository';
import { useTableStore } from '../state/tableStore';

const resolved = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

/** Loads an asset Blob into a decoded image. The object URL is revoked as soon as decoding finishes. */
export function loadAssetImage(id: string): Promise<HTMLImageElement> {
  const done = resolved.get(id);
  if (done) return Promise.resolve(done);
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      const asset = await repo.getAsset(id);
      if (!asset) throw new Error(`Missing image ${id}`);
      const url = URL.createObjectURL(asset.blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        resolved.set(id, img);
        return img;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    pending.set(id, p);
    p.catch(() => undefined).finally(() => pending.delete(id));
  }
  return p;
}

export function useAssetImage(id: string | undefined): HTMLImageElement | undefined {
  const [state, setState] = useState<{ id?: string; img?: HTMLImageElement }>(() => ({ id, img: id ? resolved.get(id) : undefined }));

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    loadAssetImage(id)
      .then((img) => {
        if (!cancelled) setState({ id, img });
      })
      .catch(() => {
        if (!cancelled) setState({ id, img: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) return undefined;
  return state.id === id ? state.img : resolved.get(id);
}

/**
 * Screen pixels per world unit for images drawn below this provider (e.g. the hover preview). Without one, the
 * table camera's scale is used.
 */
export const RenderScaleContext = createContext<number | null>(null);

type Bitmap = HTMLImageElement | HTMLCanvasElement;

const mipmaps = new WeakMap<HTMLImageElement, Bitmap[]>();

const sizeOf = (b: Bitmap) => ('naturalWidth' in b ? { w: b.naturalWidth, h: b.naturalHeight } : { w: b.width, h: b.height });

/** How many times `img` can be halved and still cover `targetW` × `targetH` pixels. */
export function mipLevel(img: HTMLImageElement, targetW: number, targetH: number): number {
  let { w, h } = sizeOf(img);
  let level = 0;
  while (Math.floor(w / 2) >= targetW && Math.floor(h / 2) >= targetH && w > 1 && h > 1) {
    w = Math.floor(w / 2);
    h = Math.floor(h / 2);
    level++;
  }
  return level;
}

/** `img` halved `level` times, each step from the previous one (made once, then cached). */
function mipmap(img: HTMLImageElement, level: number): Bitmap {
  let chain = mipmaps.get(img);
  if (!chain) mipmaps.set(img, (chain = [img]));
  for (let i = chain.length; i <= level; i++) {
    const prev = chain[i - 1];
    const { w, h } = sizeOf(prev);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(w / 2));
    canvas.height = Math.max(1, Math.floor(h / 2));
    const ctx = canvas.getContext('2d');
    if (!ctx) return prev;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(prev, 0, 0, canvas.width, canvas.height);
    chain.push(canvas);
  }
  return chain[level];
}

/** `img` pre-shrunk (in halving steps) to the smallest copy that still covers `w` × `h` device pixels. */
export function crispBitmap(img: HTMLImageElement, w: number, h: number): Bitmap {
  return mipmap(img, mipLevel(img, w, h));
}

/**
 * An asset image to draw at `w` × `h` world units, pre-shrunk to about the size it covers on screen. Browsers
 * shrink a large image in one step by sampling only a few source pixels, which makes fine detail such as card
 * text look jagged and blurry; halving it step by step keeps it crisp. Re-renders only when the level changes.
 */
export function useCrispImage(id: string | undefined, w: number, h: number): Bitmap | undefined {
  const img = useAssetImage(id);
  const fixed = useContext(RenderScaleContext);
  const level = useTableStore((s) => {
    if (!img) return 0;
    const px = (fixed ?? s.camera.scale) * (globalThis.devicePixelRatio || 1);
    return mipLevel(img, w * px, h * px);
  });
  return img && mipmap(img, level);
}
