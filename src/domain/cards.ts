import { createCardDef } from './objects';
import type { CardDef } from './types';

const SUITS = [
  { symbol: '♠', name: 'Spades', red: false },
  { symbol: '♥', name: 'Hearts', red: true },
  { symbol: '♦', name: 'Diamonds', red: true },
  { symbol: '♣', name: 'Clubs', red: false },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Text-based standard 52-card deck (no external artwork). Red suits use a light pink face. */
export function standardDeck(includeJokers = false): CardDef[] {
  const cards: CardDef[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push(
        createCardDef({
          name: `${rank} of ${suit.name}`,
          faceText: `${rank}${suit.symbol}`,
          faceColor: suit.red ? '#fff0f0' : '#ffffff',
        }),
      );
    }
  }
  if (includeJokers) {
    cards.push(createCardDef({ name: 'Joker', faceText: 'JOKER', faceColor: '#fffbe6' }));
    cards.push(createCardDef({ name: 'Joker', faceText: 'JOKER', faceColor: '#fffbe6' }));
  }
  return cards;
}

export function numberedDeck(from: number, to: number, copies = 1): CardDef[] {
  const cards: CardDef[] = [];
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let c = 0; c < copies; c++) {
    for (let n = lo; n <= hi; n++) {
      cards.push(createCardDef({ name: `Card ${n}`, faceText: String(n) }));
    }
  }
  return cards;
}

/** True when the face text represents a red suit (used to colour text). */
export function isRedSuitText(text: string): boolean {
  return /[♥♦]/.test(text);
}

export const RED_SUIT_TEXT_COLOR = '#c62828';
export const DARK_TEXT_COLOR = '#1f2328';

/** Colour of a card's face text: red for hearts and diamonds, dark otherwise. */
export function cardTextColor(faceText: string): string {
  return isRedSuitText(faceText) ? RED_SUIT_TEXT_COLOR : DARK_TEXT_COLOR;
}
