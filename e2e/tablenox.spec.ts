import { expect, test, type Page } from '@playwright/test';
import {
  clickObject,
  collectConsoleErrors,
  makePng,
  newGame,
  objectScreenPos,
  pickStepObject,
  storeState,
  waitSaved,
  worldToPage,
} from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('tablenox');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
  await page.reload();
});

async function addSampleAndPlay(page: Page) {
  await page.getByRole('button', { name: 'Add sample game' }).click();
  await expect(page.getByTestId('game-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page).toHaveURL(/#\/play\//);
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await page.waitForTimeout(300);
}

/**
 * Switches between Edit and Play mode and waits for the table to be ready again. The mode follows the URL a little
 * later (hash change, then an effect), so this waits for the store too: a canvas click before that uses the old mode.
 */
async function switchMode(page: Page, mode: 'edit' | 'play') {
  await page.getByRole('button', { name: mode === 'edit' ? 'Edit' : 'Play', exact: true }).click();
  await expect(page).toHaveURL(mode === 'edit' ? /#\/edit\// : /#\/play\//);
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await expect.poll(() => storeState(page, '(s) => s.mode')).toBe(mode);
  await page.waitForTimeout(300);
}

const obj = <T>(page: Page, name: string, expr: string) =>
  storeState<T>(
    page,
    `(s) => { const o = s.history.present.objects.find(o => o.name === ${JSON.stringify(name)}); return o && (${expr}); }`,
  );

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, opts: { shift?: boolean } = {}) {
  await page.mouse.move(from.x, from.y);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
}

async function gamesInDb(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const req = indexedDB.open('tablenox');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const n: number = await new Promise((r) => {
      const q = db.transaction('games').objectStore('games').count();
      q.onsuccess = () => r(q.result);
    });
    db.close();
    return n;
  });
}

test('create a game: upload board, add card, move/resize/rotate, reload', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await newGame(page, 'My Roll & Write');
  const png = await makePng(page, 800, 600);
  await page.getByTestId('add-board-input').setInputFiles({ name: 'sheet.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => storeState<number>(page, '(s) => s.history.present.objects.length')).toBe(1);
  // New boards aren't locked (they move in Edit mode) but stay put in Play mode.
  expect(await obj(page, 'Board', '({ w: o.width, h: o.height, locked: o.locked, playMovable: !!o.playMovable })')).toEqual({
    w: 800,
    h: 600,
    locked: false,
    playMovable: false,
  });

  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Card' }).click();
  await expect.poll(() => storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'card').length")).toBe(1);

  const before = await obj<{ x: number }>(page, 'Card', 'o.position');
  await drag(page, await objectScreenPos(page, 'Card'), 120, 60);
  const after = await obj<{ x: number; y: number }>(page, 'Card', 'o.position');
  expect(after.x).not.toBe(before.x);

  // Properties panel is closed by default; open it to resize precisely.
  await expect(page.getByRole('complementary', { name: 'Properties' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Properties panel' }).click();
  await page.getByLabel('Width', { exact: true }).fill('200');
  await page.getByLabel('Width', { exact: true }).press('Enter');
  await expect.poll(() => obj<number>(page, 'Card', 'o.width')).toBe(200);

  const box = (await page.getByTestId('table-canvas').boundingBox())!;
  const rotater = await page.evaluate(() => {
    const K = (
      window as unknown as {
        Konva: {
          stages: Array<{
            findOne(s: string): { findOne(s: string): { getClientRect(): { x: number; y: number; width: number; height: number } } };
          }>;
        };
      }
    ).Konva;
    const r = K.stages[0].findOne('Transformer').findOne('.rotater').getClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await drag(page, { x: box.x + rotater.x, y: box.y + rotater.y }, 150, 120);
  await expect.poll(() => obj<number>(page, 'Card', 'o.rotation')).not.toBe(0);
  const rotation = await obj<number>(page, 'Card', 'o.rotation');

  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await expect.poll(() => storeState<number>(page, '(s) => s.history.present.objects.length')).toBe(2);
  expect(await obj(page, 'Card', '({ x: o.position.x, w: o.width, r: o.rotation })')).toEqual({ x: after.x, w: 200, r: rotation });
  expect(errors).toEqual([]);
});

test('one save per game: Play → Edit → Play keeps progress; reload keeps it; no extra saves', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await addSampleAndPlay(page);
  await drag(page, await objectScreenPos(page, 'Marker'), -120, -60);
  const moved = await obj<{ x: number; y: number }>(page, 'Marker', 'o.position');

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/#\/edit\//);
  expect(await obj(page, 'Marker', 'o.position')).toEqual(moved);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page).toHaveURL(/#\/play\//);
  expect(await obj(page, 'Marker', 'o.position')).toEqual(moved);

  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await expect.poll(() => obj(page, 'Marker', 'o.position')).toEqual(moved);

  await page.getByRole('button', { name: 'Back to library' }).click();
  await expect(page.getByTestId('game-card')).toHaveCount(1);
  expect(await gamesInDb(page)).toBe(1);
  expect(errors).toEqual([]);
});

test('boards stay put in Play mode unless made movable there; locking stops moving in both modes', async ({ page }) => {
  await addSampleAndPlay(page);
  const boardBefore = await obj(page, 'Score sheet', 'o.position');
  const p = await worldToPage(page, -200, 300);
  await drag(page, p, 80, 30);
  expect(await obj(page, 'Score sheet', 'o.position')).toEqual(boardBefore);
  expect(await obj<boolean>(page, 'Score sheet', 'o.locked')).toBe(false);

  // Nothing to do with a board during a game, so Play mode shows no menu; it is set up in Edit mode.
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Score sheet menu' })).toHaveCount(0);
  await switchMode(page, 'edit');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Score sheet menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Movable in Play mode' }).click();
  await expect.poll(() => obj<boolean>(page, 'Score sheet', 'o.playMovable')).toBe(true);
  await switchMode(page, 'play');

  await drag(page, p, 80, 30);
  const moved = await obj(page, 'Score sheet', 'o.position');
  expect(moved).not.toEqual(boardBefore);

  // Locking is setup too: L does nothing in Play mode.
  await page.keyboard.press('l');
  await page.waitForTimeout(100);
  expect(await obj<boolean>(page, 'Score sheet', 'o.locked')).toBe(false);
  // Lock it with the keyboard in Edit mode: now it can't move at all.
  await switchMode(page, 'edit');
  const p2 = await worldToPage(page, -200, 300);
  await page.mouse.click(p2.x, p2.y);
  await page.keyboard.press('l');
  await expect.poll(() => obj<boolean>(page, 'Score sheet', 'o.locked')).toBe(true);
  await switchMode(page, 'play');
  await drag(page, p2, 80, 30);
  expect(await obj(page, 'Score sheet', 'o.position')).toEqual(moved);
});

test('dice: click selects and drags without rolling; roll and set value from the action bar', async ({ page }) => {
  await addSampleAndPlay(page);
  const die = await objectScreenPos(page, 'White die 1');
  await page.mouse.click(die.x, die.y);
  await page.waitForTimeout(500); // longer than the double-click window
  expect(await obj(page, 'White die 1', 'o.rollCount')).toBe(0);
  await drag(page, die, 60, 40);
  expect(await obj(page, 'White die 1', 'o.rollCount')).toBe(0);
  expect(await storeState(page, '(s) => s.selectedId')).toBe(await obj(page, 'White die 1', 'o.id'));

  const bar = page.getByRole('toolbar', { name: 'White die 1 actions' });
  // Dragging never opens the action bar; a plain click does.
  await expect(bar).toHaveCount(0);
  const moved = await objectScreenPos(page, 'White die 1');
  await page.mouse.click(moved.x, moved.y);
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: /Choose die face/ }).click();
  const faces = page.getByRole('dialog', { name: 'Choose the face of White die 1' });
  await expect(faces.getByRole('list', { name: 'Faces' }).getByRole('button')).toHaveCount(6);
  // A standard d6 shows its pips; the current face is marked.
  await expect(faces.getByRole('button', { name: '5. 5' }).locator('.die-picker-pip')).toHaveCount(5);
  await expect(faces.locator('[aria-current="true"]')).toHaveCount(1);
  await faces.getByRole('button', { name: '5. 5' }).click();
  await expect(faces).toHaveCount(0);
  await expect.poll(() => obj<number>(page, 'White die 1', 'o.value')).toBe(5);
  await expect(bar.getByTestId('die-face')).toHaveText('5');
  await bar.getByRole('button', { name: 'Roll' }).click();
  await expect.poll(() => obj<number>(page, 'White die 1', 'o.rollCount')).toBe(1);
  await page.waitForTimeout(500);
  const p = await objectScreenPos(page, 'White die 1');
  await page.mouse.dblclick(p.x, p.y);
  await expect.poll(() => obj<number>(page, 'White die 1', 'o.rollCount')).toBe(2);
});

test('deck: face-down drawing is configurable; shuffle/draw persist; counter persists', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await addSampleAndPlay(page);
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  await page.mouse.click(deckPos.x, deckPos.y);
  const bar = page.getByRole('toolbar', { name: 'Bonus deck actions' });
  await expect(bar.getByTestId('deck-count')).toHaveText('12 / 12');
  // A left click quickly followed by a right click must not count as a double-click (which would flip the top card).
  await page.mouse.click(deckPos.x, deckPos.y, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Bonus deck menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await obj(page, 'Bonus deck', 'o.cards.length')).toBe(12);
  // How cards come out is set up in Edit mode; Play mode only offers game actions.
  await page.mouse.click(deckPos.x, deckPos.y);
  await expect(bar.getByRole('button', { name: 'Shuffle' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Draws face up' })).toHaveCount(0);
  await page.waitForTimeout(500); // longer than the double-click window
  await switchMode(page, 'edit');
  await page.mouse.click(deckPos.x, deckPos.y);
  await bar.getByRole('button', { name: 'Draws face up' }).click();
  await expect(bar.getByRole('button', { name: 'Draws face down' })).toBeVisible();
  await switchMode(page, 'play');
  await page.waitForTimeout(500);
  await page.mouse.click(deckPos.x, deckPos.y);
  await bar.getByRole('button', { name: 'Shuffle' }).click();
  const order = await obj<string[]>(page, 'Bonus deck', 'o.cards.map(c => c.id)');
  await bar.getByRole('button', { name: 'Draw a card' }).click();
  await expect(bar.getByTestId('deck-count')).toHaveText('11 / 12');
  const drawn = await storeState<{ faceUp: boolean; cardDefId: string }>(
    page,
    "(s) => s.history.present.objects.find(o => o.kind === 'card')",
  );
  expect(drawn).toMatchObject({ faceUp: false, cardDefId: order[0] });

  // Drag out of the deck to draw a second card.
  await drag(page, deckPos, -150, 220);
  await expect.poll(() => storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'card').length")).toBe(2);

  const counter = await objectScreenPos(page, 'Round');
  await page.mouse.click(counter.x, counter.y);
  const cbar = page.getByRole('toolbar', { name: 'Round actions' });
  await cbar.getByRole('button', { name: 'Increase' }).click();
  await cbar.getByRole('button', { name: 'Increase' }).click();
  await expect(cbar.getByTestId('counter-value')).toHaveValue('3');

  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await expect.poll(() => obj(page, 'Bonus deck', 'o.cards.map(c => c.id)')).toEqual(order.slice(2));
  expect(await obj(page, 'Bonus deck', 'o.drawSide')).toBe('faceDown');
  expect(await obj(page, 'Round', 'o.value')).toBe(3);
  expect(errors).toEqual([]);
});

test('dragging a card over another card highlights it; dropping makes a pile; Shift+drop places freely', async ({ page }) => {
  await addSampleAndPlay(page);
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  await page.mouse.click(deckPos.x, deckPos.y);
  const bar = page.getByRole('toolbar', { name: 'Bonus deck actions' });
  await bar.getByRole('button', { name: 'Draw a card' }).click();
  await bar.getByRole('button', { name: 'Draw a card' }).click();
  // Both cards were drawn to the same spot; move the top one away freely first.
  const cards = await storeState<{ id: string; name: string }[]>(
    page,
    "(s) => s.history.present.objects.filter(o => o.kind === 'card').map(o => ({ id: o.id, name: o.name }))",
  );
  expect(cards).toHaveLength(2);
  const [bottom, top] = cards;
  await drag(page, await objectScreenPos(page, top.name), 0, 260, { shift: true });
  expect(await storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'card').length")).toBe(2);

  // Now drag it back over the other card and check the hover highlight before releasing.
  const from = await objectScreenPos(page, top.name);
  const to = await objectScreenPos(page, bottom.name);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x + 4, to.y + 4, { steps: 5 });
  await expect.poll(() => storeState(page, '(s) => s.dropTargetId')).toBe(bottom.id);
  await page.mouse.up();
  await expect.poll(() => storeState(page, '(s) => s.dropTargetId')).toBe(null);
  const pile = await storeState<{ isPile: boolean; n: number } | undefined>(
    page,
    "(s) => { const p = s.history.present.objects.find(o => o.kind === 'deck' && o.isPile); return p && { isPile: p.isPile, n: p.cards.length }; }",
  );
  expect(pile).toEqual({ isPile: true, n: 2 });
});

test('writing: pen aligns after zoom, erase/undo/redo, typed numbers persist', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await addSampleAndPlay(page);
  const box = (await page.getByTestId('table-canvas').boundingBox())!;

  const anchor = { x: box.x + 600, y: box.y + 350 };
  await page.mouse.move(anchor.x, anchor.y);
  const c0 = await storeState<{ x: number; y: number; scale: number }>(page, '(s) => s.camera');
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -250);
  const c1 = await storeState<{ x: number; y: number; scale: number }>(page, '(s) => s.camera');
  expect(c1.scale).toBeGreaterThan(c0.scale);
  expect((600 - c1.x) / c1.scale).toBeCloseTo((600 - c0.x) / c0.scale, 3);
  expect((350 - c1.y) / c1.scale).toBeCloseTo((350 - c0.y) / c0.scale, 3);

  await page.getByRole('button', { name: 'Pen (P)' }).click();
  await page.mouse.move(box.x + 580, box.y + 340);
  await page.mouse.down();
  await page.mouse.move(box.x + 640, box.y + 380, { steps: 8 });
  await page.mouse.up();
  const stroke = await storeState<{ points: number[] }>(page, '(s) => s.history.present.annotations.strokes.at(-1)');
  expect(stroke.points[0]).toBeCloseTo((580 - c1.x) / c1.scale, 1);
  expect(stroke.points[1]).toBeCloseTo((340 - c1.y) / c1.scale, 1);

  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 250);
  expect(await storeState(page, '(s) => s.history.present.annotations.strokes.at(-1).points')).toEqual(stroke.points);

  await page.getByRole('button', { name: 'Eraser (E)' }).click();
  const sp = await worldToPage(page, stroke.points[0], stroke.points[1]);
  await page.mouse.move(sp.x, sp.y);
  await page.mouse.down();
  await page.mouse.move(sp.x + 2, sp.y + 2);
  await page.mouse.up();
  await expect.poll(() => storeState<number>(page, '(s) => s.history.present.annotations.strokes.length')).toBe(0);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect.poll(() => storeState<number>(page, '(s) => s.history.present.annotations.strokes.length')).toBe(1);
  await page.keyboard.press('Control+Shift+Z');
  await expect.poll(() => storeState<number>(page, '(s) => s.history.present.annotations.strokes.length')).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => storeState<number>(page, '(s) => s.history.present.annotations.strokes.length')).toBe(1);

  await page.getByRole('button', { name: 'Text (T)' }).click();
  await page.mouse.click(box.x + 700, box.y + 420);
  await expect(page.getByLabel('Annotation text')).toBeFocused();
  await page.keyboard.type('37');
  await page.keyboard.press('Enter');
  await expect.poll(() => storeState<number>(page, '(s) => s.history.present.annotations.text.length')).toBe(1);
  const text = await storeState<{ text: string; position: { x: number; y: number } }>(page, '(s) => s.history.present.annotations.text[0]');
  expect(text.text).toBe('37');

  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await expect
    .poll(() => storeState(page, '(s) => s.history.present.annotations.text[0]'))
    .toMatchObject({ text: '37', position: text.position });
  expect(await storeState(page, '(s) => s.history.present.annotations.strokes.length')).toBe(1);
  expect(errors).toEqual([]);
});

