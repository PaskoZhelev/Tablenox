import { numberedDeck } from '../../domain/cards';
import { createObject } from '../../domain/objects';
import { createGame } from '../../domain/game';
import type { Game, TabletopObject } from '../../domain/types';
import { repo } from '../../persistence/repository';

/** Draws a simple roll-and-write score sheet onto a canvas (original artwork, generated at runtime). */
async function renderSheetPng(): Promise<Blob> {
  const W = 900;
  const H = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fbf8ef';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2b2b2b';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Number Rows', W / 2, 90);
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillStyle = '#555';
  ctx.fillText('Roll 2 dice. Cross off the sum in any row, left to right. Score crossed boxes.', W / 2, 135);

  const rows = [
    { color: '#e05252', nums: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    { color: '#e8c547', nums: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    { color: '#4caf6a', nums: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2] },
    { color: '#3f8fd8', nums: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2] },
  ];
  const box = 64;
  const gap = 8;
  const startX = (W - (box * 11 + gap * 10)) / 2;
  rows.forEach((row, r) => {
    const y = 190 + r * 130;
    ctx.fillStyle = row.color;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(startX - 16, y - 16, box * 11 + gap * 10 + 32, box + 32);
    ctx.globalAlpha = 1;
    row.nums.forEach((n, i) => {
      const x = startX + i * (box + gap);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x, y, box, box);
      ctx.strokeStyle = row.color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, box, box);
      ctx.fillStyle = '#2b2b2b';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.fillText(String(n), x + box / 2, y + box / 2 + 11);
    });
  });

  const scoreY = 760;
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillStyle = '#2b2b2b';
  ctx.fillText('Score', W / 2, scoreY);
  const labels = ['Red', 'Yellow', 'Green', 'Blue', 'Penalty', 'Total'];
  const sw = 120;
  const sx = (W - (sw * 6 + 16 * 5)) / 2;
  labels.forEach((l, i) => {
    const x = sx + i * (sw + 16);
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, scoreY + 50, sw, 90);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(l, x + sw / 2, scoreY + 40);
  });

  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText('Penalties', W / 2, 1000);
  for (let i = 0; i < 4; i++) {
    const x = W / 2 - 2 * 70 + i * 70 + 5;
    ctx.strokeRect(x, 1030, 56, 56);
  }
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillStyle = '#777';
  ctx.fillText('Tablenox sample sheet', W / 2, 1160);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render sample sheet'))), 'image/png'),
  );
}

export async function createSampleGame(): Promise<Game> {
  const sheetBlob = await renderSheetPng();
  const sheetId = await repo.addAsset(new File([sheetBlob], 'number-rows-sheet.png', { type: 'image/png' }));
  const t = createGame('Sample: Number Rows (roll & write)');
  let z = 1;
  const at = <T extends TabletopObject>(o: T, patch: Partial<T>): T => ({ ...o, ...patch });

  const board = at(createObject('board', { center: { x: 0, y: 0 }, zIndex: z++ }), {
    name: 'Score sheet',
    assetId: sheetId,
    width: 900,
    height: 1200,
    position: { x: -450, y: -600 },
  });
  const die1 = at(createObject('die', { center: { x: 600, y: -480 }, zIndex: z++ }), { name: 'White die 1' });
  const die2 = at(createObject('die', { center: { x: 690, y: -480 }, zIndex: z++ }), { name: 'White die 2' });
  const rounds = at(createObject('counter', { center: { x: 645, y: -330 }, zIndex: z++ }), {
    name: 'Round',
    label: 'Round',
    value: 1,
    min: 1,
    max: 30,
  });
  const deckObj = createObject('deck', { center: { x: 590, y: 0 }, zIndex: z++ });
  const cards = numberedDeck(1, 12);
  const deck = at(deckObj, { name: 'Bonus deck', cards, initialCards: cards, drawSide: 'faceUp' });
  const discard = at(createObject('deck', { center: { x: 650, y: 280 }, zIndex: z++ }), {
    name: 'Discard',
    label: 'Discard',
    width: 260,
    height: 220,
  });
  const marker = at(createObject('token', { center: { x: 560, y: 480 }, zIndex: z++ }), {
    name: 'Marker',
    color: '#7b5bd6',
    shape: 'star',
  });
  const title = at(createObject('label', { center: { x: 0, y: -680 }, zIndex: z++ }), {
    name: 'Instructions',
    text: 'Use the Pen tool (P) to cross off boxes and the Text tool (T) to write scores.',
    width: 900,
    height: 40,
    fontSize: 22,
    color: '#f5f5f5',
    align: 'center',
    position: { x: -450, y: -680 },
    locked: true,
  });

  t.objects = [board, die1, die2, rounds, deck, discard, marker, title];
  await repo.saveGame(t);
  return t;
}
