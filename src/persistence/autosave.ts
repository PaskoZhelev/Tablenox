export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export interface AutosaverOptions {
  delayMs?: number;
  save: () => Promise<void>;
  onStatus: (status: SaveStatus, error?: unknown) => void;
}

/**
 * Debounced save scheduler. In-memory state is never discarded on failure; the next change or an
 * explicit flush retries the save.
 */
export function createAutosaver({ delayMs = 800, save, onStatus }: AutosaverOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  async function run(): Promise<void> {
    if (inFlight) {
      await inFlight;
      if (!dirty) return;
    }
    if (!dirty || disposed) return;
    dirty = false;
    onStatus('saving');
    inFlight = (async () => {
      try {
        await save();
        onStatus(dirty ? 'unsaved' : 'saved');
      } catch (err) {
        dirty = true;
        onStatus('error', err);
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
  }

  return {
    markDirty() {
      if (disposed) return;
      dirty = true;
      onStatus('unsaved');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    },
    /** Saves immediately if there are pending changes. */
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await run();
    },
    isDirty: () => dirty,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      disposed = true;
    },
  };
}

export type Autosaver = ReturnType<typeof createAutosaver>;
