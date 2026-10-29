// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibraryPage } from '../features/library/LibraryPage';
import { buildExportZip } from '../import-export/archive';
import { db } from '../persistence/db';
import { useUiStore } from '../state/uiStore';
import { fixtureGame } from './fixtures';

beforeEach(async () => {
  await db.games.clear();
  await db.assets.clear();
  useUiStore.setState({ toasts: [], dialog: null });
});
afterEach(cleanup);

const toasts = () => useUiStore.getState().toasts.map((t) => `${t.tone}: ${t.message}`);

function zipFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as BlobPart], name, { type: 'application/zip' });
}

describe('library page', () => {
  it('imports several files at once and reports the ones that failed', async () => {
    const one = await buildExportZip({ ...fixtureGame(), title: 'One' }, db);
    const two = await buildExportZip({ ...fixtureGame(), title: 'Two' }, db);
    render(<LibraryPage />);
    expect(screen.queryByRole('button', { name: /Export all/ })).toBeNull();

    const input = screen.getByTestId('import-input') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const files = [zipFile(one, 'one.tablenox.zip'), zipFile(new Uint8Array([1, 2, 3]), 'broken.zip'), zipFile(two, 'two.tablenox.zip')];
    fireEvent.change(input, { target: { files } });

    await waitFor(() => expect(toasts()).toHaveLength(2));
    expect(toasts()).toEqual([
      'success: Imported 2 games.',
      expect.stringMatching(/^error: Import failed: broken\.zip: This is not a Tablenox export/),
    ]);
    expect((await db.games.toArray()).map((g) => g.title).sort()).toEqual(['One', 'Two']);
    expect(await screen.findByRole('button', { name: /Export all/ })).toBeTruthy();
  });

  it('names the game when a single file is imported', async () => {
    const bytes = await buildExportZip({ ...fixtureGame(), title: 'Solo' }, db);
    render(<LibraryPage />);
    fireEvent.change(screen.getByTestId('import-input'), { target: { files: [zipFile(bytes, 'solo.tablenox.zip')] } });
    await waitFor(() => expect(toasts()).toEqual(['success: Imported "Solo".']));
  });
});