test('interface can be collapsed and hidden', async ({ page }) => {
  await addSampleAndPlay(page);
  await page.getByRole('button', { name: 'Collapse tools' }).click();
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toHaveCount(0);
  await page.getByRole('button', { name: /Show tools/ }).click();
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible();

  await page.keyboard.press('u');
  await expect(page.getByRole('button', { name: 'Back to library' })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show interface (U)' }).click();
  await expect(page.getByRole('button', { name: 'Back to library' })).toBeVisible();
});

test('duplicate game, modify duplicate, original unchanged; the library shows created and last played dates', async ({ page }) => {
  await page.getByRole('button', { name: 'Add sample game' }).click();
  await expect(page.getByText('Solo Virtual Tabletop')).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByTestId('game-card')).toHaveCount(2);
  const original = page.getByTestId('game-card').filter({ hasNotText: '(copy)' });
  const copy = page.getByTestId('game-card').filter({ hasText: '(copy)' });
  await expect(copy).toContainText('Created');
  await expect(copy).toContainText('Last played');
  await expect(copy).toContainText('Never');
  await expect(copy).not.toContainText('objects');
  await copy.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Token' }).click();
  await waitSaved(page);
  await page.getByRole('button', { name: 'Back to library' }).click();
  const counts = await page.evaluate(async () => {
    const req = indexedDB.open('tablenox');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const games: { title: string; objects: unknown[] }[] = await new Promise((r) => {
      const q = db.transaction('games').objectStore('games').getAll();
      q.onsuccess = () => r(q.result);
    });
    db.close();
    return Object.fromEntries(games.map((g) => [g.title.includes('(copy)') ? 'copy' : 'original', g.objects.length]));
  });
  expect(counts).toEqual({ original: 8, copy: 9 });
  // Editing isn't playing; opening a game in Play mode is.
  await expect(copy).toContainText('Never');
  await original.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Back to library' }).click();
  await expect(original).not.toContainText('Never');
  await expect(copy).toContainText('Never');
});

