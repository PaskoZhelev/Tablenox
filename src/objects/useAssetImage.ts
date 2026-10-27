import { useEffect, useState } from 'react';
import { repo } from '../persistence/repository';

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
