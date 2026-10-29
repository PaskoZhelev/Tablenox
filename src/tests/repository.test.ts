import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ASSET_BYTES, sha256Hex, sniffImageMime } from '../persistence/assetValidation';
import { TablenoxDB } from '../persistence/db';
import { downscaleImage } from '../persistence/imageResize';
import { createRepository, describeStorageError } from '../persistence/repository';
import { fixtureGame, JPEG_BYTES, PNG_BYTES, pngFile, SVG_BYTES } from './fixtures';

let db: TablenoxDB;
let repo: ReturnType<typeof createRepository>;

beforeEach(() => {
  db = new TablenoxDB(`repo-${Math.random()}`);
  repo = createRepository(db);
});
afterEach(async () => {
  await db.delete();
});

const LATER = Date.now() + 10 * 60 * 1000;

describe('repository', () => {
  it('saves a game as one record that every change overwrites', async () => {
    const g = fixtureGame();
    await repo.saveGame(g);
    await repo.saveGame({ ...g, title: 'Renamed', objects: g.objects.slice(1) });
    expect(await db.games.count()).toBe(1);
    const loaded = (await repo.getGame(g.id))!;
    expect(loaded.title).toBe('Renamed');
    expect(loaded.objects).toHaveLength(g.objects.length - 1);
  });

  it('deleting a game keeps images that another game still uses', async () => {
    const assetId = await repo.addAsset(pngFile());
    const a = fixtureGame(assetId);
    const b = { ...fixtureGame(assetId), id: 'other-game' };
    await repo.saveGame(a);
    await repo.saveGame(b);
    await repo.deleteGame(a.id);
    await repo.collectGarbage(LATER);
    expect(await repo.getAsset(assetId)).toBeTruthy();
    await repo.deleteGame(b.id);
    expect(await repo.collectGarbage(LATER)).toBe(1);
    expect(await repo.getAsset(assetId)).toBeUndefined();
  });

  it('does not garbage-collect fresh uploads that are not saved yet', async () => {
    const assetId = await repo.addAsset(pngFile());
    expect(await repo.collectGarbage()).toBe(0);
    expect(await repo.getAsset(assetId)).toBeTruthy();
  });

  it('rejects SVG, unknown and oversized files', async () => {
    await expect(repo.addAsset(new File([SVG_BYTES], 'x.svg', { type: 'image/svg+xml' }))).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(repo.addAsset(new File([SVG_BYTES], 'x.png', { type: 'image/png' }))).rejects.toThrow();
    const big = new Uint8Array(MAX_ASSET_BYTES + 1);
    big.set(PNG_BYTES);
    await expect(repo.addAsset(new File([big], 'big.png', { type: 'image/png' }))).rejects.toThrow(/limit/);
  });

  it('stores the sniffed MIME type, not the declared one', async () => {
    const id = await repo.addAsset(new File([JPEG_BYTES], 'photo.png', { type: 'image/png' }));
    expect((await repo.getAsset(id))!.mimeType).toBe('image/jpeg');
  });

  it('sniffs supported types', () => {
    expect(sniffImageMime(PNG_BYTES)).toBe('image/png');
    expect(sniffImageMime(JPEG_BYTES)).toBe('image/jpeg');
    expect(sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    expect(sniffImageMime(SVG_BYTES)).toBeNull();
  });

  it('describes quota errors helpfully', () => {
    expect(describeStorageError(new DOMException('x', 'QuotaExceededError'))).toMatch(/storage is full/i);
  });

  it('rejects corrupt records at load time', async () => {
    const t = fixtureGame();
    await db.games.put({ ...t, objects: [{ bogus: true }] } as never);
    await expect(repo.getGame(t.id)).rejects.toThrow(/Invalid game/);
  });

  it('stores an image uploaded twice only once', async () => {
    const a = await repo.addAsset(pngFile('a.png'));
    const b = await repo.addAsset(pngFile('b.png'));
    expect(b).toBe(a);
    expect(await db.assets.count()).toBe(1);
    expect((await repo.getAsset(a))!.hashes).toEqual([await sha256Hex(PNG_BYTES)]);
    const c = await repo.addAsset(new File([JPEG_BYTES], 'photo.jpg', { type: 'image/jpeg' }));
    expect(c).not.toBe(a);
    expect(await db.assets.count()).toBe(2);
  });

  it('re-uploading a stored image renews its garbage-collection grace period', async () => {
    const id = await repo.addAsset(pngFile());
    const now = Date.now();
    await db.assets.update(id, { createdAt: new Date(now - 10 * 60 * 1000).toISOString() });
    expect(await repo.addAsset(pngFile())).toBe(id);
    expect(await repo.collectGarbage(now)).toBe(0);
    expect(await repo.getAsset(id)).toBeTruthy();
    expect(await repo.collectGarbage(LATER)).toBe(1);
  });

  it('stores the downscaled image and records the hashes of both versions', async () => {
    const resized = new Blob([JPEG_BYTES], { type: 'image/jpeg' });
    const calls: string[] = [];
    const resizing = createRepository(db, {
      resize: async (_blob, mime) => {
        calls.push(mime);
        return resized;
      },
    });
    const id = await resizing.addAsset(pngFile());
    expect(calls).toEqual(['image/png']);
    const asset = (await resizing.getAsset(id))!;
    expect(asset.mimeType).toBe('image/jpeg');
    expect(asset.sizeBytes).toBe(JPEG_BYTES.length);
    expect(new Uint8Array(await asset.blob.arrayBuffer())).toEqual(JPEG_BYTES);
    expect(asset.hashes).toEqual([await sha256Hex(JPEG_BYTES), await sha256Hex(PNG_BYTES)]);

    // Uploading the original again (or the stored version) reuses the record without resizing again.
    expect(await resizing.addAsset(pngFile())).toBe(id);
    expect(calls).toHaveLength(1);
    expect(await repo.addAsset(new File([JPEG_BYTES], 'small.jpg', { type: 'image/jpeg' }))).toBe(id);
    expect(await db.assets.count()).toBe(1);
  });

  it('keeps the original when the resizer returns nothing usable', async () => {
    const resizing = createRepository(db, { resize: async () => new Blob([SVG_BYTES], { type: 'image/png' }) });
    const id = await resizing.addAsset(pngFile());
    const asset = (await resizing.getAsset(id))!;
    expect(new Uint8Array(await asset.blob.arrayBuffer())).toEqual(PNG_BYTES);
    expect(asset.hashes).toEqual([await sha256Hex(PNG_BYTES)]);
  });

  it('does not resize without browser image APIs', async () => {
    expect(await downscaleImage(pngFile(), 'image/png')).toBeNull();
  });
});
