import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHash, routeHref } from '../app/router';
import { registerPrimaryClick, resetDoubleClick } from '../canvas/doubleClick';
import { allowTaps, suppressTaps, tapsSuppressed } from '../canvas/touch';
import { simplifyPoints, strokeHit, textBounds, textHit, TEXT_LINE_HEIGHT } from '../domain/annotations';
import { cardTextColor, DARK_TEXT_COLOR, isRedSuitText, numberedDeck, RED_SUIT_TEXT_COLOR, standardDeck } from '../domain/cards';
import { distanceToSegment, objectBounds, objectCenter, pointInRect, sceneBounds, unionRects } from '../domain/geometry';
import { newId } from '../domain/ids';
import { createObject } from '../domain/objects';
import type { InkStroke, TextAnnotation } from '../domain/types';

afterEach(() => vi.restoreAllMocks());

describe('geometry', () => {
  const box = { position: { x: 10, y: 20 }, width: 100, height: 40, rotation: 0 };

  it('centres and bounds objects, also when rotated', () => {
    expect(objectCenter(box)).toEqual({ x: 60, y: 40 });
    expect(objectBounds(box)).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    const turned = objectBounds({ ...box, rotation: 90 });
    expect(turned.width).toBeCloseTo(40);
    expect(turned.height).toBeCloseTo(100);
    expect(turned.x).toBeCloseTo(40);
    expect(turned.y).toBeCloseTo(-10);
    // 45° grows the box to the diagonal extent.
    expect(objectBounds({ ...box, width: 100, height: 100, rotation: 45 }).width).toBeCloseTo(Math.SQRT2 * 100);
  });

  it('joins rectangles and measures the scene (visible objects and ink)', () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: -5, y: 5, width: 10, height: 20 },
      ]),
    ).toEqual({ x: -5, y: 0, width: 15, height: 25 });
    const a = { ...createObject('token', { center: { x: 0, y: 0 }, zIndex: 1 }) };
    const hidden = { ...createObject('token', { center: { x: 1000, y: 1000 }, zIndex: 2 }), visible: false };
    expect(sceneBounds([])).toBeNull();
    expect(sceneBounds([a, hidden])).toEqual(objectBounds(a));
    const stroke: InkStroke = { id: 's', color: '#000', width: 2, opacity: 1, points: [100, 100, 300, 50] };
    const withInk = sceneBounds([a], { strokes: [stroke, { ...stroke, id: 'empty', points: [] }], text: [] })!;
    expect(withInk.x + withInk.width).toBe(300);
    expect(withInk.y).toBeLessThanOrEqual(objectBounds(a).y);
  });

  it('tests points against rectangles and segments', () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    expect(pointInRect({ x: 10, y: 0 }, r)).toBe(true);
    expect(pointInRect({ x: 10.1, y: 0 }, r)).toBe(false);
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    // Beyond an end the distance is to that end; a zero-length segment is a point.
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('annotations', () => {
  const stroke: InkStroke = { id: 's', color: '#000', width: 4, opacity: 1, points: [0, 0, 100, 0] };

  it('hits strokes within the eraser radius plus half the pen width', () => {
    expect(strokeHit(stroke, { x: 50, y: 7 }, 5)).toBe(true);
    expect(strokeHit(stroke, { x: 50, y: 7.5 }, 5)).toBe(false);
    const dot = { ...stroke, points: [10, 10] };
    expect(strokeHit(dot, { x: 13, y: 14 }, 3)).toBe(true);
    expect(strokeHit(dot, { x: 20, y: 20 }, 3)).toBe(false);
  });

  it('bounds and hits typed text', () => {
    const t: TextAnnotation = { id: 't', position: { x: 10, y: 10 }, text: 'ab\nabcd', fontSize: 10, color: '#000' };
    expect(textBounds(t)).toEqual({ x: 10, y: 10, width: 24, height: 2 * 10 * TEXT_LINE_HEIGHT });
    expect(textHit(t, { x: 30, y: 30 }, 0)).toBe(true);
    expect(textHit(t, { x: 40, y: 10 }, 0)).toBe(false);
    expect(textHit(t, { x: 40, y: 10 }, 6)).toBe(true);
  });

  it('simplifies pen points, keeping the first and last', () => {
    expect(simplifyPoints([0, 0, 1, 1], 5)).toEqual([0, 0, 1, 1]);
    expect(simplifyPoints([0, 0, 1, 0, 2, 0, 10, 0, 11, 0, 11.123, 0], 5)).toEqual([0, 0, 10, 0, 11.12, 0]);
  });
});

describe('standard decks', () => {
  it('builds a 52-card deck (optionally with jokers) and numbered decks with copies', () => {
    const deck = standardDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
    expect(deck[0]).toMatchObject({ name: 'A of Spades', faceText: 'A♠', faceColor: '#ffffff' });
    expect(deck[13]).toMatchObject({ name: 'A of Hearts', faceColor: '#fff0f0' });
    expect(
      standardDeck(true)
        .slice(52)
        .map((c) => c.name),
    ).toEqual(['Joker', 'Joker']);
    expect(numberedDeck(3, 1, 2).map((c) => c.faceText)).toEqual(['1', '1', '2', '2', '3', '3']);
    expect(numberedDeck(5, 5)[0].name).toBe('Card 5');
  });

  it('colours red suits red', () => {
    expect(isRedSuitText('10♦')).toBe(true);
    expect(cardTextColor('Q♥')).toBe(RED_SUIT_TEXT_COLOR);
    expect(cardTextColor('K♣')).toBe(DARK_TEXT_COLOR);
  });
});

describe('ids', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('makes v4 UUIDs, also without crypto.randomUUID (plain-http LAN testing)', () => {
    expect(newId()).toMatch(uuid);
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const a = newId();
      expect(a).toMatch(uuid);
      expect(newId()).not.toBe(a);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});

describe('hash router', () => {
  it('parses and builds routes; anything unknown is the library', () => {
    expect(parseHash('#/edit/abc-123')).toEqual({ name: 'edit', id: 'abc-123' });
    expect(parseHash('#/play/x1')).toEqual({ name: 'play', id: 'x1' });
    expect(parseHash('')).toEqual({ name: 'library' });
    expect(parseHash('#/edit/../etc')).toEqual({ name: 'library' });
    expect(parseHash('#/delete/x')).toEqual({ name: 'library' });
    expect(routeHref({ name: 'library' })).toBe('#/');
    expect(routeHref({ name: 'play', id: 'g1' })).toBe('#/play/g1');
    expect(parseHash(routeHref({ name: 'edit', id: 'g2' }))).toEqual({ name: 'edit', id: 'g2' });
  });
});

describe('pointer helpers', () => {
  it('detects primary double-clicks on the same object within 400 ms', () => {
    const now = vi.spyOn(performance, 'now');
    resetDoubleClick();
    now.mockReturnValue(1000);
    expect(registerPrimaryClick('a')).toBe(false);
    now.mockReturnValue(1300);
    expect(registerPrimaryClick('a')).toBe(true);
    // A third click starts over; a different object or a slow second click is no double-click.
    now.mockReturnValue(1350);
    expect(registerPrimaryClick('a')).toBe(false);
    now.mockReturnValue(1400);
    expect(registerPrimaryClick('b')).toBe(false);
    now.mockReturnValue(1900);
    expect(registerPrimaryClick('b')).toBe(false);
    resetDoubleClick();
    now.mockReturnValue(1950);
    expect(registerPrimaryClick('b')).toBe(false);
  });

  it('suppresses taps after a pinch or long-press until the next touch starts', () => {
    allowTaps();
    expect(tapsSuppressed()).toBe(false);
    suppressTaps();
    expect(tapsSuppressed()).toBe(true);
    allowTaps();
    expect(tapsSuppressed()).toBe(false);
  });
});
