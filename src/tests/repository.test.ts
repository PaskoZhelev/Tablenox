import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ASSET_BYTES, sniffImageMime } from '../persistence/assetValidation';
import { TablenoxDB } from '../persistence/db';
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
});
