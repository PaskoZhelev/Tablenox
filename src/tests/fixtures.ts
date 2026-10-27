import { createCardDef, createObject } from '../domain/objects';
import { createGame } from '../domain/game';
import type { Game, TableState } from '../domain/types';

/** Minimal byte sequences that pass magic-number sniffing. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
export const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

export function pngFile(name = 'sheet.png'): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

/** A game with one of each common object; `assetId` is used for the board image and a card face. */
export function fixtureGame(assetId?: string): Game {
  const g = createGame('Fixture game');
  let z = 1;
  const board = { ...createObject('board', { center: { x: 0, y: 0 }, zIndex: z++ }), assetId };
  const deck = createObject('deck', { center: { x: 600, y: 0 }, zIndex: z++ });
  deck.name = 'Deck';
  deck.drawSide = 'faceUp';
  const defs = [1, 2, 3, 4, 5].map((n) =>
    createCardDef({ name: `C${n}`, faceText: String(n), faceAssetId: n === 1 ? assetId : undefined }),
  );
  deck.cards = defs;
  deck.initialCards = [...defs];
  const card = createObject('card', { center: { x: 300, y: 300 }, zIndex: z++ });
  const holder = createObject('deck', { center: { x: 300, y: -300 }, zIndex: z++ });
  holder.name = 'Holder';
  const counter = createObject('counter', { center: { x: -300, y: 300 }, zIndex: z++ });
  counter.min = 0;
  counter.max = 10;
  const die = createObject('die', { center: { x: -300, y: -300 }, zIndex: z++ });
  const token = createObject('token', { center: { x: -400, y: 0 }, zIndex: z++ });
  const label = createObject('label', { center: { x: 0, y: -400 }, zIndex: z++ });
  const bag = createObject('bag', { center: { x: 400, y: 400 }, zIndex: z++ });
  g.objects = [board, deck, card, holder, counter, die, token, label, bag];
  return g;
}

export function tableOf(g: Game): TableState {
  return { objects: g.objects, annotations: g.annotations };
}
