import { confirmDialog } from '../state/uiStore';
import { downloadBytes, exceedsImportLimit, MAX_IMPORT_BYTES } from './archive';

/** Warns when an export is too large to be imported back. Resolves true when it should be downloaded. */
export async function confirmExportSize(bytes: Uint8Array, kind: 'game' | 'library' = 'game'): Promise<boolean> {
  if (!exceedsImportLimit(bytes)) return true;
  const mb = (n: number) => Math.round(n / 1024 / 1024);
  const tip =
    kind === 'library'
      ? 'This file holds a single game that is over the limit. Remove unused or large images from that game.'
      : 'Remove unused or large images to make the game smaller.';
  return confirmDialog({
    title: `Export is larger than ${mb(MAX_IMPORT_BYTES)} MB`,
    message: `This export is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. Tablenox can only import files up to ${mb(MAX_IMPORT_BYTES)} MB, so this file can't be imported back. ${tip}`,
    confirmLabel: 'Export anyway',
  });
}

/** Downloads an export after the size check. Resolves false when the user cancelled. */
export async function downloadExport(bytes: Uint8Array, fileName: string, kind: 'game' | 'library' = 'game'): Promise<boolean> {
  if (!(await confirmExportSize(bytes, kind))) return false;
  downloadBytes(bytes, fileName);
  return true;
}
