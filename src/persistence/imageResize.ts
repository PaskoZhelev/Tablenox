import type { AssetMimeType } from '../domain/types';

/** Uploaded images are shrunk so their long side is at most this many pixels. */
export const MAX_IMAGE_SIDE = 2048;

const LOSSY_QUALITY = 0.92;

export type ImageResizer = (blob: Blob, mime: AssetMimeType, maxSide?: number) => Promise<Blob | null>;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(width: number, height: number): AnyCanvas | null {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encode(canvas: AnyCanvas, mime: AssetMimeType): Promise<Blob | null> {
  const quality = mime === 'image/png' ? undefined : LOSSY_QUALITY;
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: mime, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/**
 * Shrinks an image whose long side exceeds `maxSide`, keeping its aspect ratio and type (PNG stays PNG for transparency).
 * Returns null when no resize is needed or possible (image small enough, browser APIs missing, decoding failed).
 */
export async function downscaleImage(blob: Blob, mime: AssetMimeType, maxSide = MAX_IMAGE_SIDE): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const { width, height } = bitmap;
    const longSide = Math.max(width, height);
    if (longSide <= maxSide) return null;
    const scale = maxSide / longSide;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    // Shrinking a lot in one step looks jagged, so halve until the next halving would undershoot the target.
    let source: CanvasImageSource = bitmap;
    let w = width;
    let h = height;
    let canvas: AnyCanvas | null = null;
    while (w !== targetW || h !== targetH) {
      const halve = w / 2 > targetW && h / 2 > targetH;
      const nextW = halve ? Math.round(w / 2) : targetW;
      const nextH = halve ? Math.round(h / 2) : targetH;
      canvas = makeCanvas(nextW, nextH);
      const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
      if (!canvas || !ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, nextW, nextH);
      source = canvas;
      w = nextW;
      h = nextH;
    }
    return canvas ? await encode(canvas, mime) : null;
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
