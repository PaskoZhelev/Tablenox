import { newId, nowIso } from '../domain/ids';
import { collectAssetIds } from '../domain/objects';
import { parseGame } from '../domain/schema';
import type { Game, StoredAsset } from '../domain/types';
import { sha256Hex, validateImageFile } from './assetValidation';
import { db, type TablenoxDB } from './db';
import { downscaleImage, type ImageResizer } from './imageResize';

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export function describeStorageError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const inner = err instanceof Error && 'inner' in err ? (err as { inner?: Error }).inner : undefined;
  if (name === 'QuotaExceededError' || inner?.name === 'QuotaExceededError') {
    return 'Browser storage is full. Export your game to keep a copy, then free space by deleting unused games.';
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Assets newer than this are never garbage-collected, to protect uploads that have not been autosaved yet. */
const GC_GRACE_MS = 2 * 60 * 1000;

export interface RepositoryOptions {
  /** Shrinks large uploads; injectable for tests. */
  resize?: ImageResizer;
}

export function createRepository(database: TablenoxDB = db, options: RepositoryOptions = {}) {
  const resize = options.resize ?? downscaleImage;

  async function getGame(id: string): Promise<Game | undefined> {
    const raw = await database.games.get(id);
    return raw ? parseGame(raw) : undefined;
  }

  async function saveGame(g: Game): Promise<void> {
    await database.games.put(g);
  }

  async function referencedAssetIds(): Promise<Set<string>> {
    const refs = new Set<string>();
    await database.games.each((g) => collectAssetIds(g.objects).forEach((id) => refs.add(id)));
    return refs;
  }

  /** Deletes assets that no game references. Returns the number removed. */
  async function collectGarbage(now = Date.now()): Promise<number> {
    return database.transaction('rw', database.games, database.assets, async () => {
      const refs = await referencedAssetIds();
      const orphans: string[] = [];
      await database.assets.each((a) => {
        const age = now - Date.parse(a.createdAt);
        if (!refs.has(a.id) && !(age < GC_GRACE_MS)) orphans.push(a.id);
      });
      await database.assets.bulkDelete(orphans);
      return orphans.length;
    });
  }

  async function deleteGame(id: string): Promise<void> {
    await database.games.delete(id);
    await collectGarbage();
  }

  /** Records that a game was opened in Play mode (doesn't count as a change to the game). */
  async function markPlayed(id: string, at: string): Promise<void> {
    await database.games.update(id, { lastPlayedAt: at });
  }

  async function addAsset(file: Blob & { name?: string }): Promise<string> {
    const originalMime = await validateImageFile(file);
    const originalHash = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
    const existing = await reuseAsset([originalHash]);
    if (existing) return existing;

    let blob: Blob = file;
    let mimeType = originalMime;
    const resized = await resize(file, originalMime).catch(() => null);
    if (resized) {
      const resizedMime = await validateImageFile(resized).catch(() => null);
      if (resizedMime) {
        blob = resized;
        mimeType = resizedMime;
      }
    }
    const hashes = blob === file ? [originalHash] : [await sha256Hex(new Uint8Array(await blob.arrayBuffer())), originalHash];
    const asset: StoredAsset = {
      id: newId(),
      name: (file.name ?? 'image').slice(0, 200),
      mimeType,
      sizeBytes: blob.size,
      blob: blob.type === mimeType ? blob : new Blob([blob], { type: mimeType }),
      createdAt: nowIso(),
      hashes,
    };
    return database.transaction('rw', database.assets, async () => {
      const match = await reuseAsset(hashes);
      if (match) return match;
      await database.assets.add(asset);
      return asset.id;
    });
  }

  /**
   * Finds a stored asset with one of these hashes and refreshes its `createdAt`, so the GC grace period protects it
   * until the game that uses it is saved. Records any new hashes on it. Returns its id.
   */
  async function reuseAsset(hashes: string[]): Promise<string | undefined> {
    return database.transaction('rw', database.assets, async () => {
      const match = await database.assets.where('hashes').anyOf(hashes).first();
      if (!match) return undefined;
      const merged = [...new Set([...(match.hashes ?? []), ...hashes])];
      await database.assets.update(match.id, { createdAt: nowIso(), hashes: merged });
      return match.id;
    });
  }

  async function getAsset(id: string): Promise<StoredAsset | undefined> {
    return database.assets.get(id);
  }

  async function getSetting<T>(key: string): Promise<T | undefined> {
    return (await database.settings.get(key))?.value as T | undefined;
  }

  async function setSetting(key: string, value: unknown): Promise<void> {
    await database.settings.put({ key, value });
  }

  return {
    db: database,
    getGame,
    saveGame,
    deleteGame,
    markPlayed,
    addAsset,
    getAsset,
    referencedAssetIds,
    collectGarbage,
    getSetting,
    setSetting,
  };
}

export type Repository = ReturnType<typeof createRepository>;

export const repo = createRepository();
