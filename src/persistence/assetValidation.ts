import { ASSET_MIME_TYPES, type AssetMimeType } from '../domain/types';

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetValidationError';
  }
}

/** Detects the real image type from magic bytes; returns null for anything unsupported (incl. SVG). */
export function sniffImageMime(bytes: Uint8Array): AssetMimeType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function isAllowedMime(mime: string): mime is AssetMimeType {
  return (ASSET_MIME_TYPES as string[]).includes(mime);
}

export function extensionForMime(mime: AssetMimeType): string {
  return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
}

/** Validates an uploaded file before it is stored. Size is checked before reading the content. */
export async function validateImageFile(file: Blob & { name?: string }): Promise<AssetMimeType> {
  if (file.size > MAX_ASSET_BYTES) {
    throw new AssetValidationError(
      `"${file.name ?? 'image'}" is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_ASSET_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (file.size === 0) throw new AssetValidationError('The file is empty.');
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime = sniffImageMime(head);
  if (!mime) {
    throw new AssetValidationError(`"${file.name ?? 'file'}" is not a PNG, JPEG or WebP image.`);
  }
  return mime;
}
