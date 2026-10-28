import { expect, type Locator, type Page } from '@playwright/test';

type StoreState = {
  camera: { x: number; y: number; scale: number };
  history: {
    present: { objects: Array<Record<string, unknown>>; annotations: { strokes: unknown[]; text: Array<Record<string, unknown>> } };
  };
  saveStatus: string;
  doc: { id: string; type: string } | null;
};

/** Reads a JSON-serialisable projection of the dev-only store exposed on window. */
export async function storeState<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate((src) => {
    const s = (window as unknown as { __tablenoxStore: { getState(): StoreState } }).__tablenoxStore.getState();
    return new Function('s', `return (${src})(s)`)(s);
  }, fn);
}

/** Screen position (page coordinates) of an object's centre, found by name. */
export async function objectScreenPos(page: Page, name: string): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId('table-canvas').boundingBox())!;
  const p = await page.evaluate((name) => {
    const s = (window as unknown as { __tablenoxStore: { getState(): StoreState } }).__tablenoxStore.getState();
    const o = s.history.present.objects.find((x) => x.name === name) as
      { position: { x: number; y: number }; width: number; height: number } | undefined;
    if (!o) throw new Error(`No object named ${name}`);
    const c = s.camera;
    return { x: (o.position.x + o.width / 2) * c.scale + c.x, y: (o.position.y + o.height / 2) * c.scale + c.y };
  }, name);
  return { x: box.x + p.x, y: box.y + p.y };
}

/**
 * Adds an object (found by name or id) to the open automation step's object list by clicking it on the table:
 * centres the camera on it (left of the automations panel), then Pick on table → click → Done picking.
 */
export async function pickStepObject(page: Page, panel: Locator, nameOrId: string): Promise<void> {
  const box = (await page.getByTestId('table-canvas').boundingBox())!;
  const p = await page.evaluate((key) => {
    const s = (
      window as unknown as {
        __tablenoxStore: {
          getState(): StoreState & { viewport: { width: number; height: number }; setCamera(c: StoreState['camera']): void };
        };
      }
    ).__tablenoxStore.getState();
    const o = s.history.present.objects.find((x) => x.id === key || x.name === key) as
      { position: { x: number; y: number }; width: number; height: number } | undefined;
    if (!o) throw new Error(`No object ${key}`);
    const target = { x: s.viewport.width * 0.3, y: s.viewport.height / 2 };
    const scale = s.camera.scale;
    s.setCamera({ scale, x: target.x - (o.position.x + o.width / 2) * scale, y: target.y - (o.position.y + o.height / 2) * scale });
    return target;
  }, nameOrId);
  await panel.getByRole('button', { name: 'Pick on table' }).click();
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await panel.getByRole('button', { name: 'Done picking' }).click();
}

export async function worldToPage(page: Page, wx: number, wy: number) {
  const box = (await page.getByTestId('table-canvas').boundingBox())!;
  const c = await storeState<{ x: number; y: number; scale: number }>(page, '(s) => s.camera');
  return { x: box.x + wx * c.scale + c.x, y: box.y + wy * c.scale + c.y };
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText(/Saved/, { timeout: 10_000 });
}

/** Renders a PNG in the page (so we have a real decodable image) and returns its bytes. */
export async function makePng(page: Page, w = 800, h = 600, label = 'Sheet'): Promise<Buffer> {
  const b64 = await page.evaluate(
    ({ w, h, label }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fffbe8';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#333';
      for (let x = 0; x < w; x += 50) ctx.strokeRect(x, 0, 50, h);
      ctx.fillStyle = '#000';
      ctx.font = '40px sans-serif';
      ctx.fillText(label, 20, 60);
      return c.toDataURL('image/png').split(',')[1];
    },
    { w, h, label },
  );
  return Buffer.from(b64, 'base64');
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export async function newGame(page: Page, title: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByLabel('Game title').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/#\/edit\//);
  await expect(page.getByTestId('table-canvas')).toBeVisible();
}