test('library: search games, sort them, and switch between grid and list view (remembered)', async ({ page }) => {
  await page.getByRole('button', { name: 'Add sample game' }).click();
  await expect(page.getByTestId('game-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByTestId('game-card')).toHaveCount(2);

  const search = page.getByRole('searchbox', { name: 'Search games' });
  await search.fill('COPY');
  await expect(page.getByTestId('game-card')).toHaveCount(1);
  await expect(page.getByTestId('game-card')).toContainText('(copy)');
  await search.fill('chess');
  await expect(page.getByTestId('game-card')).toHaveCount(0);
  await expect(page.getByText('No games match “chess”.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByTestId('game-card')).toHaveCount(2);

  // Sort by name: the original ("Sample: …") comes before its copy ("Sample: … (copy)").
  await page.getByRole('combobox', { name: 'Sort games' }).selectOption('name');
  await expect(page.getByTestId('game-card').first()).not.toContainText('(copy)');

  const list = page.getByRole('list', { name: 'Games' });
  await expect(list).not.toHaveClass(/is-list/);
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(list).toHaveClass(/is-list/);
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('list', { name: 'Games' })).toHaveClass(/is-list/);
  await expect(page.getByRole('combobox', { name: 'Sort games' })).toHaveValue('name');
  await page.getByRole('button', { name: 'Grid view' }).click();
  await expect(page.getByRole('list', { name: 'Games' })).not.toHaveClass(/is-list/);
});

test('export, clear data, import restores board and cards with images', async ({ page }) => {
  await newGame(page, 'Portable Game');
  await page
    .getByTestId('add-board-input')
    .setInputFiles({ name: 'board.png', mimeType: 'image/png', buffer: await makePng(page, 640, 480, 'Portable') });
  await expect.poll(() => storeState<number>(page, '(s) => s.history.present.objects.length')).toBe(1);
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Deck' }).click();
  await page.getByRole('button', { name: 'Properties panel' }).click();
  await page.getByTestId('deck-add-images').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: await makePng(page, 120, 170, 'A') },
    { name: 'b.png', mimeType: 'image/png', buffer: await makePng(page, 120, 170, 'B') },
  ]);
  await expect
    .poll(() => storeState<number>(page, "(s) => s.history.present.objects.find(o => o.kind === 'deck').initialCards.length"))
    .toBe(54);
  await waitSaved(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: /Export game/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Portable-Game.tablenox.zip');
  const path = await download.path();

  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('tablenox');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await expect(page.getByTestId('game-card')).toHaveCount(0);

  await page.getByTestId('import-input').setInputFiles(path!);
  await expect(page.getByTestId('game-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await expect.poll(() => storeState<number>(page, '(s) => s.history.present.objects.length')).toBe(2);

  const sizes = await page.evaluate(async () => {
    const s = (
      window as unknown as { __tablenoxStore: { getState(): { history: { present: { objects: Array<Record<string, unknown>> } } } } }
    ).__tablenoxStore.getState();
    const board = s.history.present.objects.find((o) => o.kind === 'board') as { assetId: string };
    const deck = s.history.present.objects.find((o) => o.kind === 'deck') as { initialCards: { faceAssetId?: string }[] };
    const req = indexedDB.open('tablenox');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const get = (id: string) =>
      new Promise<{ blob: Blob } | undefined>((r) => {
        const q = db.transaction('assets').objectStore('assets').get(id);
        q.onsuccess = () => r(q.result);
      });
    const ids = [board.assetId, ...deck.initialCards.filter((c) => c.faceAssetId).map((c) => c.faceAssetId!)];
    const out = await Promise.all(ids.map(async (id) => (await get(id))?.blob.size ?? 0));
    db.close();
    return out;
  });
  expect(sizes).toHaveLength(3);
  for (const size of sizes) expect(size).toBeGreaterThan(100);
});

test('storage write failure shows a visible warning and export route; retry recovers', async ({ page }) => {
  await addSampleAndPlay(page);
  await page.evaluate(() => {
    const w = window as unknown as { __origPut?: typeof IDBObjectStore.prototype.put };
    w.__origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('Simulated quota', 'QuotaExceededError');
    };
  });
  const counter = await objectScreenPos(page, 'Round');
  await page.mouse.click(counter.x, counter.y);
  await page.getByRole('toolbar', { name: 'Round actions' }).getByRole('button', { name: 'Increase' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Save failed' });
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(alert.getByRole('button', { name: 'Export' })).toBeVisible();
  expect(await obj(page, 'Round', 'o.value')).toBe(2);

  await page.evaluate(() => {
    const w = window as unknown as { __origPut?: typeof IDBObjectStore.prototype.put };
    IDBObjectStore.prototype.put = w.__origPut!;
  });
  await alert.getByRole('button', { name: 'Retry' }).click();
  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await expect.poll(() => obj<number>(page, 'Round', 'o.value')).toBe(2);
});

test('dragging the count badge lifts the whole stack out of the holder; the holder stays put (Play mode)', async ({ page }) => {
  await addSampleAndPlay(page);
  const before = await obj<{ x: number; y: number }>(page, 'Bonus deck', 'o.position');
  const box = (await page.getByTestId('table-canvas').boundingBox())!;
  const handleOf = (id: string) =>
    page.evaluate((id) => {
      type N = { findOne(s: string): N; getClientRect(): { x: number; y: number; width: number; height: number } };
      const stage = (window as unknown as { Konva: { stages: N[] } }).Konva.stages[0];
      const r = stage.findOne(`#${id}`).findOne('.deck-handle').getClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, id);
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  const handle = await handleOf(deckId);
  await drag(page, { x: box.x + handle.x, y: box.y + handle.y }, -160, 220);
  expect(await obj(page, 'Bonus deck', 'o.position')).toEqual(before);
  expect(await obj(page, 'Bonus deck', 'o.cards.length')).toBe(0);
  const pile = await storeState<{ id: string; cards: unknown[] }>(
    page,
    "(s) => s.history.present.objects.find(o => o.kind === 'deck' && o.isPile)",
  );
  expect(pile.cards).toHaveLength(12);
  expect(await storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'card').length")).toBe(0);

  // The pile's own badge moves the pile; dropped back on the holder, the cards return to it.
  const pileHandle = await handleOf(pile.id);
  const pilePos = await objectScreenPos(page, 'Pile');
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  await drag(page, { x: box.x + pileHandle.x, y: box.y + pileHandle.y }, deckPos.x - pilePos.x, deckPos.y - pilePos.y);
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(12);
  expect(await obj(page, 'Bonus deck', 'o.position')).toEqual(before);
});

test('holders fade under dragged objects; dragging never opens the action bar; face-up cards stay face up in a face-down deck', async ({
  page,
}) => {
  await addSampleAndPlay(page);
  const discardId = await obj<string>(page, 'Discard', 'o.id');
  const from = await objectScreenPos(page, 'Marker');
  const to = await objectScreenPos(page, 'Discard');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await expect.poll(() => storeState(page, '(s) => s.dropTargetId')).toBe(discardId);
  await expect(page.locator('.selection-bar')).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(() => storeState(page, '(s) => s.dropTargetId')).toBe(null);
  expect(await storeState(page, '(s) => s.selectedId')).toBe(await obj(page, 'Marker', 'o.id'));
  await expect(page.locator('.selection-bar')).toHaveCount(0);
  const marker = await objectScreenPos(page, 'Marker');
  await page.mouse.click(marker.x, marker.y);
  await expect(page.getByRole('toolbar', { name: 'Marker actions' })).toBeVisible();

  // Draw a face-up card, switch the deck to face-down drawing, and put the card back on the (non-empty) deck.
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  await page.mouse.click(deckPos.x, deckPos.y);
  const bar = page.getByRole('toolbar', { name: 'Bonus deck actions' });
  await bar.getByRole('button', { name: 'Draw a card' }).click();
  await storeState(
    page,
    "(s) => s.dispatch({ type: 'UpdateObject', id: s.history.present.objects.find(o => o.name === 'Bonus deck').id, patch: { drawSide: 'faceDown' } })",
  );
  const card = await storeState<{ name: string; faceUp: boolean }>(page, "(s) => s.history.present.objects.find(o => o.kind === 'card')");
  expect(card.faceUp).toBe(true);
  const cardPos = await objectScreenPos(page, card.name);
  await drag(page, cardPos, deckPos.x - cardPos.x, deckPos.y - cardPos.y);
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(12);
  expect(await obj(page, 'Bonus deck', 'o.cards[0].faceUp')).toBe(true);
});

test('holder properties: card list with fronts then backs, the holder zone, then card size and dealing; a pile shows no back options', async ({
  page,
}) => {
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  await storeState(page, `(s) => { s.setUi({ inspectorOpen: true }); s.select(${JSON.stringify(deckId)}); }`);
  const panel = page.getByRole('complementary', { name: 'Properties' });
  const headings = panel.locator('.inspector-section h3');
  await expect(headings).toHaveText(['Card list (12 cards)', 'Holder', 'Cards (12 in the holder)', 'Object']);
  // The card list has a Fronts part (tools and the list) and, below it, a Backs part.
  const list = panel.locator('.inspector-section').nth(0);
  await expect(list.locator('h4')).toHaveText(['Fronts', 'Backs']);
  const fronts = list.getByRole('group', { name: 'Fronts' });
  const backs = list.getByRole('group', { name: 'Backs' });
  await expect(fronts.getByRole('button', { name: 'Hide card list' })).toBeVisible();
  for (const label of ['Card back colour', 'Card back image', 'Different back for every card']) {
    await expect(backs.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(backs.getByRole('button', { name: 'Use fronts as backs' })).toBeVisible();
  const cards = panel.locator('.inspector-section').nth(2);
  for (const label of ['Card width', 'Cards come out', 'Cards come in']) {
    await expect(cards.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(cards.getByText('Card back colour')).toHaveCount(0);
  await expect(panel.locator('.inspector-section').nth(1).getByText('Card back colour')).toHaveCount(0);
  // The zone's colours and outline are in the Object section, below the rotation angles.
  const object = panel.locator('.inspector-section').nth(3);
  for (const label of ['Holder colour', 'Holder opacity', 'Stroke colour', 'Stroke opacity', 'Stroke style']) {
    await expect(panel.locator('.inspector-section').nth(1).getByLabel(label)).toHaveCount(0);
    await expect(object.getByLabel(label)).toBeVisible();
  }
  const below = await object.evaluate((el) => {
    const texts = [...el.querySelectorAll('span, label')].map((n) => n.textContent ?? '');
    return texts.findIndex((t) => t.startsWith('Rotation angles')) < texts.findIndex((t) => t.startsWith('Holder colour'));
  });
  expect(below).toBe(true);
  // "Cards come in" face up: a card put into the holder lies face up.
  await cards.getByLabel('Cards come in').selectOption('faceUp');
  await expect.poll(() => obj<string>(page, 'Bonus deck', 'o.putSide')).toBe('faceUp');

  // Cards move up and down the list; the first can't move up, the last can't move down.
  const ids = await obj<string[]>(page, 'Bonus deck', 'o.initialCards.map(c => c.id)');
  await expect(panel.getByRole('button', { name: 'Move card 1 up' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Move card 12 down' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Move card 1 down' }).click();
  await expect.poll(() => obj<string[]>(page, 'Bonus deck', 'o.initialCards.map(c => c.id)')).toEqual([ids[1], ids[0], ...ids.slice(2)]);
  expect(await obj<string[]>(page, 'Bonus deck', 'o.cards.map(c => c.id)')).toEqual([ids[1], ids[0], ...ids.slice(2)]);
  await panel.getByRole('button', { name: 'Move card 2 up' }).click();
  await expect.poll(() => obj<string[]>(page, 'Bonus deck', 'o.initialCards.map(c => c.id)')).toEqual(ids);

  // Every card gets its front as its back.
  await backs.getByRole('button', { name: 'Use fronts as backs' }).click();
  await expect.poll(() => obj<boolean>(page, 'Bonus deck', 'o.individualBacks')).toBe(true);
  expect(await obj<boolean>(page, 'Bonus deck', 'o.initialCards.every(c => c.backColor === c.faceColor)')).toBe(true);
  await expect(backs.getByRole('checkbox', { name: 'Different back for every card' })).toBeChecked();

  // Rotation angles: cards follow the deck; only 0° and 180° means Rotate goes straight to 180°.
  const angles = panel.getByRole('group', { name: /Rotation angles/ });
  await expect(angles.getByRole('button', { pressed: true })).toHaveText(['0°', '90°', '180°', '270°']);
  await angles.getByRole('button', { name: 'Allow 90°' }).click();
  await angles.getByRole('button', { name: 'Allow 270°' }).click();
  await expect.poll(() => obj<number[]>(page, 'Bonus deck', 'o.rotations')).toEqual([0, 180]);

  await storeState(
    page,
    `(s) => s.dispatch({ type: 'TakeStack', deckId: ${JSON.stringify(deckId)}, pileId: 'pile-1', position: { x: 0, y: 900 } })`,
  );
  await storeState(page, "(s) => s.select('pile-1')");
  await expect(headings).toHaveText(['Pile (12 cards)', 'Object']);
  await expect(panel.getByText('Card back colour')).toHaveCount(0);
  await expect(panel.getByText('Card back image')).toHaveCount(0);
  await expect(panel.getByLabel('Cards come out')).toBeVisible();
  await expect(panel.getByLabel('Cards come in')).toHaveCount(0);
  await expect(panel.getByText('Holder colour')).toHaveCount(0);
  // The pile follows its deck's rotation angles: R turns it to 180°, then back to 0°.
  await expect(angles.getByRole('button', { pressed: true })).toHaveText(['0°', '180°']);
  await expect(panel.getByText('Same as its deck.')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('r');
  await expect.poll(() => storeState<number>(page, "(s) => s.history.present.objects.find(o => o.id === 'pile-1').rotation")).toBe(180);
  await page.keyboard.press('r');
  await expect.poll(() => storeState<number>(page, "(s) => s.history.present.objects.find(o => o.id === 'pile-1').rotation")).toBe(0);
  // Only one angle: no Rotate action and R does nothing.
  await storeState(page, "(s) => s.dispatch({ type: 'UpdateObject', id: 'pile-1', patch: { rotations: [0] } })");
  await expect(panel.getByText("Only one angle: it can't be rotated")).toBeVisible();
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  expect(await storeState<number>(page, "(s) => s.history.present.objects.find(o => o.id === 'pile-1').rotation")).toBe(0);

  // The pile points to its holder, and the button selects it.
  await panel.getByRole('button', { name: 'Go to Bonus deck' }).click();
  await expect.poll(() => storeState(page, '(s) => s.selectedId')).toBe(deckId);
  await expect(headings.first()).toHaveText('Card list (12 cards)');
});

test('tokens taken off a stack are recalled to it; piles and cards return to their holder (Play mode)', async ({ page }) => {
  await addSampleAndPlay(page);
  await storeState(
    page,
    "(s) => s.dispatch({ type: 'UpdateObject', id: s.history.present.objects.find(o => o.name === 'Marker').id, patch: { count: 5 } })",
  );
  const markerId = await obj<string>(page, 'Marker', 'o.id');
  const tokens = () =>
    storeState<{ id: string; count: number }[]>(
      page,
      "(s) => s.history.present.objects.filter(o => o.kind === 'token').map(o => ({ id: o.id, count: o.count ?? 1 }))",
    );
  const markerPos = await objectScreenPos(page, 'Marker');
  // Sideways: the marker sits near the bottom of the fitted view.
  await drag(page, markerPos, 120, 0);
  await expect.poll(async () => (await tokens()).length).toBe(2);
  await page.mouse.click(markerPos.x, markerPos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Marker menu' }).getByRole('menuitem', { name: 'Take a token' }).click();
  await expect.poll(async () => (await tokens()).length).toBe(3);
  await page.mouse.click(markerPos.x, markerPos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Marker menu' }).getByRole('menuitem', { name: 'Recall all tokens' }).click();
  await expect.poll(tokens).toEqual([{ id: markerId, count: 5 }]);

  // A drawn card goes back to its holder; so does a pile.
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  await page.mouse.click(deckPos.x, deckPos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Bonus deck menu' }).getByRole('menuitem', { name: 'Draw cards from top…' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('3');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /OK|Confirm|Draw/ })
    .click();
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(9);
  const pile = await storeState<{ name: string }>(page, "(s) => s.history.present.objects.find(o => o.kind === 'deck' && o.isPile)");
  const pilePos = await objectScreenPos(page, pile.name);
  await page.mouse.click(pilePos.x, pilePos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Pile menu' }).getByRole('menuitem', { name: 'Return cards to their holders' }).click();
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(12);
  expect(await storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'deck' && o.isPile).length")).toBe(0);

  await page.mouse.click(deckPos.x, deckPos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Bonus deck menu' }).getByRole('menuitem', { name: 'Draw a card' }).click();
  const card = await storeState<{ name: string }>(page, "(s) => s.history.present.objects.find(o => o.kind === 'card')");
  const cardPos = await objectScreenPos(page, card.name);
  await page.mouse.click(cardPos.x, cardPos.y, { button: 'right' });
  await page
    .getByRole('menu', { name: `${card.name} menu` })
    .getByRole('menuitem', { name: 'Return to holder' })
    .click();
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(12);
});

test('bags: drop pieces in, draw by dragging or menu, shuffle, recall; automation fills and empties a bag', async ({ page }) => {
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Bag' }).click();
  const bagId = await storeState<string>(page, "(s) => s.history.present.objects.find(o => o.kind === 'bag').id");
  const bagCount = () => storeState<number>(page, "(s) => s.history.present.objects.find(o => o.kind === 'bag').items.length");
  // New bags have no name; the menu and action bar call it "Bag". Park it in a free spot at the right of the sheet.
  expect(await storeState(page, "(s) => s.history.present.objects.find(o => o.kind === 'bag').name")).toBe('');
  await storeState(page, `(s) => s.dispatch({ type: 'MoveObject', id: ${JSON.stringify(bagId)}, position: { x: 900, y: 200 } })`);
  await switchMode(page, 'play');

  // Drop a die and a token into the bag.
  const bagPos = await worldToPage(page, 960, 265);
  for (const name of ['White die 1', 'Marker']) {
    const from = await objectScreenPos(page, name);
    await drag(page, from, bagPos.x - from.x, bagPos.y - from.y);
  }
  await expect.poll(bagCount).toBe(2);
  expect(
    await storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.name === 'Marker' || o.name === 'White die 1').length"),
  ).toBe(0);

  // Dragging from the bag draws a piece; its menu draws and recalls.
  await drag(page, bagPos, 0, -250);
  await expect.poll(bagCount).toBe(1);
  await page.mouse.click(bagPos.x, bagPos.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Bag menu' });
  await expect(menu.getByRole('menuitem', { name: 'Recall everything to the bag' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Draw a random piece' }).click();
  await expect.poll(bagCount).toBe(0);
  await page.mouse.click(bagPos.x, bagPos.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Recall everything to the bag' }).click();
  await expect.poll(bagCount).toBe(2);

  // Automation: a button that shuffles the bag and moves one piece to the Discard holder, another recalls.
  await storeState(
    page,
    `(s) => {
      const objs = s.history.present.objects;
      const discard = objs.find(o => o.name === 'Discard');
      const bag = objs.find(o => o.kind === 'bag');
      const step = (type, extra) => ({ id: 'st-' + type, objectIds: [bag.id], type, ...extra });
      s.dispatch({ type: 'AddObject', object: { id: 'btn-1', kind: 'button', name: 'Go', position: { x: 900, y: 500 }, width: 150, height: 52,
        rotation: 0, zIndex: 99, locked: false, visible: true, label: 'Go', color: '#3f8fd8', textColor: '#ffffff',
        steps: [step('shuffle'), { ...step('move'), id: 'st-move', targetIds: [discard.id], deckMode: 'top', count: 1, orientation: 'keep' }] } });
    }`,
  );
  const go = await clickObject(page, 'Go');
  await expect.poll(bagCount).toBe(1);
  await storeState(
    page,
    `(s) => s.dispatch({ type: 'UpdateObject', id: 'btn-1', patch: { steps: [{ id: 'st-r', type: 'recall', objectIds: [s.history.present.objects.find(o => o.kind === 'bag').id] }] } })`,
  );
  await page.mouse.click(go.x, go.y);
  await expect.poll(bagCount).toBe(2);
});

test('image thumbnails in the properties panel; pick a card from a deck by its face; token stacks', async ({ page }) => {
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  await storeState(page, `(s) => { s.setUi({ inspectorOpen: true }); s.select(${JSON.stringify(deckId)}); }`);
  const panel = page.getByRole('complementary', { name: 'Properties' });

  // Cards added from images show their face as a thumbnail in the card list; so does the card back image field.
  await page.getByTestId('deck-add-images').setInputFiles([
    { name: 'sun.png', mimeType: 'image/png', buffer: await makePng(page, 120, 170, 'S') },
    { name: 'moon.png', mimeType: 'image/png', buffer: await makePng(page, 120, 170, 'M') },
  ]);
  await expect(panel.getByRole('img', { name: 'Face of card 13' })).toBeVisible();
  await expect(panel.getByRole('img', { name: 'Face of card 14' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Replace face image for card 14' }).getByTestId('asset-thumb')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Upload face image for card 1' }).getByTestId('asset-thumb')).toHaveCount(0);
  await panel
    .locator('.field', { hasText: 'Card back image' })
    .locator('input[type=file]')
    .setInputFiles({ name: 'back.png', mimeType: 'image/png', buffer: await makePng(page, 120, 170, 'B') });
  await expect(panel.getByRole('img', { name: 'Card back image preview' })).toBeVisible();
  // The thumbnail really shows the image (it was drawn onto the canvas).
  const drawn = await panel.getByRole('img', { name: 'Face of card 13' }).evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    return d.some((v, i) => i % 4 === 3 && v > 0);
  });
  expect(drawn).toBe(true);
  // Resting the mouse on a thumbnail shows an enlarged copy of the image; moving away hides it.
  const faceThumb = panel.getByRole('img', { name: 'Face of card 14' });
  await faceThumb.hover();
  const zoom = page.getByTestId('asset-zoom');
  await expect(zoom).toBeVisible();
  const thumbBox = (await faceThumb.boundingBox())!;
  const zoomBox = (await zoom.boundingBox())!;
  expect(zoomBox.height).toBeGreaterThan(thumbBox.height * 4);
  await page.mouse.move(5, 5);
  await expect(zoom).toHaveCount(0);

  // Make the Marker a stack of 5 tokens.
  const markerId = await obj<string>(page, 'Marker', 'o.id');
  await storeState(page, `(s) => s.select(${JSON.stringify(markerId)})`);
  const stackField = panel.getByLabel('Tokens in stack');
  await stackField.fill('5');
  await stackField.press('Enter');
  await expect.poll(() => obj<number>(page, 'Marker', 'o.count')).toBe(5);
  await switchMode(page, 'play');

  // Pick card(s): every face is shown (or every back), and the picked card is drawn next to the deck.
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  await page.mouse.click(deckPos.x, deckPos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Bonus deck menu' }).getByRole('menuitem', { name: 'Pick card(s)…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Pick card(s) from Bonus deck' });
  await expect(dialog.getByRole('list', { name: 'Cards' }).getByRole('button')).toHaveCount(14);
  const moonButton = dialog.getByRole('button', { name: '14. moon' });
  await expect(moonButton.getByTestId('asset-thumb')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '1. Card 1' }).getByTestId('asset-thumb')).toHaveCount(0);
  // Backs: the card back image uploaded above shows on every card.
  await dialog.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Backs' }).click();
  await expect(dialog.getByRole('button', { name: '1. Card 1', exact: true }).getByRole('img', { name: 'Back of Card 1' })).toBeVisible();
  await dialog.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Fronts' }).click();
  const moonId = await obj<string>(page, 'Bonus deck', "o.cards.find(c => c.name === 'moon').id");
  await moonButton.click();
  await expect(moonButton).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Take 1 card' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(13);
  const picked = await storeState<{ cardDefId: string; position: { x: number; y: number } }>(
    page,
    "(s) => s.history.present.objects.find(o => o.kind === 'card')",
  );
  const deck = await obj<{ x: number; y: number; w: number }>(page, 'Bonus deck', '({ x: o.position.x, y: o.position.y, w: o.width })');
  expect(picked.cardDefId).toBe(moonId);
  expect(picked.position).toEqual({ x: deck.x + deck.w + 24, y: deck.y });
  // Sort from the menu: reverse turns the order around.
  const order = await obj<string[]>(page, 'Bonus deck', 'o.cards.map(c => c.id)');
  await page.mouse.click(deckPos.x, deckPos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Bonus deck menu' }).getByRole('menuitem', { name: 'Reverse the order' }).click();
  await expect.poll(() => obj<string[]>(page, 'Bonus deck', 'o.cards.map(c => c.id)')).toEqual([...order].reverse());
  // Several picked cards come out as one pile.
  await page.mouse.click(deckPos.x, deckPos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Bonus deck menu' }).getByRole('menuitem', { name: 'Pick card(s)…' }).click();
  await dialog.getByRole('button', { name: /^1\. / }).click();
  await dialog.getByRole('button', { name: /^3\. / }).click();
  await dialog.getByRole('button', { name: 'Take 2 cards' }).click();
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(11);
  expect(
    await storeState<string[]>(page, "(s) => s.history.present.objects.find(o => o.kind === 'deck' && o.isPile).cards.map(c => c.id)"),
  ).toEqual([order[order.length - 1], order[order.length - 3]]);

  // Token stack: dragging takes one token off; dropping it back stacks it again; the badge moves the whole stack.
  const tokens = () =>
    storeState<{ id: string; count: number }[]>(
      page,
      "(s) => s.history.present.objects.filter(o => o.kind === 'token').map(o => ({ id: o.id, count: o.count ?? 1 }))",
    );
  const markerPos = await objectScreenPos(page, 'Marker');
  const markerBefore = await obj(page, 'Marker', 'o.position');
  // Sideways: the marker sits near the bottom of the fitted view.
  await drag(page, markerPos, 120, 0);
  await expect.poll(tokens).toHaveLength(2);
  expect((await tokens()).find((t) => t.id === markerId)?.count).toBe(4);
  const single = (await tokens()).find((t) => t.id !== markerId)!;
  expect(single.count).toBe(1);
  expect(await storeState(page, `(s) => s.history.present.objects.find(o => o.id === ${JSON.stringify(markerId)}).position`)).toEqual(
    markerBefore,
  );
  await drag(page, { x: markerPos.x + 120, y: markerPos.y }, -120, 0);
  await expect.poll(tokens).toEqual([{ id: markerId, count: 5 }]);

  await page.mouse.click(markerPos.x, markerPos.y);
  await expect(page.getByRole('toolbar', { name: 'Marker actions' }).getByTestId('token-count')).toHaveText('5');
  await page.getByRole('toolbar', { name: 'Marker actions' }).getByRole('button', { name: 'Take a token' }).click();
  await expect.poll(tokens).toHaveLength(2);
  await page.waitForTimeout(500);
  await drag(page, markerPos, 150, 0, { shift: true });
  await expect.poll(() => obj<{ x: number }>(page, 'Marker', 'o.position')).not.toEqual(markerBefore);
  expect((await tokens()).find((t) => t.id === markerId)?.count).toBe(4);
});

test('double-click flips the top card in place; drawing several cards makes one pile; a spread shows where a dropped card goes', async ({
  page,
}) => {
  await addSampleAndPlay(page);
  const cardsOnTable = () => storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'card').length");
  const piles = () =>
    storeState<{ id: string; n: number }[]>(
      page,
      "(s) => s.history.present.objects.filter(o => o.kind === 'deck' && o.isPile).map(o => ({ id: o.id, n: o.cards.length }))",
    );

  // Double-clicking the deck turns its top card over without drawing it.
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  const topId = await obj<string>(page, 'Bonus deck', 'o.cards[0].id');
  expect(await obj(page, 'Bonus deck', 'o.cards[0].faceUp ?? false')).toBe(false);
  await page.mouse.dblclick(deckPos.x, deckPos.y);
  await expect.poll(() => obj(page, 'Bonus deck', 'o.cards[0].faceUp')).toBe(true);
  expect(await obj(page, 'Bonus deck', 'o.cards[0].id')).toBe(topId);
  expect(await obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(12);
  expect(await cardsOnTable()).toBe(0);
  await page.waitForTimeout(500);

  // Draw 5 cards from the top: they come out as one pile, not spread in a row.
  await page.mouse.click(deckPos.x, deckPos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Bonus deck menu' }).getByRole('menuitem', { name: 'Draw cards from top…' }).click();
  await page.getByLabel(/^Number of cards/).fill('5');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect.poll(piles).toEqual([expect.objectContaining({ n: 5 })]);
  expect(await cardsOnTable()).toBe(0);
  expect(await obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(7);

  // Put the pile into the Discard holder and spread it out.
  const discardId = await obj<string>(page, 'Discard', 'o.id');
  await storeState(
    page,
    `(s) => s.dispatch({ type: 'MergePileIntoDeck', pileId: s.history.present.objects.find(o => o.isPile).id, deckId: ${JSON.stringify(discardId)} })`,
  );
  await storeState(
    page,
    `(s) => s.dispatch({ type: 'UpdateObject', id: ${JSON.stringify(discardId)}, patch: { layout: 'spread', width: 420 } })`,
  );
  await expect.poll(() => obj<number>(page, 'Discard', 'o.cards.length')).toBe(5);
  const order = await obj<string[]>(page, 'Discard', 'o.cards.map(c => c.id)');

  // Drag the right-most (top) card to the far left of the spread: a gap opens there, and it lands at the bottom.
  const box = (await page.getByTestId('table-canvas').boundingBox())!;
  const slotCenter = (index: number) =>
    page.evaluate(
      ({ id, index }) => {
        type N = { findOne(s: string): N; find(s: string): N[]; getClientRect(): { x: number; y: number; width: number; height: number } };
        const stage = (window as unknown as { Konva: { stages: N[] } }).Konva.stages[0];
        const r = stage.findOne(`#${id}`).find('.deck-card')[index].getClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      { id: discardId, index },
    );
  const right = await slotCenter(4);
  const left = await slotCenter(0);
  const from = { x: box.x + right.x, y: box.y + right.y };
  const to = { x: box.x + left.x - 40, y: box.y + left.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 30, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect.poll(() => storeState(page, '(s) => s.dropTargetId')).toBe(discardId);
  expect(await storeState(page, '(s) => s.dropIndex')).toBe(4);
  const gaps = await page.evaluate(
    (id) =>
      (window as unknown as { Konva: { stages: { findOne(s: string): { find(s: string): unknown[] } }[] } }).Konva.stages[0]
        .findOne(`#${id}`)
        .find('.drop-gap').length,
    discardId,
  );
  expect(gaps).toBe(1);
  await page.mouse.up();
  await expect.poll(() => obj<string[]>(page, 'Discard', 'o.cards.map(c => c.id)')).toEqual([...order.slice(1), order[0]]);
  expect(await storeState(page, '(s) => s.dropIndex')).toBe(null);
});

test('dragged objects look lifted; a pile dropped on a holder joins it; cards are dragged out of holders; S shuffles', async ({ page }) => {
  await addSampleAndPlay(page);
  const box = (await page.getByTestId('table-canvas').boundingBox())!;
  type K = {
    stages: Array<{
      findOne(s: string): {
        rotation(): number;
        scaleX(): number;
        findOne(s: string): { getClientRect(): { x: number; y: number; width: number; height: number } } | undefined;
      };
    }>;
  };
  const liftOf = (id: string) =>
    page.evaluate((id) => {
      const stage = (window as unknown as { Konva: K }).Konva.stages[0];
      const lift = stage.findOne(`#${id}`).findOne('.lift') as unknown as { rotation(): number; scaleX(): number };
      return { rotation: lift.rotation(), scale: lift.scaleX() };
    }, id);
  const handleOf = async (id: string) => {
    const r = await page.evaluate((id) => {
      const stage = (window as unknown as { Konva: K }).Konva.stages[0];
      return stage.findOne(`#${id}`).findOne('.deck-handle')!.getClientRect();
    }, id);
    return { x: box.x + r.x + r.width / 2, y: box.y + r.y + r.height / 2 };
  };

  // Draw two cards and stack one on the other to make a pile.
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  await page.mouse.click(deckPos.x, deckPos.y);
  const bar = page.getByRole('toolbar', { name: 'Bonus deck actions' });
  await bar.getByRole('button', { name: 'Draw a card' }).click();
  const first = await storeState<{ id: string; name: string }>(page, "(s) => s.history.present.objects.find(o => o.kind === 'card')");
  await drag(page, await objectScreenPos(page, first.name), 0, 240, { shift: true });

  // Lifted look while dragging, back to normal after the drop.
  const second = await objectScreenPos(page, first.name);
  await page.waitForTimeout(500); // longer than the double-click window, so the next deck click doesn't draw
  await page.mouse.click(deckPos.x, deckPos.y);
  await bar.getByRole('button', { name: 'Draw a card' }).click();
  const top = await storeState<{ id: string; name: string }>(
    page,
    `(s) => s.history.present.objects.find(o => o.kind === 'card' && o.id !== ${JSON.stringify(first.id)})`,
  );
  const from = await objectScreenPos(page, top.name);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + second.x) / 2, (from.y + second.y) / 2, { steps: 4 });
  await page.mouse.move(second.x + 3, second.y + 3, { steps: 4 });
  await expect.poll(async () => (await liftOf(top.id)).rotation).toBeGreaterThan(2);
  expect((await liftOf(top.id)).scale).toBeGreaterThan(1);
  await page.mouse.up();
  const pileId = await storeState<string>(page, "(s) => s.history.present.objects.find(o => o.kind === 'deck' && o.isPile).id");
  expect(
    await storeState<number>(page, `(s) => s.history.present.objects.find(o => o.id === ${JSON.stringify(pileId)}).cards.length`),
  ).toBe(2);

  // Drag the pile (by its count badge) onto the holder: its cards go into the holder and the pile is gone.
  const discard = await objectScreenPos(page, 'Discard');
  const discardId = await obj<string>(page, 'Discard', 'o.id');
  const handle = await handleOf(pileId);
  const pileCenter = await objectScreenPos(page, 'Pile');
  await drag(page, handle, discard.x - pileCenter.x + 23, discard.y - pileCenter.y - 17);
  await expect.poll(() => obj<number>(page, 'Discard', 'o.cards.length')).toBe(2);
  expect(await storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'deck' && o.isPile).length")).toBe(0);
  // The holder itself stayed where it was.
  expect(await objectScreenPos(page, 'Discard')).toEqual(discard);

  // Drag the holder's top card onto the deck: the deck highlights while hovering, and the card goes on top.
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  await page.mouse.move(discard.x, discard.y);
  await page.mouse.down();
  await page.mouse.move((discard.x + deckPos.x) / 2, (discard.y + deckPos.y) / 2, { steps: 4 });
  await page.mouse.move(deckPos.x, deckPos.y, { steps: 4 });
  await expect.poll(() => storeState(page, '(s) => s.dropTargetId')).toBe(deckId);
  await page.mouse.up();
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(11);
  expect(await obj<number>(page, 'Discard', 'o.cards.length')).toBe(1);
  expect(await storeState(page, '(s) => s.dropTargetId')).toBe(null);
  expect(discardId).toBeTruthy();

  // S shuffles the selected deck.
  const order = await obj<string[]>(page, 'Bonus deck', 'o.cards.map(c => c.id)');
  await page.mouse.click(deckPos.x, deckPos.y);
  await page.keyboard.press('s');
  await expect.poll(() => obj<string[]>(page, 'Bonus deck', 'o.cards.map(c => c.id)')).not.toEqual(order);
  expect(await storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'card').length")).toBe(0);
});

test('zoom on hover is set per object, with a size', async ({ page }) => {
  await addSampleAndPlay(page);
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  await page.mouse.click(deckPos.x, deckPos.y);
  const bar = page.getByRole('toolbar', { name: 'Bonus deck actions' });
  await bar.getByRole('button', { name: 'Draw a card' }).click();
  await bar.getByRole('button', { name: 'Draw a card' }).click();
  const [follower, own] = await storeState<string[]>(
    page,
    "(s) => s.history.present.objects.filter(o => o.kind === 'card').map(o => o.name)",
  );
  // Both were drawn to the same spot: move the top one away.
  await drag(page, await objectScreenPos(page, own), 0, 260, { shift: true });
  const followerPos = await objectScreenPos(page, follower);

  await page.mouse.move(followerPos.x, followerPos.y);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('card-preview')).toHaveCount(0); // off by default
  await expect(page.getByRole('button', { name: /Card zoom on hover/ })).toHaveCount(0); // no global toggle
  // It is a setup option: Play-mode menus don't offer it.
  await page.mouse.click(deckPos.x, deckPos.y, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Bonus deck menu' })).toBeVisible();
  await expect(page.getByRole('menu', { name: 'Bonus deck menu' }).getByLabel('Zoom on hover')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // In Edit mode: the deck zooms large (its drawn cards follow), one card has its own size, and so does a token.
  await switchMode(page, 'edit');
  const setZoom = async (name: string, size: string) => {
    const p = await objectScreenPos(page, name);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page
      .getByRole('menu', { name: `${name} menu` })
      .getByLabel('Zoom on hover')
      .selectOption(size);
    await page.keyboard.press('Escape');
  };
  await setZoom('Bonus deck', 'large');
  await setZoom(own, 'small');
  await setZoom('Marker', 'medium');
  await switchMode(page, 'play');

  const preview = page.getByTestId('card-preview');
  const hover = async (name: string) => {
    await page.mouse.move(5, 5);
    await expect(preview).toHaveCount(0);
    const p = await objectScreenPos(page, name);
    await page.mouse.move(p.x + 3, p.y + 3, { steps: 3 });
  };
  await hover(follower);
  await expect(preview).toHaveAttribute('data-zoom', 'large');
  const large = (await preview.boundingBox())!;
  expect(large.height).toBeGreaterThan(450);
  // The card's own setting wins over the deck's.
  await hover(own);
  await expect(preview).toHaveAttribute('data-zoom', 'small');
  expect((await preview.boundingBox())!.height).toBeLessThan(large.height);
  // Other kinds (e.g. tokens) can zoom too.
  await hover('Marker');
  await expect(preview).toHaveAttribute('data-zoom', 'medium');
  // A face-down card shows its back enlarged.
  await storeState(
    page,
    `(s) => { const c = s.history.present.objects.find(o => o.name === ${JSON.stringify(follower)}); if (c.faceUp) s.dispatch({ type: 'FlipCard', id: c.id }); return 0; }`,
  );
  await hover(follower);
  await expect(preview).toHaveAttribute('data-zoom', 'large');
});

test('zoomed view can turn with the holder; zoom goes below 25%; library thumbnails are sharp', async ({ page }) => {
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  await storeState(page, `(s) => { s.setUi({ inspectorOpen: true }); s.select(${JSON.stringify(deckId)}); }`);
  const panel = page.getByRole('complementary', { name: 'Properties' });
  // The option only shows once the holder zooms on hover.
  await expect(panel.getByLabel('Zoomed view')).toHaveCount(0);
  await panel.getByLabel('Zoom on hover').selectOption('large');
  await panel.getByLabel('Zoomed view').selectOption({ label: 'Turned like on the table' });
  await expect.poll(() => obj<boolean>(page, 'Bonus deck', 'o.hoverRotate')).toBe(true);
  await storeState(page, `(s) => s.dispatch({ type: 'UpdateObject', id: ${JSON.stringify(deckId)}, patch: { cardRotation: 90 } })`);
  await switchMode(page, 'play');

  const preview = page.getByTestId('card-preview');
  const hoverDeck = async () => {
    await page.mouse.move(5, 5);
    await expect(preview).toHaveCount(0);
    const p = await objectScreenPos(page, 'Bonus deck');
    await page.mouse.move(p.x + 3, p.y + 3, { steps: 3 });
  };
  await hoverDeck();
  await expect(preview).toHaveAttribute('data-rotation', '90');
  const turned = (await preview.boundingBox())!;
  expect(turned.width).toBeGreaterThan(turned.height);
  await storeState(page, `(s) => s.dispatch({ type: 'UpdateObject', id: ${JSON.stringify(deckId)}, patch: { hoverRotate: false } })`);
  await hoverDeck();
  await expect(preview).toHaveAttribute('data-rotation', '0');
  const upright = (await preview.boundingBox())!;
  expect(upright.height).toBeGreaterThan(upright.width);

  // Zooming out goes well below 25%.
  await page.mouse.move(5, 5);
  const empty = await worldToPage(page, -800, 0);
  await page.mouse.move(empty.x, empty.y);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
  await expect.poll(() => storeState<number>(page, '(s) => s.camera.scale')).toBeLessThan(0.2);
  expect(await storeState<number>(page, '(s) => s.camera.scale')).toBeGreaterThanOrEqual(0.05);

  // The saved thumbnail is large enough to stay sharp in the library.
  await waitSaved(page);
  const width = await page.evaluate(async () => {
    const req = indexedDB.open('tablenox');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const games: { thumbnail?: string }[] = await new Promise((r) => {
      const q = db.transaction('games').objectStore('games').getAll();
      q.onsuccess = () => r(q.result);
    });
    db.close();
    const img = new Image();
    img.src = games[0].thumbnail!;
    await img.decode();
    return img.naturalWidth;
  });
  expect(width).toBe(640);
});

test('automation: Rotate turns the cards in a holder (not the holder); Recall options keep the turn, face up, shuffle', async ({
  page,
}) => {
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Automation button' }).click();
  await page.getByRole('button', { name: 'Properties panel' }).click();
  await page
    .getByRole('complementary', { name: 'Properties' })
    .getByRole('button', { name: /^Automations/ })
    .click();
  const panel = page.getByRole('complementary', { name: 'Automations' });
  const addStep = async (type: string, pick: string) => {
    await panel.getByRole('group', { name: 'Add a step' }).getByRole('button', { name: type, exact: true }).click();
    await pickStepObject(page, panel, pick);
  };
  await addStep('Rotate', 'Bonus deck');
  await expect(panel.getByText('A holder stays as it is')).toBeVisible();
  await addStep('Recall objects', 'Bonus deck');
  await expect(panel.getByLabel('Card rotation in the holders')).toHaveValue('reset');
  await expect(panel.getByLabel('Face of recalled cards')).toHaveValue('faceDown');
  await panel.getByLabel('Card rotation in the holders').selectOption('keep');
  await panel.getByLabel('Face of recalled cards').selectOption('faceUp');
  await panel.getByLabel('Shuffle after recalling').check();
  await expect
    .poll(() => obj(page, 'Button', 'o.steps[1]'))
    .toMatchObject({ type: 'recall', rotation: 'keep', orientation: 'faceUp', shuffle: true });
  await expect(panel.getByText('Rotate the cards in Bonus deck by 90°')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await switchMode(page, 'play');
  const order = await obj<string[]>(page, 'Bonus deck', 'o.cards.map(c => c.id)');
  const btn = await objectScreenPos(page, 'Button');
  await page.mouse.click(btn.x, btn.y);
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cardTurn')).toBe(90);
  expect(await obj<number>(page, 'Bonus deck', 'o.rotation')).toBe(0);
  expect(await obj<boolean>(page, 'Bonus deck', 'o.cards.every(c => c.faceUp === true)')).toBe(true);
  const after = await obj<string[]>(page, 'Bonus deck', 'o.cards.map(c => c.id)');
  expect([...after].sort()).toEqual([...order].sort());
  expect(after).not.toEqual(order);
});

test('edit mode: box-select with the camera locked, duplicate all, drag all as one undo step', async ({ page }) => {
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  await page.keyboard.press('c'); // lock camera: dragging the table now draws a selection box
  const from = await worldToPage(page, 540, -540);
  const to = await worldToPage(page, 750, -420);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  const dieIds = await storeState<string[]>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'die').map(o => o.id)");
  await expect.poll(() => storeState<string[]>(page, '(s) => [...s.selectedIds].sort()')).toEqual([...dieIds].sort());
  const bar = page.getByRole('toolbar', { name: '2 objects actions' });
  await expect(bar).toBeVisible();

  await bar.getByRole('button', { name: 'Duplicate 2 objects' }).click();
  await expect.poll(() => storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'die').length")).toBe(4);
  const copies = await storeState<string[]>(page, '(s) => s.selectedIds');
  expect(copies.some((id) => dieIds.includes(id))).toBe(false);

  // Dragging one selected copy moves both copies together, as one undo step.
  const pos = (id: string) =>
    storeState<{ x: number; y: number }>(page, `(s) => s.history.present.objects.find(o => o.id === ${JSON.stringify(id)}).position`);
  const before = await Promise.all(copies.map(pos));
  const past = await storeState<number>(page, '(s) => s.history.past.length');
  const c0 = await storeState<{ x: number; y: number; w: number; h: number }>(
    page,
    `(s) => { const o = s.history.present.objects.find(o => o.id === ${JSON.stringify(copies[0])}); return { x: o.position.x, y: o.position.y, w: o.width, h: o.height }; }`,
  );
  const grab = await worldToPage(page, c0.x + c0.w / 2, c0.y + c0.h / 2);
  // Mid-drag: no picked-up tilt/scale in Edit mode.
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + 80, { steps: 5 });
  await page.mouse.move(grab.x, grab.y + 160, { steps: 5 });
  await page.waitForTimeout(250); // longer than the lift animation
  const liftNow = await page.evaluate((id) => {
    const stage = (
      window as unknown as {
        Konva: { stages: Array<{ findOne(s: string): { findOne(s: string): { rotation(): number; scaleX(): number } } }> };
      }
    ).Konva.stages[0];
    const lift = stage.findOne(`#${id}`).findOne('.lift');
    return { rotation: lift.rotation(), scale: lift.scaleX() };
  }, copies[0]);
  expect(liftNow).toEqual({ rotation: 0, scale: 1 });
  await page.mouse.up();
  const after = await Promise.all(copies.map(pos));
  for (let i = 0; i < copies.length; i++) {
    expect(after[i].x).toBe(before[i].x);
    expect(after[i].y).toBeGreaterThan(before[i].y + 50);
  }
  expect(after[1].y - after[0].y).toBe(before[1].y - before[0].y);
  expect(await storeState<number>(page, '(s) => s.history.past.length')).toBe(past + 1);
  await expect(page.locator('.selection-bar')).toHaveCount(0); // never shown after a drag

  // Ctrl+click removes one object from the selection; one undo reverts the whole group drag.
  const p1 = await worldToPage(page, after[1].x + 32, after[1].y + 32);
  await page.keyboard.down('Control');
  await page.mouse.click(p1.x, p1.y);
  await page.keyboard.up('Control');
  await expect.poll(() => storeState<string[]>(page, '(s) => s.selectedIds')).toEqual([copies[0]]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => Promise.all(copies.map(pos))).toEqual(before);
});

test('play mode: Shift+drag box-selects movable pieces, which then drag together as one undo step', async ({ page }) => {
  await addSampleAndPlay(page);
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  // A pile on the sheet next to the dice.
  await storeState(
    page,
    `(s) => s.dispatch({ type: 'DrawCards', deckId: ${JSON.stringify(deckId)}, pileId: 'pile-1', position: { x: 300, y: -560 }, count: 3 })`,
  );
  // The box starts on the (fixed) score sheet and covers both dice and the pile; the sheet itself isn't selected.
  const from = await worldToPage(page, 280, -580);
  const to = await worldToPage(page, 750, -370);
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const dieIds = await storeState<string[]>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'die').map(o => o.id)");
  const ids = [...dieIds, 'pile-1'].sort();
  await expect.poll(() => storeState<string[]>(page, '(s) => [...s.selectedIds].sort()')).toEqual(ids);
  await expect(page.locator('.selection-bar')).toHaveCount(0);

  // Dragging the pile (which normally deals its top card) moves the whole selection instead.
  const pos = (id: string) =>
    storeState<{ x: number; y: number }>(page, `(s) => s.history.present.objects.find(o => o.id === ${JSON.stringify(id)}).position`);
  const before = await Promise.all(ids.map(pos));
  const past = await storeState<number>(page, '(s) => s.history.past.length');
  const grab = await worldToPage(page, 300 + 63, -560 + 88);
  await drag(page, grab, 0, 120);
  const after = await Promise.all(ids.map(pos));
  const dy = after[0].y - before[0].y;
  for (let i = 0; i < ids.length; i++) {
    // The Transformer moves the other members with sub-pixel steps, so allow a unit of rounding.
    expect(Math.abs(after[i].x - before[i].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after[i].y - before[i].y - dy)).toBeLessThanOrEqual(1);
  }
  expect(dy).toBeGreaterThan(30);
  expect(await obj<number>(page, 'Pile', 'o.cards.length')).toBe(3);
  expect(await storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'card').length")).toBe(0);
  expect(await storeState<number>(page, '(s) => s.history.past.length')).toBe(past + 1);

  // A plain click on the empty table clears the selection.
  const empty = await worldToPage(page, -800, 0);
  await page.mouse.click(empty.x, empty.y);
  await expect.poll(() => storeState<string[]>(page, '(s) => s.selectedIds')).toEqual([]);
});

test('edit mode: holders show their cards, a clear outline and "Deck (X cards)" when they have a deck; the corner badge needs 2+ cards', async ({
  page,
}) => {
  await addSampleAndPlay(page);
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  const discardId = await obj<string>(page, 'Discard', 'o.id');
  const nodes = (id: string) =>
    page.evaluate((id) => {
      type N = { findOne(s: string): N | undefined; find(s: string): N[]; text(): string; opacity(): number };
      const stage = (window as unknown as { Konva: { stages: N[] } }).Konva.stages[0];
      const o = stage.findOne(`#${id}`)!;
      // The zone outline is the second rectangle of the holder (after the fill).
      const outline = o.find('Rect')[1];
      return {
        info: o.findOne('.deck-info')?.text() ?? null,
        cards: o.find('.deck-card').length,
        badge: o.find('.deck-handle').length > 0,
        outline: Math.round(outline.opacity() * 100) / 100,
      };
    }, id);

  // One card in a holder: no count badge in the corner. Play mode keeps the faint default outline and no deck text.
  await storeState(
    page,
    `(s) => { s.dispatch({ type: 'DrawCard', deckId: ${JSON.stringify(deckId)}, cardId: 'c1', position: { x: 0, y: 0 }, faceUp: true }); s.dispatch({ type: 'AddCardToDeck', cardId: 'c1', deckId: ${JSON.stringify(discardId)} }); }`,
  );
  await expect.poll(() => nodes(discardId)).toEqual({ info: null, cards: 1, badge: false, outline: 0.3 });
  expect(await nodes(deckId)).toEqual({ info: null, cards: 1, badge: true, outline: 0.3 });

  // Edit mode shows the same cards, a clear outline, and the deck's size (all its cards, even those out of it).
  await switchMode(page, 'edit');
  await expect.poll(() => nodes(deckId)).toEqual({ info: 'Deck (12 cards)', cards: 1, badge: true, outline: 0.85 });
  expect(await nodes(discardId)).toEqual({ info: null, cards: 1, badge: false, outline: 0.85 });
});

test('a card moved into another deck keeps its own size and back', async ({ page }) => {
  await addSampleAndPlay(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  // Make a second deck that is larger and has a different back colour.
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  await page.evaluate((deckId) => {
    type Obj = { id: string; position: { x: number; y: number } };
    const st = (
      window as unknown as { __tablenoxStore: { getState(): { history: { present: { objects: Obj[] } }; dispatch(c: unknown): boolean } } }
    ).__tablenoxStore.getState();
    const deck = st.history.present.objects.find((o) => o.id === deckId)!;
    st.dispatch({
      type: 'AddObject',
      object: {
        ...deck,
        id: 'big-deck',
        name: 'Big deck',
        position: { x: 900, y: -100 },
        width: 200,
        height: 280,
        zIndex: 999,
        backColor: '#aa2222',
        cards: [],
        initialCards: [],
      },
    });
  }, deckId);
  await switchMode(page, 'play');
  await page.keyboard.press('Shift+F');
  await page.waitForTimeout(200);
  const deckPos = await objectScreenPos(page, 'Bonus deck');
  await page.mouse.click(deckPos.x, deckPos.y);
  await page.getByRole('toolbar', { name: 'Bonus deck actions' }).getByRole('button', { name: 'Draw a card' }).click();
  const card = await storeState<{ name: string; width: number; height: number; backColor: string }>(
    page,
    "(s) => s.history.present.objects.find(o => o.kind === 'card')",
  );
  const big = await objectScreenPos(page, 'Big deck');
  const cardPos = await objectScreenPos(page, card.name);
  await drag(page, cardPos, big.x - cardPos.x, big.y - cardPos.y);
  await expect.poll(() => obj<number>(page, 'Big deck', 'o.cards.length')).toBe(1);

  await page.mouse.click(big.x, big.y);
  await page.getByRole('toolbar', { name: 'Big deck actions' }).getByRole('button', { name: 'Draw a card' }).click();
  const redrawn = await storeState<{ width: number; height: number; backColor: string }>(
    page,
    "(s) => s.history.present.objects.find(o => o.kind === 'card')",
  );
  expect(redrawn).toMatchObject({ width: card.width, height: card.height, backColor: card.backColor });
});

test('camera lock stops drag-panning but keeps wheel zoom', async ({ page }) => {
  await addSampleAndPlay(page);
  const empty = await worldToPage(page, -800, 0);
  await page.getByRole('button', { name: /Lock camera/ }).click();
  const c0 = await storeState<{ x: number; y: number; scale: number }>(page, '(s) => s.camera');
  await drag(page, empty, 150, 80);
  expect(await storeState(page, '(s) => s.camera')).toEqual(c0);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => storeState<number>(page, '(s) => s.camera.scale')).toBeGreaterThan(c0.scale);
  await page.keyboard.press('c');
  const c1 = await storeState<{ x: number }>(page, '(s) => s.camera');
  await drag(page, empty, 150, 80);
  expect((await storeState<{ x: number }>(page, '(s) => s.camera')).x).not.toBe(c1.x);
});

test('table colour can be changed and is saved with the game', async ({ page }) => {
  await addSampleAndPlay(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Table colour #2f4f6f' }).click();
  await expect(page.getByTestId('table-canvas')).toHaveCSS('background-color', 'rgb(47, 79, 111)');
  await page.keyboard.press('Escape');
  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('table-canvas')).toHaveCSS('background-color', 'rgb(47, 79, 111)');
});

test('deck copies: 3 images become a 30-card deck; image token stacks have no outline; white table; house button', async ({ page }) => {
  await addSampleAndPlay(page);
  // The library button is a house, apart from the Edit / Play switch.
  await expect(page.getByRole('button', { name: 'Back to library' }).locator('path')).toHaveAttribute('d', /^M3 10\.5L12 3/);

  await switchMode(page, 'edit');
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  await storeState(
    page,
    `(s) => { s.dispatch({ type: 'UpdateObject', id: ${JSON.stringify(deckId)}, patch: { cards: [], initialCards: [] } }); s.setUi({ inspectorOpen: true }); s.select(${JSON.stringify(deckId)}); }`,
  );
  const panel = page.getByRole('complementary', { name: 'Properties' });
  await page.getByTestId('deck-add-images').setInputFiles([
    { name: 'wood.png', mimeType: 'image/png', buffer: await makePng(page, 120, 170, 'W') },
    { name: 'stone.png', mimeType: 'image/png', buffer: await makePng(page, 120, 170, 'S') },
    { name: 'gold.png', mimeType: 'image/png', buffer: await makePng(page, 120, 170, 'G') },
  ]);
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.initialCards.length')).toBe(3);
  for (const [row, n] of [
    [1, 12],
    [2, 10],
    [3, 8],
  ] as const) {
    const copies = panel.getByLabel(`Copies of card ${row}`, { exact: true });
    await copies.fill(String(n));
    await copies.press('Enter');
  }
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.initialCards.length')).toBe(30);
  expect(await obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(30);
  expect(await obj<number>(page, 'Bonus deck', 'new Set(o.initialCards.map(c => c.id)).size')).toBe(30);
  await expect(panel.locator('.inspector-section h3').first()).toHaveText('Card list (30 cards, 3 different)');
  await expect(panel.locator('.card-def-row')).toHaveCount(3);
  await expect(panel.getByLabel('Copies of card 2', { exact: true })).toHaveValue('10');
  // Image cards have no face-text field (text is only drawn on cards without an image).
  await expect(panel.getByLabel('Card 1 face text')).toHaveCount(0);
  // − / + change the number of copies at once.
  await panel.getByRole('button', { name: 'More copies of card 2' }).click();
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.initialCards.length')).toBe(31);
  await expect(panel.getByLabel('Copies of card 2', { exact: true })).toHaveValue('11');
  await panel.getByRole('button', { name: 'Fewer copies of card 2' }).click();
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.initialCards.length')).toBe(30);
  // Renaming a row renames every copy; removing it removes them all.
  await panel.getByLabel('Card 3 name').fill('Gold coin');
  await expect.poll(() => obj<number>(page, 'Bonus deck', "o.initialCards.filter(c => c.name === 'Gold coin').length")).toBe(8);
  await panel.getByRole('button', { name: 'Remove card 3 (all 8 copies)' }).click();
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.initialCards.length')).toBe(22);
  // Every card at once: 3 copies each.
  await panel.getByRole('button', { name: 'Set copies for all cards…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('3');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.initialCards.length')).toBe(6);
  await expect(panel.getByLabel('Copies of card 1', { exact: true })).toHaveValue('3');
  await expect(panel.getByLabel('Copies of card 2', { exact: true })).toHaveValue('3');

  // A token stack with its own image shows just the top token and its badge: no outline, no tokens peeking out.
  const markerId = await obj<string>(page, 'Marker', 'o.id');
  const nodes = (selector: string) =>
    page.evaluate(
      ([id, sel]) =>
        (window as unknown as { Konva: { stages: { findOne(s: string): { find(s: string): unknown[] } }[] } }).Konva.stages[0]
          .findOne(`#${id}`)
          .find(sel).length,
      [markerId, selector],
    );
  await storeState(page, `(s) => s.dispatch({ type: 'UpdateObject', id: ${JSON.stringify(markerId)}, patch: { count: 5 } })`);
  const asset = await obj<string>(page, 'Bonus deck', 'o.initialCards[0].faceAssetId');
  await storeState(
    page,
    `(s) => s.dispatch({ type: 'UpdateObject', id: ${JSON.stringify(markerId)}, patch: { assetId: ${JSON.stringify(asset)} } })`,
  );
  await expect.poll(() => nodes('Image')).toBe(1);
  expect(await nodes('.token-stack-zone')).toBe(0);

  // A white table is one of the colours.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Table colour #ffffff' }).click();
  await expect(page.getByTestId('table-canvas')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('custom dice: image faces, choose the shown face, roll within the custom faces', async ({ page }) => {
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  const die = await objectScreenPos(page, 'White die 1');
  await page.mouse.click(die.x, die.y);
  await page.getByRole('button', { name: 'Properties panel' }).click();
  const panel = page.getByRole('complementary', { name: 'Properties' });
  await panel.getByLabel('Type').selectOption('custom');
  await expect.poll(() => obj<number>(page, 'White die 1', 'o.faces.length')).toBe(6);
  await page.getByTestId('die-add-images').setInputFiles([
    { name: 'sun.png', mimeType: 'image/png', buffer: await makePng(page, 100, 100, 'S') },
    { name: 'moon.png', mimeType: 'image/png', buffer: await makePng(page, 100, 100, 'M') },
  ]);
  await expect.poll(() => obj<number>(page, 'White die 1', 'o.faces.length')).toBe(8);
  expect(await obj(page, 'White die 1', 'o.faces[7].label')).toBe('moon');

  await switchMode(page, 'play');
  const p = await objectScreenPos(page, 'White die 1');
  await page.mouse.click(p.x, p.y);
  const bar = page.getByRole('toolbar', { name: 'White die 1 actions' });
  await bar.getByRole('button', { name: /Choose die face/ }).click();
  const faces = page.getByRole('dialog', { name: 'Choose the face of White die 1' });
  const moon = faces.getByRole('button', { name: '8. moon' });
  await expect(moon.getByTestId('asset-thumb')).toBeVisible();
  await moon.click();
  await expect.poll(() => obj<number>(page, 'White die 1', 'o.value')).toBe(8);
  for (let i = 0; i < 5; i++) await bar.getByRole('button', { name: 'Roll' }).click();
  const v = await obj<number>(page, 'White die 1', 'o.value');
  expect(v).toBeGreaterThanOrEqual(1);
  expect(v).toBeLessThanOrEqual(8);

  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  await expect.poll(() => obj<number>(page, 'White die 1', 'o.faces.length')).toBe(8);
});

test('object palette: add by click or by dragging a tile onto the table, pin it open; checkboxes toggle in Play mode and in automations', async ({
  page,
}) => {
  await newGame(page, 'Palette');
  const palette = page.getByTestId('object-palette');
  // The prominent Add button and the tool-column "+" open the same palette; it closes after adding.
  await page.getByRole('button', { name: 'Add object' }).click();
  await expect(palette).toBeVisible();
  for (const group of ['Cards', 'Pieces', 'Table']) await expect(palette.getByRole('region', { name: group })).toBeVisible();
  await palette.getByRole('menuitem', { name: 'Checkbox' }).click();
  await expect(palette).toHaveCount(0);
  await page.getByRole('button', { name: 'Object palette (A)' }).click();
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await page.keyboard.press('a');
  await expect(palette).toBeVisible();

  // Pinned, it stays open after adding; a tile dragged onto the table lands where it is dropped.
  await palette.getByRole('button', { name: 'Keep the palette open' }).click();
  const canvas = page.getByTestId('table-canvas');
  const box = (await canvas.boundingBox())!;
  await palette.getByRole('menuitem', { name: 'Token' }).dragTo(canvas, { targetPosition: { x: box.width - 300, y: box.height - 200 } });
  await expect.poll(() => storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'token').length")).toBe(1);
  await expect(palette).toBeVisible();
  const token = await storeState<{ x: number; y: number }>(
    page,
    "(s) => { const o = s.history.present.objects.find(o => o.kind === 'token'); const c = s.camera; return { x: (o.position.x + o.width / 2) * c.scale + c.x, y: (o.position.y + o.height / 2) * c.scale + c.y }; }",
  );
  expect(Math.abs(token.x - (box.width - 300))).toBeLessThan(3);
  expect(Math.abs(token.y - (box.height - 200))).toBeLessThan(3);
  await palette.getByRole('button', { name: 'Close palette' }).click();
  await expect(palette).toHaveCount(0);

  // Checkbox: unchecked; a click in Play mode checks it, another unchecks it, without an action bar.
  const checkboxId = await storeState<string>(page, "(s) => s.history.present.objects.find(o => o.kind === 'checkbox').id");
  const isChecked = () =>
    storeState<boolean>(page, `(s) => s.history.present.objects.find(o => o.id === ${JSON.stringify(checkboxId)}).checked`);
  expect(await isChecked()).toBe(false);
  await switchMode(page, 'play');
  const pos = await objectScreenPos(page, 'Checkbox');
  await page.mouse.click(pos.x, pos.y);
  await expect.poll(isChecked).toBe(true);
  await expect(page.locator('.selection-bar')).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.mouse.click(pos.x, pos.y);
  await expect.poll(isChecked).toBe(false);
  // Dragging doesn't move it.
  const before = await obj(page, 'Checkbox', 'o.position');
  await drag(page, pos, 80, 40);
  expect(await obj(page, 'Checkbox', 'o.position')).toEqual(before);

  // A "Check boxes" step checks it.
  await storeState(
    page,
    `(s) => s.dispatch({ type: 'AddObject', object: { id: 'btn-check', kind: 'button', name: 'Tick', position: { x: 0, y: 300 }, width: 150, height: 52,
      rotation: 0, zIndex: 99, locked: false, visible: true, label: 'Tick', color: '#3f8fd8', textColor: '#ffffff',
      steps: [{ id: 'st-1', type: 'check', mode: 'check', objectIds: [${JSON.stringify(checkboxId)}] }] } })`,
  );
  await clickObject(page, 'Tick');
  await expect.poll(isChecked).toBe(true);
});

test('timer: start / pause / reset with its buttons and action bar, a countdown runs out; pawn and meeple tokens', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  const palette = page.getByTestId('object-palette');
  for (const tile of ['Pawn', 'Meeple', 'Timer']) {
    await page.getByRole('button', { name: 'Add object' }).click();
    await palette.getByRole('menuitem', { name: tile, exact: true }).click();
  }
  expect(await obj(page, 'Pawn', 'o.shape')).toBe('pawn');
  expect(await obj(page, 'Meeple', 'o.shape')).toBe('meeple');

  // A 2-second countdown, set in the properties panel.
  const timerId = await obj<string>(page, 'Timer', 'o.id');
  await storeState(page, `(s) => { s.setUi({ inspectorOpen: true }); s.select(${JSON.stringify(timerId)}); }`);
  const props = page.getByRole('complementary', { name: 'Properties' });
  await props.getByLabel('Minutes').fill('0');
  await props.getByLabel('Minutes').press('Enter');
  await props.getByLabel('Seconds').fill('2');
  await props.getByLabel('Seconds').press('Enter');
  await expect.poll(() => obj<number>(page, 'Timer', 'o.duration')).toBe(2);
  await page.keyboard.press('Escape');

  await switchMode(page, 'play');
  const node = (selector: string) =>
    page.evaluate(
      ([id, sel]) => {
        type N = { findOne(s: string): N; getClientRect(): { x: number; y: number; width: number; height: number }; text(): string };
        const n = (window as unknown as { Konva: { stages: N[] } }).Konva.stages[0].findOne(`#${id}`).findOne(sel);
        const r = n.getClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: typeof n.text === 'function' ? n.text() : '' };
      },
      [timerId, selector],
    );
  const box = (await page.getByTestId('table-canvas').boundingBox())!;
  const clickNode = async (selector: string) => {
    const p = await node(selector);
    await page.mouse.click(box.x + p.x, box.y + p.y);
  };
  expect((await node('.timer-text')).text).toBe('0:02');
  await clickNode('.timer-play');
  await expect.poll(() => obj(page, 'Timer', 'o.startedAt')).toEqual(expect.any(Number));
  await expect.poll(async () => (await node('.timer-text')).text, { timeout: 5000 }).toBe('0:00');
  // Reset sets it back and stops it.
  await clickNode('.timer-reset');
  await expect.poll(() => obj(page, 'Timer', 'o.startedAt ?? null')).toBeNull();
  await expect.poll(async () => (await node('.timer-text')).text).toBe('0:02');

  // The action bar starts and pauses it too.
  const t = await objectScreenPos(page, 'Timer');
  await page.mouse.click(t.x - 30, t.y);
  const bar = page.getByRole('toolbar', { name: 'Timer actions' });
  await bar.getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => obj(page, 'Timer', 'o.startedAt')).toEqual(expect.any(Number));
  await bar.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => obj(page, 'Timer', 'o.startedAt ?? null')).toBeNull();
  expect(await obj<number>(page, 'Timer', 'o.elapsedMs')).toBeGreaterThan(0);

  // A Timer automation step restarts it.
  await storeState(
    page,
    `(s) => s.dispatch({ type: 'AddObject', object: { id: 'btn-timer', kind: 'button', name: 'Go', position: { x: 0, y: 400 }, width: 150, height: 52,
      rotation: 0, zIndex: 99, locked: false, visible: true, label: 'Go', color: '#3f8fd8', textColor: '#ffffff',
      steps: [{ id: 'st-t', type: 'timer', mode: 'restart', objectIds: [${JSON.stringify(timerId)}] }] } })`,
  );
  await clickObject(page, 'Go');
  await expect.poll(() => obj(page, 'Timer', 'o.startedAt')).toEqual(expect.any(Number));
  expect(await obj<number>(page, 'Timer', 'o.elapsedMs')).toBe(0);
  expect(errors).toEqual([]);
});

test('tool column: pen / eraser / text options can be closed and shown again; full screen button', async ({ page, browserName }) => {
  await addSampleAndPlay(page);
  const tools = page.getByRole('toolbar', { name: 'Tools' });
  await tools.getByRole('button', { name: 'Pen (P)' }).click();
  const options = page.getByLabel('Pen options');
  await expect(options).toBeVisible();
  await options.getByRole('button', { name: 'Close tool options' }).click();
  await expect(options).toHaveCount(0);
  expect(await storeState(page, '(s) => s.tool')).toBe('pen');
  // Clicking the active tool again shows its options; another tool shows its own.
  await tools.getByRole('button', { name: 'Pen (P)' }).click();
  await expect(options).toBeVisible();
  await options.getByRole('button', { name: 'Close tool options' }).click();
  await tools.getByRole('button', { name: 'Eraser (E)' }).click();
  await expect(page.getByLabel('Eraser options')).toBeVisible();

  // Full screen sits next to "Fit everything", which has its own icon now.
  const full = tools.getByRole('button', { name: 'Full screen' });
  await expect(full).toBeVisible();
  await expect(full).toHaveAttribute('aria-pressed', 'false');
  if (browserName === 'chromium') {
    await full.click();
    await expect(full).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await full.click();
    await expect(full).toHaveAttribute('aria-pressed', 'false');
  }
});

test('pick a card shows red suits in red; unnamed objects show their kind in automation steps and can be found on the table', async ({
  page,
}) => {
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Deck' }).click();
  await storeState(page, '(s) => s.select(null)');
  const deckPos = await objectScreenPos(page, 'Deck');
  await page.mouse.click(deckPos.x, deckPos.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Deck menu' }).getByRole('menuitem', { name: 'Pick card(s)…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Pick card(s) from Deck' });
  await expect(dialog.getByRole('button', { name: '14. A of Hearts' }).locator('.card-picker-text')).toHaveCSS('color', 'rgb(198, 40, 40)');
  await expect(dialog.getByRole('button', { name: '1. A of Spades' }).locator('.card-picker-text')).toHaveCSS('color', 'rgb(31, 35, 40)');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // A bag without a name, used in a Move step.
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Bag' }).click();
  const bagId = await storeState<string>(page, '(s) => s.selectedId');
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Automation button' }).click();
  // The new button lands on top of the bag: move it aside so the bag can be clicked.
  await storeState(page, "(s) => s.dispatch({ type: 'MoveObject', id: s.selectedId, position: { x: -3000, y: -3000 } })");
  await page.getByRole('button', { name: 'Properties panel' }).click();
  await page
    .getByRole('complementary', { name: 'Properties' })
    .getByRole('button', { name: /^Automations/ })
    .click();
  const panel = page.getByRole('complementary', { name: 'Automations' });
  await panel.getByRole('group', { name: 'Add a step' }).getByRole('button', { name: 'Move objects', exact: true }).click();
  await pickStepObject(page, panel, bagId);
  const chip = panel.getByRole('list', { name: 'What to move' }).getByRole('button', { name: 'Bag', exact: true });
  await expect(chip).toBeVisible();
  await expect(panel.getByLabel('Cards or pieces taken from each holder / pile / bag (empty = all)')).toHaveAttribute('placeholder', 'all');
  await expect(panel.locator('.step-summary')).toHaveText(/Move Bag to/);

  // Clicking the chip selects the bag and flashes it on the table.
  await chip.click();
  await expect.poll(() => storeState(page, '(s) => s.selectedId')).toBe(bagId);
  expect(await storeState(page, '(s) => s.flash && s.flash.id')).toBe(bagId);
});

test('automation button: configure, reorder and edit steps; run in Play mode as one undo step', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await addSampleAndPlay(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Automation button' }).click();
  await page.getByRole('button', { name: 'Properties panel' }).click();
  const props = page.getByRole('complementary', { name: 'Properties' });
  await props.getByRole('button', { name: /^Automations/ }).click();
  // The steps live in their own panel, without the object's position/size fields.
  const panel = page.getByRole('complementary', { name: 'Automations' });
  await expect(panel).toBeVisible();
  await expect(props).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Object', exact: true })).toHaveCount(0);

  const addStep = async (type: string, pick: string) => {
    await panel.getByRole('group', { name: 'Add a step' }).getByRole('button', { name: type, exact: true }).click();
    await pickStepObject(page, panel, pick);
  };
  await addStep('Change counter', 'Round');
  await addStep('Roll dice', 'White die 1');
  await expect(panel.locator('.step-item')).toHaveCount(2);

  // Reorder: the die roll moves in front of the counter change.
  await panel.getByRole('button', { name: 'Move step 2 up' }).click();
  await expect.poll(() => obj<string[]>(page, 'Button', 'o.steps.map(s => s.type)')).toEqual(['roll', 'counter']);

  // Edit the counter step: add 5.
  await panel.getByRole('button', { name: /Change Round/ }).click();
  const amount = panel.getByLabel('Amount');
  await amount.fill('5');
  await amount.press('Enter');
  await expect.poll(() => obj<number>(page, 'Button', 'o.steps[1].amount')).toBe(5);

  // Back to the button's properties, then reopen the automations from the action bar.
  await panel.getByRole('button', { name: /Button properties/ }).click();
  await expect(props).toBeVisible();
  await expect(panel).toHaveCount(0);
  const btn = await objectScreenPos(page, 'Button');
  await page.mouse.click(btn.x, btn.y);
  await page.getByRole('toolbar', { name: 'Button actions' }).getByRole('button', { name: 'Automations…' }).click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape'); // deselects
  await page.keyboard.press('Escape'); // closes the panel
  await expect(panel).toHaveCount(0);

  await switchMode(page, 'play');
  const before = await obj<number>(page, 'Round', 'o.value');
  const pos = await objectScreenPos(page, 'Button');
  const buttonId = await obj<string>(page, 'Button', 'o.id');
  const liftScale = () =>
    page.evaluate((id) => {
      type N = { findOne(s: string): N; scaleX(): number };
      const stage = (window as unknown as { Konva: { stages: N[] } }).Konva.stages[0];
      return stage.findOne(`#${id}`).findOne('.lift').scaleX();
    }, buttonId);
  // Pressing pushes the button down; releasing springs it back and runs it.
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down();
  await expect.poll(liftScale).toBeLessThan(0.97);
  expect(await obj<number>(page, 'White die 1', 'o.rollCount')).toBe(0);
  await page.mouse.up();
  await expect.poll(liftScale).toBe(1);
  await expect.poll(() => obj<number>(page, 'White die 1', 'o.rollCount')).toBe(1);
  expect(await obj<number>(page, 'Round', 'o.value')).toBe(before + 5);
  // Buttons don't show a selection bar and can't be dragged in Play mode.
  await expect(page.getByRole('toolbar', { name: 'Button actions' })).toHaveCount(0);
  const placed = await obj<{ x: number; y: number }>(page, 'Button', 'o.position');
  await drag(page, pos, 80, 60);
  expect(await obj<{ x: number; y: number }>(page, 'Button', 'o.position')).toEqual(placed);
  // Dragging the camera from the button must not run it.
  expect(await obj<number>(page, 'White die 1', 'o.rollCount')).toBe(1);

  // The whole run is a single undo step.
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect.poll(() => obj<number>(page, 'White die 1', 'o.rollCount')).toBe(0);
  expect(await obj<number>(page, 'Round', 'o.value')).toBe(before);
  expect(errors).toEqual([]);
});

test('automation: a Pick cards step lets the player choose cards when the button runs; one undo step; Cancel stops it', async ({
  page,
}) => {
  await addSampleAndPlay(page);
  await switchMode(page, 'edit');
  await storeState(
    page,
    `(s) => {
      s.dispatch({ type: 'AddObject', object: { id: 'btn-pick', kind: 'button', name: 'Choose', position: { x: 900, y: 500 }, width: 150, height: 52,
        rotation: 0, zIndex: 99, locked: false, visible: true, label: 'Choose', color: '#3f8fd8', textColor: '#ffffff', steps: [] } });
      s.setUi({ inspectorOpen: true });
      s.select('btn-pick');
    }`,
  );
  // The step is offered in the automations panel, with the holders to pick from, a destination and the side.
  await page
    .getByRole('complementary', { name: 'Properties' })
    .getByRole('button', { name: /^Automations/ })
    .click();
  const panel = page.getByRole('complementary', { name: 'Automations' });
  await panel.getByRole('group', { name: 'Add a step' }).getByRole('button', { name: 'Pick cards', exact: true }).click();
  await expect(panel.getByText('Holders to pick from')).toBeVisible();
  await expect(panel.getByText('Where the picked cards go')).toBeVisible();
  await expect(panel.getByLabel('Face of picked cards')).toBeVisible();

  await storeState(
    page,
    `(s) => {
      const objs = s.history.present.objects;
      const deck = objs.find(o => o.name === 'Bonus deck');
      const discard = objs.find(o => o.name === 'Discard');
      s.dispatch({ type: 'UpdateObject', id: 'btn-pick', patch: { steps: [
        { id: 'st-shuffle', type: 'shuffle', objectIds: [deck.id] },
        { id: 'st-pick', type: 'pick', objectIds: [deck.id], targetIds: [discard.id], orientation: 'faceUp' },
      ] } });
    }`,
  );
  await switchMode(page, 'play');
  const past = await storeState<number>(page, '(s) => s.history.past.length');
  const button = await clickObject(page, 'Choose');
  const dialog = page.getByRole('dialog', { name: 'Choose: pick card(s) from Bonus deck' });
  await expect(dialog.getByRole('list', { name: 'Cards' }).getByRole('button')).toHaveCount(12);
  await dialog.getByRole('button', { name: /^2\. / }).click();
  await dialog.getByRole('button', { name: /^1\. / }).click();
  await dialog.getByRole('button', { name: 'Take 2 cards' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(10);
  expect(await obj<boolean[]>(page, 'Discard', 'o.cards.map(c => c.faceUp)')).toEqual([true, true]);
  // The shuffle and the pick are one undo step, and the shuffled deck is animated.
  expect(await storeState<number>(page, '(s) => s.history.past.length')).toBe(past + 1);
  expect(await storeState<string[]>(page, '(s) => s.shuffled.ids')).toEqual([await obj<string>(page, 'Bonus deck', 'o.id')]);
  await storeState(page, '(s) => s.undo()');
  await expect.poll(() => obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(12);
  // Cancel stops the whole run: nothing changes.
  await page.mouse.click(button.x, button.y);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await storeState<number>(page, '(s) => s.history.past.length')).toBe(past);
});

test('automation button: pick step objects on the table by clicking and Shift+drag; flip a holder', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await addSampleAndPlay(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add object' }).click();
  await page.getByRole('menuitem', { name: 'Automation button' }).click();
  await page.getByRole('button', { name: 'Properties panel' }).click();
  await page
    .getByRole('complementary', { name: 'Properties' })
    .getByRole('button', { name: /^Automations/ })
    .click();
  const panel = page.getByRole('complementary', { name: 'Automations' });
  const buttonId = await obj<string>(page, 'Button', 'o.id');
  // Keep the pieces clear of the panel, and put the button somewhere visible.
  await page.evaluate((id) => {
    const store = (window as unknown as { __tablenoxStore: { getState(): any } }).__tablenoxStore.getState();
    const { width, height } = store.viewport;
    store.setCamera({ scale: 0.6, x: width * 0.35 - 650 * 0.6, y: height / 2 });
    store.dispatch({ type: 'MoveObject', id, position: { x: 300, y: 380 } });
  }, buttonId);
  const banner = page.getByTestId('pick-banner');
  const addStep = async (type: string) => {
    await panel.getByRole('group', { name: 'Add a step' }).getByRole('button', { name: type, exact: true }).click();
  };
  const click = async (name: string) => {
    const p = await objectScreenPos(page, name);
    await page.mouse.click(p.x, p.y);
  };

  // Step 1: move the top 2 cards of the deck to the Discard holder, face down.
  await addStep('Move objects');
  await panel.getByRole('button', { name: 'Pick on table' }).click();
  await expect(banner).toBeVisible();
  await click('Bonus deck');
  await panel.getByRole('button', { name: 'Done picking' }).click();
  await panel.getByRole('button', { name: 'Pick destinations on table' }).click();
  const deckId = await obj<string>(page, 'Bonus deck', 'o.id');
  const discardId = await obj<string>(page, 'Discard', 'o.id');
  const markerId = await obj<string>(page, 'Marker', 'o.id');
  // Picking destinations waits for Done too; clicks add destinations, a second click removes one.
  await click('Marker');
  await expect.poll(() => obj(page, 'Button', 'o.steps[0].targetIds')).toEqual([markerId]);
  await click('Discard');
  await expect.poll(() => obj(page, 'Button', 'o.steps[0].targetIds')).toEqual([markerId, discardId]);
  await expect(
    panel.getByLabel('Cards or pieces each destination gets from each holder / pile / bag (empty = deal them all)'),
  ).toBeVisible();
  await click('Marker');
  await expect.poll(() => obj(page, 'Button', 'o.steps[0].targetIds')).toEqual([discardId]);
  await expect(banner).toBeVisible();
  await panel.getByRole('button', { name: 'Done picking' }).click();
  await expect(banner).toHaveCount(0);
  await panel.getByRole('combobox', { name: 'Take from the' }).selectOption('top');
  const count = panel.getByLabel('Cards or pieces taken from each holder / pile / bag (empty = all)');
  await count.fill('2');
  await count.press('Enter');
  await panel.getByLabel('Face of moved cards').selectOption('faceDown');
  await expect
    .poll(() => obj(page, 'Button', 'o.steps[0]'))
    .toMatchObject({ objectIds: [deckId], targetIds: [discardId], deckMode: 'top', count: 2, orientation: 'faceDown' });
  // Picking never selected or moved the clicked objects.
  expect(await storeState(page, '(s) => s.selectedId')).toBe(buttonId);
  // Clicking an object in the step's list selects it on the table.
  await panel.getByRole('list', { name: 'What to move' }).getByRole('button', { name: 'Bonus deck', exact: true }).click();
  expect(await storeState(page, '(s) => s.selectedId')).toBe(deckId);
  await expect(panel).toBeVisible();

  // Step 2: flip everything in the holder face up. A die can't be flipped, so clicking it adds nothing.
  await addStep('Flip');
  await panel.getByRole('combobox', { name: 'Flip', exact: true }).selectOption('faceUp');
  await panel.getByRole('button', { name: 'Pick on table' }).click();
  await click('Discard');
  await click('White die 1');
  await expect.poll(() => obj(page, 'Button', 'o.steps[1].objectIds')).toEqual([discardId]);
  // Clicking a picked object again removes it; once more adds it back.
  await page.waitForTimeout(450);
  await click('Discard');
  await expect.poll(() => obj(page, 'Button', 'o.steps[1].objectIds')).toEqual([]);
  await page.waitForTimeout(450);
  await click('Discard');
  await expect.poll(() => obj(page, 'Button', 'o.steps[1].objectIds')).toEqual([discardId]);
  await page.keyboard.press('Escape');
  await expect(banner).toHaveCount(0);
  expect(await storeState(page, '(s) => s.selectedId')).toBe(deckId);

  // Step 3: Shift+drag a box around both dice.
  await addStep('Roll dice');
  await panel.getByRole('button', { name: 'Pick on table' }).click();
  const from = await worldToPage(page, 540, -545);
  const to = await worldToPage(page, 750, -415);
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const dice = [await obj<string>(page, 'White die 1', 'o.id'), await obj<string>(page, 'White die 2', 'o.id')];
  await expect.poll(() => obj<string[]>(page, 'Button', 'o.steps[2].objectIds.slice().sort()')).toEqual([...dice].sort());
  await panel.getByRole('button', { name: 'Done picking' }).click();
  await expect(banner).toHaveCount(0);

  await switchMode(page, 'play');
  await clickObject(page, 'Button');
  await expect.poll(() => obj<number>(page, 'White die 2', 'o.rollCount')).toBe(1);
  // The two cards went into the Discard holder (shown with its count), turned face up by step 2; the deck stayed put.
  const discardCards = await obj<{ faceUp?: boolean }[]>(page, 'Discard', 'o.cards');
  expect(discardCards).toHaveLength(2);
  expect(discardCards.every((c) => c.faceUp)).toBe(true);
  expect(await storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'deck' && o.isPile).length")).toBe(0);
  expect(await obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(10);
  expect(errors).toEqual([]);
});

test('phone: one-row top bar, tap shows the action bar, long-press opens the menu (or enlarges a zoomable card), pinch zooms, a finger draws cards', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'touch input is dispatched through the Chromium DevTools protocol');
  const context = await browser.newContext({ viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = collectConsoleErrors(page);
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });

  await page.goto('/');
  await addSampleAndPlay(page);

  // The top bar fits in one row and the tool column starts below it.
  const top = (await page.locator('.hud-top').boundingBox())!;
  const tools = (await page.locator('.hud-tools').boundingBox())!;
  expect(top.height).toBeLessThan(60);
  expect(tools.y).toBeGreaterThanOrEqual(top.y + top.height);
  expect(tools.y + tools.height).toBeLessThanOrEqual(839);

  // A tap selects and shows the action bar; a double-tap rolls once.
  const die = await objectScreenPos(page, 'White die 1');
  await page.touchscreen.tap(die.x, die.y);
  await expect(page.getByRole('toolbar', { name: 'White die 1 actions' })).toBeVisible();
  await page.waitForTimeout(500);
  const before = await storeState<number>(page, '(s) => s.history.past.length');
  await page.touchscreen.tap(die.x, die.y);
  await page.touchscreen.tap(die.x, die.y);
  await expect.poll(() => storeState<number>(page, '(s) => s.history.past.length')).toBe(before + 1);

  // A long-press opens the object menu, which stays open after lifting the finger.
  const deck = await objectScreenPos(page, 'Bonus deck');
  await touch('touchStart', [deck]);
  await page.waitForTimeout(700);
  await touch('touchEnd', []);
  await expect(page.getByRole('menu', { name: 'Bonus deck menu' })).toBeVisible();
  await page.touchscreen.tap(400, 800);
  await expect(page.getByRole('menu', { name: 'Bonus deck menu' })).toHaveCount(0);

  // One finger drags a card out of the holder.
  await touch('touchStart', [deck]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: deck.x - i * 12, y: deck.y + i * 6 }]);
  await touch('touchEnd', []);
  await expect.poll(() => storeState<number>(page, "(s) => s.history.present.objects.filter(o => o.kind === 'card').length")).toBe(1);

  // With "Zoom on hover" on its deck, a long-press on the card shows it enlarged while held, instead of the menu.
  await storeState(
    page,
    "(s) => { const d = s.history.present.objects.find(o => o.name === 'Bonus deck'); s.dispatch({ type: 'UpdateObject', id: d.id, patch: { hoverZoom: 'large' } }); }",
  );
  const card = await storeState<{ x: number; y: number }>(
    page,
    "(s) => { const o = s.history.present.objects.find(o => o.kind === 'card'); const c = s.camera; return { x: (o.position.x + o.width / 2) * c.scale + c.x, y: (o.position.y + o.height / 2) * c.scale + c.y }; }",
  );
  const box = (await page.getByTestId('table-canvas').boundingBox())!;
  const cardPos = { x: box.x + card.x, y: box.y + card.y };
  await touch('touchStart', [cardPos]);
  await expect(page.getByTestId('card-preview')).toBeVisible();
  await expect(page.locator('.context-menu')).toHaveCount(0);
  await touch('touchEnd', []);
  await expect(page.getByTestId('card-preview')).toHaveCount(0);
  await expect(page.locator('.context-menu')).toHaveCount(0);
  // Holding a card in the holder enlarges it too (the menu is still one tap away, in the action bar's ⋯).
  const cardsInDeck = await obj<number>(page, 'Bonus deck', 'o.cards.length');
  await touch('touchStart', [deck]);
  await expect(page.getByTestId('card-preview')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('.context-menu')).toHaveCount(0);
  await touch('touchEnd', []);
  await expect(page.getByTestId('card-preview')).toHaveCount(0);
  await expect(page.locator('.context-menu')).toHaveCount(0);
  expect(await obj<number>(page, 'Bonus deck', 'o.cards.length')).toBe(cardsInDeck);

  // Two fingers pinch-zoom about their midpoint without drawing, selecting or opening a menu.
  const scale = await storeState<number>(page, '(s) => s.camera.scale');
  const c = { x: 230, y: 420 };
  await touch('touchStart', [{ x: c.x - 40, y: c.y }]);
  await touch('touchStart', [
    { x: c.x - 40, y: c.y },
    { x: c.x + 40, y: c.y },
  ]);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [
      { x: c.x - 40 - i * 8, y: c.y },
      { x: c.x + 40 + i * 8, y: c.y },
    ]);
  }
  await touch('touchEnd', []);
  await expect.poll(() => storeState<number>(page, '(s) => s.camera.scale')).toBeCloseTo(scale * 3, 5);
  await expect(page.locator('.context-menu')).toHaveCount(0);

  // The help dialog fits the screen and lists the touch gestures first.
  await page.getByRole('button', { name: 'More' }).tap();
  await page.getByRole('menuitem', { name: /Controls/ }).tap();
  await expect(page.getByRole('dialog').locator('th').first()).toHaveText(/^Touch/);
  await expect(page.getByRole('button', { name: 'Close' })).toBeInViewport();
  expect(errors).toEqual([]);
  await context.close();
});
