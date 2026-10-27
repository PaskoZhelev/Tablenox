import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { buildExportZip, ImportError, importParsed, MAX_ENTRIES, parseImportZip } from '../import-export/archive';
import { SCHEMA_VERSION, type Game } from '../domain/types';
import { TablenoxDB } from '../persistence/db';
import { createRepository } from '../persistence/repository';
import { fixtureGame, JPEG_BYTES, PNG_BYTES, pngFile, SVG_BYTES } from './fixtures';

let db: TablenoxDB;
let repo: ReturnType<typeof createRepository>;

beforeEach(async () => {
  db = new TablenoxDB(`test-${Math.random()}`);
  repo = createRepository(db);
});

afterEach(async () => {
  await db.delete();
});

function manifestZip(manifest: unknown, extra: Record<string, Uint8Array> = {}) {
  return zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...extra });
}

describe('export / import', () => {
  it('round-trips a template with images through a clean database (AC13)', async () => {
    const assetId = await repo.addAsset(pngFile());
    const t = fixtureGame(assetId);
    await repo.saveGame(t);
    const bytes = await buildExportZip(t, db);

    // "clear local application records"
    await db.delete();
    db = new TablenoxDB(`test-${Math.random()}`);
    repo = createRepository(db);

    const result = await importParsed(parseImportZip(bytes), db);
    const imported = (await repo.getGame(result.id))!;
    expect(imported.title).toBe(t.title);
    expect(imported.objects).toHaveLength(t.objects.length);
    const board = imported.objects.find((o) => o.kind === 'board') as { assetId?: string };
    expect(board.assetId).toBeTruthy();
    expect(board.assetId).not.toBe(assetId); // fresh ids
    const asset = (await repo.getAsset(board.assetId!))!;
    expect(asset.mimeType).toBe('image/png');
    expect(new Uint8Array(await asset.blob.arrayBuffer())).toEqual(PNG_BYTES);
    const deck = imported.objects.find((o) => o.kind === 'deck') as { cards: { faceAssetId?: string }[] };
    expect(deck.cards[0].faceAssetId).toBe(board.assetId);
  });

  it('imports twice without id collisions', async () => {
    const assetId = await repo.addAsset(pngFile());
    const t = fixtureGame(assetId);
    const bytes = await buildExportZip(t, db);
    const a = await importParsed(parseImportZip(bytes), db);
    const b = await importParsed(parseImportZip(bytes), db);
    expect(a.id).not.toBe(b.id);
    expect(await db.games.count()).toBe(2);
  });

  it('rejects path traversal entries', () => {
    const zip = zipSync({ 'manifest.json': strToU8('{}'), '../evil.png': PNG_BYTES });
    expect(() => parseImportZip(zip)).toThrow(/unsafe path/);
    const zip2 = zipSync({ 'manifest.json': strToU8('{}'), 'assets/../../x.png': PNG_BYTES });
    expect(() => parseImportZip(zip2)).toThrow(ImportError);
  });

  it('rejects archives with too many entries', () => {
    const files: Record<string, Uint8Array> = { 'manifest.json': strToU8('{}') };
    for (let i = 0; i <= MAX_ENTRIES; i++) files[`assets/a${i}.png`] = PNG_BYTES;
    expect(() => parseImportZip(zipSync(files))).toThrow(/too many/);
  });

  it('rejects non-zip input and missing manifests', () => {
    expect(() => parseImportZip(strToU8('{"hello":1}'))).toThrow(ImportError);
    expect(() => parseImportZip(zipSync({ 'assets/a.png': PNG_BYTES }))).toThrow(/manifest/);
  });

  it('rejects decompression bombs before inflating', () => {
    const big = new Uint8Array(25 * 1024 * 1024); // zeros compress extremely well
    const zip = zipSync({ 'manifest.json': strToU8('{}'), 'assets/a.png': big });
    expect(zip.length).toBeLessThan(1024 * 1024);
    expect(() => parseImportZip(zip)).toThrow(/too large|exceeds/);
  });

  it('rejects assets whose content is not the declared image type (e.g. SVG)', () => {
    const t = fixtureGame('x1');
    const manifest = {
      format: 'tablenox',
      schemaVersion: SCHEMA_VERSION,
      exportType: 'game',
      exportedAt: new Date().toISOString(),
      data: t,
      assets: [{ id: 'x1', name: 'evil', mimeType: 'image/png', sizeBytes: SVG_BYTES.length, path: 'assets/x1.png' }],
    };
    expect(() => parseImportZip(manifestZip(manifest, { 'assets/x1.png': SVG_BYTES }))).toThrow(/not a valid image\/png/);
  });

  it('rejects unsupported schema versions and missing referenced assets', () => {
    const t = fixtureGame('x1');
    const base = { format: 'tablenox', exportType: 'game', exportedAt: '', data: t, assets: [] };
    expect(() => parseImportZip(manifestZip({ ...base, schemaVersion: 99 }))).toThrow(/newer/);
    expect(() => parseImportZip(manifestZip({ ...base, schemaVersion: 0 }))).toThrow(/Unsupported/);
    expect(() => parseImportZip(manifestZip({ ...base, schemaVersion: SCHEMA_VERSION }))).toThrow(/not included/);
  });

  it('rejects malformed game data with a readable message', () => {
    const t = { ...fixtureGame(), objects: [{ kind: 'card' }] } as unknown as Game;
    const m = { format: 'tablenox', schemaVersion: SCHEMA_VERSION, exportType: 'game', exportedAt: '', data: t, assets: [] };
    expect(() => parseImportZip(manifestZip(m))).toThrow(/Invalid game/);
  });

  it('is transactional: a failing import leaves nothing behind', async () => {
    const assetId = await repo.addAsset(pngFile());
    const t = fixtureGame(assetId);
    const parsed = parseImportZip(await buildExportZip(t, db));
    const assetsBefore = await db.assets.count();
    // Force a failure inside the transaction by corrupting data after validation.
    (parsed.data as Game).objects = undefined as never;
    const origAdd = db.games.add.bind(db.games);
    db.games.add = (() => Promise.reject(new Error('boom'))) as unknown as typeof db.games.add;
    await expect(importParsed(parsed, db)).rejects.toThrow();
    db.games.add = origAdd;
    expect(await db.assets.count()).toBe(assetsBefore);
    expect(await db.games.count()).toBe(0);
  });

  it('accepts JPEG assets', () => {
    const t = fixtureGame('j1');
    const manifest = {
      format: 'tablenox',
      schemaVersion: SCHEMA_VERSION,
      exportType: 'game',
      exportedAt: '',
      data: t,
      assets: [{ id: 'j1', name: 'photo', mimeType: 'image/jpeg', sizeBytes: JPEG_BYTES.length, path: 'assets/j1.jpg' }],
    };
    expect(parseImportZip(manifestZip(manifest, { 'assets/j1.jpg': JPEG_BYTES })).assets).toHaveLength(1);
  });
});
