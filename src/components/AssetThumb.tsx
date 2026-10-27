import { useEffect, useRef } from 'react';
import { useAssetImage } from '../objects/useAssetImage';

/** Small preview of an uploaded image, fitted into a `size` × `size` box (keeps the aspect ratio). */
export function AssetThumb({ assetId, size = 28, label }: { assetId: string; size?: number; label?: string }) {
  const img = useAssetImage(assetId);
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = img ? Math.min(size / img.naturalWidth, size / img.naturalHeight) : 1;
  const w = img ? Math.max(1, Math.round(img.naturalWidth * scale)) : size;
  const h = img ? Math.max(1, Math.round(img.naturalHeight * scale)) : size;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    // Draw at device resolution so the thumbnail stays sharp.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }, [img, w, h]);

  return (
    <canvas
      ref={ref}
      className={`asset-thumb ${img ? '' : 'is-loading'}`}
      style={{ width: w, height: h }}
      role="img"
      aria-label={label ?? 'Image preview'}
      data-testid="asset-thumb"
    />
  );
}
