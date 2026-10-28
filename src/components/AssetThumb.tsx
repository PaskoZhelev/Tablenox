import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { crispBitmap, useAssetImage } from '../objects/useAssetImage';

/** How long the mouse rests on a thumbnail before the enlarged preview appears (same as the table's hover zoom). */
const ZOOM_DELAY_MS = 250;
/** The enlarged preview fits in a box this many CSS px wide and tall (smaller on small screens). */
const ZOOM_MAX = 360;
const ZOOM_GAP = 12;
const VIEWPORT_MARGIN = 8;

/** Draws `img` into the canvas at device resolution so it stays sharp at `w` × `h` CSS px. */
function useFittedCanvas(ref: RefObject<HTMLCanvasElement | null>, img: HTMLImageElement | undefined, w: number, h: number) {
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crispBitmap(img, canvas.width, canvas.height), 0, 0, canvas.width, canvas.height);
  }, [ref, img, w, h]);
}

function fit(img: HTMLImageElement, box: number) {
  const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight);
  return { w: Math.max(1, Math.round(img.naturalWidth * scale)), h: Math.max(1, Math.round(img.naturalHeight * scale)) };
}

/** Enlarged copy of a thumbnail, shown beside it (left first, then right), kept inside the viewport. */
function ZoomPreview({ img, anchor }: { img: HTMLImageElement; anchor: DOMRect }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { w, h } = fit(img, Math.max(1, Math.min(ZOOM_MAX, vw - 2 * VIEWPORT_MARGIN, vh - 2 * VIEWPORT_MARGIN)));
  let left = anchor.left - ZOOM_GAP - w;
  if (left < VIEWPORT_MARGIN) left = anchor.right + ZOOM_GAP;
  if (left + w > vw - VIEWPORT_MARGIN) left = Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - w);
  const top = Math.min(
    Math.max(VIEWPORT_MARGIN, anchor.top + anchor.height / 2 - h / 2),
    Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - h),
  );
  useFittedCanvas(ref, img, w, h);
  return createPortal(
    <canvas ref={ref} className="asset-zoom" style={{ left, top, width: w, height: h }} aria-hidden="true" data-testid="asset-zoom" />,
    document.body,
  );
}

/**
 * Small preview of an uploaded image, fitted into a `size` × `size` box (keeps the aspect ratio). Resting the
 * mouse on it shows an enlarged copy next to it (`zoom`, on by default).
 */
export function AssetThumb({ assetId, size = 28, label, zoom = true }: { assetId: string; size?: number; label?: string; zoom?: boolean }) {
  const img = useAssetImage(assetId);
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = img ? fit(img, size) : { w: size, h: size };
  useFittedCanvas(ref, img, w, h);

  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hideZoom = useCallback(() => {
    window.clearTimeout(timer.current);
    setAnchor(null);
  }, []);
  useEffect(() => hideZoom, [hideZoom]);
  useEffect(() => {
    if (!anchor) return;
    // The preview is placed once; scrolling the panel would leave it behind.
    window.addEventListener('scroll', hideZoom, true);
    window.addEventListener('resize', hideZoom);
    return () => {
      window.removeEventListener('scroll', hideZoom, true);
      window.removeEventListener('resize', hideZoom);
    };
  }, [anchor, hideZoom]);

  return (
    <>
      <canvas
        ref={ref}
        className={`asset-thumb ${img ? '' : 'is-loading'}`}
        style={{ width: w, height: h }}
        role="img"
        aria-label={label ?? 'Image preview'}
        data-testid="asset-thumb"
        onPointerEnter={(e) => {
          // Mouse only: on touch the press is a tap on the surrounding button.
          if (!zoom || e.pointerType !== 'mouse') return;
          const el = e.currentTarget;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setAnchor(el.getBoundingClientRect()), ZOOM_DELAY_MS);
        }}
        onPointerLeave={hideZoom}
        onPointerDown={hideZoom}
      />
      {anchor && img && <ZoomPreview img={img} anchor={anchor} />}
    </>
  );
}
