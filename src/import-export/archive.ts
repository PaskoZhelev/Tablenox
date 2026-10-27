import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { newId, nowIso } from '../domain/ids';
import { collectAssetIds, remapAssetIds } from '../domain/objects';
import { parseGame, SchemaError } from '../domain/schema';
import { ASSET_MIME_TYPES, SCHEMA_VERSION, type Game, type StoredAsset } from '../domain/types';
import { extensionForMime, MAX_ASSET_BYTES, sniffImageMime } from '../persistence/assetValidation';
import { db as defaultDb, type TablenoxDB } from '../persistence/db';

export const EXPORT_FORMAT = 'tablenox';
export const EXPORT_EXTENSION = '.tablenox.zip';
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;
export const MAX_ENTRIES = 2000;

const ASSET_PATH = /^assets\/([A-Za-z0-9_-]{1,100})\.(png|jpg|jpeg|webp)$/;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const manifestAssetSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(500),
  mimeType: z.enum(ASSET_MIME_TYPES as [string, ...string[]]),
  sizeBytes: z.number().int().nonnegative(),
  path: z.string().regex(ASSET_PATH),
});

const manifestSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.number().int(),
  exportType: z.literal('game'),
  exportedAt: z.string().max(64),
  data: z.unknown(),
  assets: z.array(manifestAssetSchema).max(MAX_ENTRIES),
});

export interface Manifest {
  format: typeof EXPORT_FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  exportType: 'game';
  exportedAt: string;
  data: Game;
  assets: z.infer<typeof manifestAssetSchema>[];
}

export async function buildExportZip(data: Game, database: TablenoxDB = defaultDb): Promise<Uint8Array> {
  const ids = [...collectAssetIds(data.objects)];
  const assets = (await database.assets.bulkGet(ids)).filter((a): a is StoredAsset => !!a);
  const files: Zippable = {};
  const manifest: Manifest = {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportType: 'game',
    exportedAt: nowIso(),
    data,
    assets: [],
  };
  for (const a of assets) {
    const path = `assets/${a.id}.${extensionForMime(a.mimeType)}`;
    files[path] = [new Uint8Array(await a.blob.arrayBuffer()), { level: 0 }];
    manifest.assets.push({ id: a.id, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, path });
  }
  files['manifest.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
  return zipSync(files);
}

export function exportFileName(title: string): string {
  const safe =
    title
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'tablenox-game';
  return `${safe}${EXPORT_EXTENSION}`;
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ParsedImport {
  data: Game;
  assets: { id: string; name: string; mimeType: StoredAsset['mimeType']; bytes: Uint8Array }[];
}

/** Validates archive structure and content without touching the database. */
export function parseImportZip(bytes: Uint8Array): ParsedImport {
  if (bytes.length > MAX_IMPORT_BYTES) {
    throw new ImportError(`File is too large (limit ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`);
  }
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ImportError('This is not a Tablenox export (.tablenox.zip).');
  }

  let entryCount = 0;
  let totalSize = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        entryCount++;
        if (entryCount > MAX_ENTRIES) throw new ImportError('Archive contains too many files.');
        if (file.name.endsWith('/')) return false;
        const isManifest = file.name === 'manifest.json';
        if (!isManifest && !ASSET_PATH.test(file.name)) {
          throw new ImportError(`Archive contains an unexpected or unsafe path: "${file.name.slice(0, 80)}"`);
        }
        const limit = isManifest ? MAX_MANIFEST_BYTES : MAX_ASSET_BYTES;
        if (file.originalSize > limit) throw new ImportError(`"${file.name}" is too large.`);
        totalSize += file.originalSize;
        if (totalSize > MAX_UNCOMPRESSED_BYTES) throw new ImportError('Archive expands to more data than allowed.');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError('The archive is corrupt or could not be read.');
  }

  let actualTotal = 0;
  for (const [name, data] of Object.entries(entries)) {
    actualTotal += data.length;
    const limit = name === 'manifest.json' ? MAX_MANIFEST_BYTES : MAX_ASSET_BYTES;
    if (data.length > limit || actualTotal > MAX_UNCOMPRESSED_BYTES) throw new ImportError('Archive content exceeds limits.');
  }

  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) throw new ImportError('Archive is missing manifest.json.');
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new ImportError('manifest.json is not valid JSON.');
  }
  const m = manifestSchema.safeParse(manifestRaw);
  if (!m.success) throw new ImportError('manifest.json is not a valid Tablenox manifest.');
  if (m.data.schemaVersion > SCHEMA_VERSION) {
    throw new ImportError('This file was created by a newer version of Tablenox.');
  }
  if (m.data.schemaVersion !== SCHEMA_VERSION) {
    throw new ImportError(`Unsupported schema version ${m.data.schemaVersion}.`);
  }

  let data: Game;
  try {
    data = parseGame(m.data.data);
  } catch (err) {
    throw new ImportError(err instanceof SchemaError ? err.message : 'Game data is invalid.');
  }

  const assets: ParsedImport['assets'] = [];
  const seen = new Set<string>();
  for (const a of m.data.assets) {
    if (seen.has(a.id)) throw new ImportError('Duplicate asset in manifest.');
    seen.add(a.id);
    const entry = entries[a.path];
    if (!entry) throw new ImportError(`Missing image file ${a.path}.`);
    const sniffed = sniffImageMime(entry);
    if (!sniffed || sniffed !== a.mimeType) throw new ImportError(`${a.path} is not a valid ${a.mimeType} image.`);
    assets.push({ id: a.id, name: a.name, mimeType: sniffed, bytes: entry });
  }

  for (const ref of collectAssetIds(data.objects)) {
    if (!seen.has(ref)) throw new ImportError('Game references an image that is not included in the archive.');
  }

  // Only keep images the game actually uses (an archive may carry extra ones).
  const used = collectAssetIds(data.objects);
  return { data, assets: assets.filter((a) => used.has(a.id)) };
}

/** Imports with fresh IDs inside a single transaction (all-or-nothing). */
export async function importParsed(parsed: ParsedImport, database: TablenoxDB = defaultDb): Promise<{ id: string; title: string }> {
  const idMap = new Map(parsed.assets.map((a) => [a.id, newId()]));
  const createdAt = nowIso();
  const assetRecords: StoredAsset[] = parsed.assets.map((a) => ({
    id: idMap.get(a.id)!,
    name: a.name,
    mimeType: a.mimeType,
    sizeBytes: a.bytes.length,
    blob: new Blob([a.bytes as BlobPart], { type: a.mimeType }),
    createdAt,
  }));
  const now = nowIso();
  const id = newId();

  await database.transaction('rw', database.assets, database.games, async () => {
    await database.assets.bulkAdd(assetRecords);
    await database.games.add({ ...parsed.data, id, objects: remapAssetIds(parsed.data.objects, idMap), updatedAt: now });
  });
  return { id, title: parsed.data.title };
}

export async function importFile(file: Blob, database: TablenoxDB = defaultDb) {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError(`File is too large (limit ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importParsed(parseImportZip(bytes), database);
}
