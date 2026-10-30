import { z } from 'zod';
import { CLIPBOARD_VERSION, type ClipboardData } from '../domain/clipboard';
import { objectSchema } from '../domain/schema';
import { repo, CLIPBOARD_KEY, type Repository } from './repository';

export { CLIPBOARD_KEY };

const clipboardSchema = z.object({
  version: z.literal(CLIPBOARD_VERSION),
  objects: z.array(objectSchema).min(1).max(10000),
  copiedAt: z.string().max(64),
});

/** The last copy in this tab, used when browser storage can't be read or written. */
let memory: ClipboardData | null = null;

/** Validated clipboard contents, or null for anything else (nothing copied yet, an older format…). */
export function parseClipboard(raw: unknown): ClipboardData | null {
  const r = clipboardSchema.safeParse(raw);
  return r.success ? (r.data as ClipboardData) : null;
}

/** Keeps `data` for pasting in any game: in browser storage (so other tabs and later visits see it) and in memory. */
export async function writeClipboard(data: ClipboardData, repository: Repository = repo): Promise<void> {
  memory = data;
  await repository.setSetting(CLIPBOARD_KEY, data);
}

/** The objects last copied in any game or tab, or null when there are none. */
export async function readClipboard(repository: Repository = repo): Promise<ClipboardData | null> {
  try {
    const stored = parseClipboard(await repository.getSetting(CLIPBOARD_KEY));
    if (stored && (!memory || stored.copiedAt >= memory.copiedAt)) return stored;
  } catch {
    // Storage unavailable: fall back to this tab's copy.
  }
  return memory;
}

/** Test helper: forgets this tab's copy. */
export function resetClipboardMemory(): void {
  memory = null;
}
