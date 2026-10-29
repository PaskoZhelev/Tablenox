import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  buildExportZip,
  buildLibraryZip,
  exceedsImportLimit,
  ImportError,
  importParsed,
  libraryExportFileName,
  MAX_ENTRIES,
  MAX_IMPORT_BYTES,
  parseImportZip,
} from '../import-export/archive';
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

    const [result] = await importParsed(parseImportZip(bytes), db);
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
    const [a] = await importParsed(parseImportZip(bytes), db);
    const [b] = await importParsed(parseImportZip(bytes), db);
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
    await db.delete();
    db = new TablenoxDB(`test-${Math.random()}`);
    const origAdd = db.games.add.bind(db.games);
    db.games.add = (() => Promise.reject(new Error('boom'))) as unknown as typeof db.games.add;
    await expect(importParsed(parsed, db)).rejects.toThrow();
    db.games.add = origAdd;
    expect(await db.assets.count()).toBe(0);
    expect(await db.games.count()).toBe(0);
  });

  it('reuses an image that is already stored instead of adding it again', async () => {
    const assetId = await repo.addAsset(pngFile());
    const t = fixtureGame(assetId);
    await repo.saveGame(t);
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await db.assets.update(assetId, { createdAt: old });

    const [result] = await importParsed(parseImportZip(await buildExportZip(t, db)), db);
    expect(await db.assets.count()).toBe(1);
    const imported = (await repo.getGame(result.id))!;
    const board = imported.objects.find((o) => o.kind === 'board') as { assetId?: string };
    expect(board.assetId).toBe(assetId);
    // The reused image counts as fresh again, so the GC grace period protects it.
    expect((await repo.getAsset(assetId))!.createdAt).not.toBe(old);
  });

  it('stores several imported images with identical bytes once', async () => {
    const t = fixtureGame('a1');
    const deck = t.objects.find((o) => o.kind === 'deck') as { cards: { faceAssetId?: string }[] };
    deck.cards[0].faceAssetId = 'a2';
    const manifest = {
      format: 'tablenox',
      schemaVersion: SCHEMA_VERSION,
      exportType: 'game',
      exportedAt: '',
      data: t,
      assets: [
        { id: 'a1', name: 'one', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, path: 'assets/a1.png' },
        { id: 'a2', name: 'two', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, path: 'assets/a2.png' },
      ],
    };
    const parsed = parseImportZip(manifestZip(manifest, { 'assets/a1.png': PNG_BYTES, 'assets/a2.png': PNG_BYTES }));
    expect(parsed.assets).toHaveLength(2);
    const [result] = await importParsed(parsed, db);
    expect(await db.assets.count()).toBe(1);
    const imported = (await repo.getGame(result.id))!;
    const board = imported.objects.find((o) => o.kind === 'board') as { assetId?: string };
    const importedDeck = imported.objects.find((o) => o.kind === 'deck') as { cards: { faceAssetId?: string }[] };
    expect(importedDeck.cards[0].faceAssetId).toBe(board.assetId);
  });

  it('round-trips a whole library, storing a shared image once', async () => {
    const shared = await repo.addAsset(pngFile());
    const other = await repo.addAsset(new File([JPEG_BYTES], 'photo.jpg', { type: 'image/jpeg' }));
    const a = { ...fixtureGame(shared), id: 'game-a', title: 'Game A' };
    const b = { ...fixtureGame(shared), id: 'game-b', title: 'Game B' };
    const c = { ...fixtureGame(other), id: 'game-c', title: 'Game C' };
    const bytes = await buildLibraryZip([a, b, c], db);

    const entries = unzipSync(bytes);
    expect(Object.keys(entries).filter((n) => n.startsWith('assets/'))).toHaveLength(2);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.exportType).toBe('library');
    expect(manifest.games).toHaveLength(3);

    await db.delete();
    db = new TablenoxDB(`test-${Math.random()}`);
    repo = createRepository(db);

    const parsed = parseImportZip(bytes);
    expect(parsed.games.map((g) => g.title)).toEqual(['Game A', 'Game B', 'Game C']);
    const results = await importParsed(parsed, db);
    expect(results.map((r) => r.title)).toEqual(['Game A', 'Game B', 'Game C']);
    expect(new Set(results.map((r) => r.id)).size).toBe(3);
    expect(await db.games.count()).toBe(3);
    expect(await db.assets.count()).toBe(2);
    const boardAsset = async (id: string) =>
      ((await repo.getGame(id))!.objects.find((o) => o.kind === 'board') as { assetId?: string }).assetId;
    const [ia, ib, ic] = await Promise.all(results.map((r) => boardAsset(r.id)));
    expect(ia).toBe(ib);
    expect(ic).not.toBe(ia);
    expect((await repo.getAsset(ic!))!.mimeType).toBe('image/jpeg');
  });

  it('imports a library all-or-nothing and reports which game is invalid', () => {
    const good = fixtureGame();
    const bad = { ...fixtureGame(), objects: [{ kind: 'card' }] };
    const m = { format: 'tablenox', schemaVersion: SCHEMA_VERSION, exportType: 'library', exportedAt: '', games: [good, bad], assets: [] };
    expect(() => parseImportZip(manifestZip(m))).toThrow(/Game 2: Invalid game/);
    expect(() => parseImportZip(manifestZip({ ...m, games: [] }))).toThrow(/no games/);
  });

  it('still imports a single-game archive', async () => {
    const t = fixtureGame();
    const m = { format: 'tablenox', schemaVersion: SCHEMA_VERSION, exportType: 'game', exportedAt: '', data: t, assets: [] };
    const results = await importParsed(parseImportZip(manifestZip(m)), db);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe(t.title);
    expect(await db.games.count()).toBe(1);
  });

  it('flags exports that are too large to import back and names library exports by date', () => {
    expect(exceedsImportLimit(new Uint8Array(10))).toBe(false);
    expect(exceedsImportLimit({ length: MAX_IMPORT_BYTES + 1 } as Uint8Array)).toBe(true);
    expect(libraryExportFileName(new Date(2026, 0, 5))).toBe('tablenox-library-2026-01-05.tablenox.zip');
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
