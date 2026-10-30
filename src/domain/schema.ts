import { z } from 'zod';
import { HOLDER_SHAPES, MAX_TIMER_SECONDS, MAX_TOKEN_STACK, SCHEMA_VERSION, TOKEN_SHAPES, type Game, type TabletopObject } from './types';

const finite = z.number().refine(Number.isFinite, 'Must be a finite number');
const positive = finite.refine((n) => n > 0, 'Must be positive');
const id = z.string().min(1).max(200);
const assetRef = id.optional();
const color = z.string().max(64);
const vec2 = z.object({ x: finite, y: finite });

const base = {
  id,
  name: z.string().max(500),
  position: vec2,
  width: positive,
  height: positive,
  rotation: finite,
  zIndex: finite,
  locked: z.boolean(),
  visible: z.boolean(),
  hoverZoom: z.enum(['off', 'small', 'medium', 'large', 'xlarge']).optional(),
  hoverRotate: z.boolean().optional(),
  rotations: z
    .array(z.number().refine((n) => n >= 0 && n < 360 && n % 45 === 0, 'Must be a multiple of 45° below 360°'))
    .min(1)
    .max(8)
    .optional(),
  bagId: id.optional(),
};

export const cardDefSchema = z.object({
  id,
  name: z.string().max(500),
  faceAssetId: assetRef,
  faceText: z.string().max(2000),
  faceColor: color,
  backAssetId: assetRef,
  backColor: color.optional(),
  width: positive.optional(),
  height: positive.optional(),
  faceUp: z.boolean().optional(),
});

const objectIds = z.array(id).max(500);

export const stepSchema = z.discriminatedUnion('type', [
  z.object({
    id,
    objectIds,
    type: z.literal('move'),
    targetIds: objectIds,
    deckMode: z.enum(['top', 'bottom']),
    count: z.number().int().positive().max(5000).optional(),
    orientation: z.enum(['keep', 'faceUp', 'faceDown']),
  }),
  z.object({
    id,
    objectIds,
    type: z.literal('recall'),
    rotation: z.enum(['reset', 'keep']).optional(),
    orientation: z.enum(['keep', 'faceUp', 'faceDown']).optional(),
    shuffle: z.boolean().optional(),
  }),
  z.object({ id, objectIds, type: z.literal('rotate'), mode: z.enum(['by', 'to']), degrees: finite }),
  z.object({
    id,
    objectIds,
    type: z.literal('flip'),
    mode: z.enum(['toggle', 'faceUp', 'faceDown', 'random']),
    count: z.number().int().positive().max(5000).optional(),
  }),
  z.object({ id, objectIds, type: z.literal('shuffle') }),
  z.object({ id, objectIds, type: z.literal('sort'), by: z.enum(['original', 'name', 'reverse']) }),
  z.object({
    id,
    objectIds,
    type: z.literal('pick'),
    targetIds: objectIds,
    orientation: z.enum(['keep', 'faceUp', 'faceDown']),
    choose: z.enum(['edit', 'run']).optional(),
    cards: z.record(id, z.array(id).max(5000)).optional(),
  }),
  z.object({
    id,
    objectIds,
    type: z.literal('roll'),
    mode: z.enum(['roll', 'set']).optional(),
    value: z.number().int().min(1).max(1000).optional(),
  }),
  z.object({ id, objectIds, type: z.literal('counter'), mode: z.enum(['add', 'set']), amount: finite }),
  z.object({ id, objectIds, type: z.literal('check'), mode: z.enum(['toggle', 'check', 'uncheck']) }),
  z.object({ id, objectIds, type: z.literal('timer'), mode: z.enum(['start', 'pause', 'toggle', 'reset', 'restart']) }),
]);

const imageSchema = z.object({ ...base, kind: z.literal('image'), assetId: assetRef });

const cardSchema = z.object({
  ...base,
  kind: z.literal('card'),
  faceUp: z.boolean(),
  faceAssetId: assetRef,
  backAssetId: assetRef,
  faceText: z.string().max(2000),
  faceColor: color,
  backColor: color,
  sourceDeckId: id.optional(),
  cardDefId: id.optional(),
});

const deckSchema = z.object({
  ...base,
  kind: z.literal('deck'),
  cards: z.array(cardDefSchema).max(5000),
  initialCards: z.array(cardDefSchema).max(5000),
  backAssetId: assetRef,
  backColor: color,
  drawSide: z.enum(['keep', 'faceUp', 'faceDown']),
  putSide: z.enum(['keep', 'faceUp', 'faceDown']).optional(),
  individualBacks: z.boolean().optional(),
  isPile: z.boolean(),
  layout: z.enum(['stack', 'spread']).optional(),
  spreadAlign: z.enum(['start', 'center', 'end']).optional(),
  color: color.optional(),
  strokeColor: color.optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  strokeOpacity: z.number().min(0).max(1).optional(),
  strokeStyle: z.enum(['dashed', 'solid']).optional(),
  zoneShape: z.enum(HOLDER_SHAPES).optional(),
  snapToCenter: z.boolean().optional(),
  cardRotation: z.number().min(0).lt(360).optional(),
  cardTurn: z.number().min(0).lt(360).optional(),
  label: z.string().max(500).optional(),
  labelPosition: z.enum(['above', 'below']).optional(),
  alignRotation: z.boolean().optional(),
  playMovable: z.boolean().optional(),
  cardWidth: positive.optional(),
  cardHeight: positive.optional(),
});

const tokenSchema = z.object({
  ...base,
  kind: z.literal('token'),
  shape: z.enum(TOKEN_SHAPES),
  color,
  assetId: assetRef,
  count: z.number().int().min(1).max(MAX_TOKEN_STACK).optional(),
  sourceId: id.optional(),
});

const counterSchema = z.object({
  ...base,
  kind: z.literal('counter'),
  label: z.string().max(500),
  value: finite,
  min: finite.nullable(),
  max: finite.nullable(),
  step: positive,
  color,
});

const dieSchema = z.object({
  ...base,
  kind: z.literal('die'),
  sides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12), z.literal(20)]),
  value: finite,
  color,
  pipColor: color,
  rollCount: finite,
  faces: z
    .array(z.object({ id, label: z.string().max(200), assetId: assetRef }))
    .max(100)
    .optional(),
});

const labelSchema = z.object({
  ...base,
  kind: z.literal('label'),
  text: z.string().max(10000),
  fontSize: positive,
  color,
  background: color.nullable(),
  align: z.enum(['left', 'center', 'right']),
});

const bagItemSchema = z.discriminatedUnion('kind', [
  cardSchema,
  deckSchema,
  tokenSchema,
  counterSchema,
  dieSchema,
  labelSchema,
  imageSchema,
]);

export const objectSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('board'), assetId: assetRef, fill: color, playMovable: z.boolean().optional() }),
  imageSchema,
  cardSchema,
  deckSchema,
  tokenSchema,
  counterSchema,
  dieSchema,
  labelSchema,
  z.object({
    ...base,
    kind: z.literal('bag'),
    items: z.array(bagItemSchema).max(5000),
    color,
    playMovable: z.boolean().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal('checkbox'),
    checked: z.boolean(),
    mark: z.enum(['check', 'cross', 'dot', 'fill']),
    boxShape: z.enum(['square', 'circle', 'none']),
    color,
    boxColor: color,
    boxFill: color.nullable(),
  }),
  z.object({
    ...base,
    kind: z.literal('timer'),
    label: z.string().max(500),
    mode: z.enum(['countdown', 'stopwatch']),
    duration: finite.refine((n) => n >= 0 && n <= MAX_TIMER_SECONDS, 'Invalid timer duration'),
    color,
    textColor: color,
    elapsedMs: finite.refine((n) => n >= 0, 'Must not be negative'),
    startedAt: finite.optional(),
    sound: z.boolean(),
  }),
  z.object({
    ...base,
    kind: z.literal('button'),
    label: z.string().max(500),
    color,
    textColor: color,
    fontSize: positive.optional(),
    steps: z.array(stepSchema).max(100),
  }),
]);

export const strokeSchema = z.object({
  id,
  points: z.array(finite).max(200000),
  color,
  width: positive,
  opacity: finite,
  objectId: id.optional(),
  straight: z.boolean().optional(),
});

export const textAnnotationSchema = z.object({
  id,
  position: vec2,
  text: z.string().max(10000),
  fontSize: positive,
  color,
  objectId: id.optional(),
});

export const annotationsSchema = z.object({
  strokes: z.array(strokeSchema).max(20000),
  text: z.array(textAnnotationSchema).max(5000),
});

export const cameraSchema = z.object({ x: finite, y: finite, scale: positive });

export const gameSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  title: z.string().max(500),
  createdAt: z.string().max(64),
  updatedAt: z.string().max(64),
  objects: z.array(objectSchema).max(10000),
  camera: cameraSchema,
  annotations: annotationsSchema,
  tableColor: color.optional(),
  thumbnail: z.string().max(2_000_000).optional(),
  lastPlayedAt: z.string().max(64).optional(),
});

// Compile-time guarantees that schemas and TS types stay in sync.
type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type _ObjectSchemaMatches = Assert<Same<z.infer<typeof objectSchema>, TabletopObject>>;
export type _GameSchemaMatches = Assert<Same<z.infer<typeof gameSchema>, Game>>;

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Renames fields of earlier test builds that would otherwise be dropped silently (unknown keys are stripped):
 * a move step's single `targetId` and a holder's `cardsSideways`.
 */
function renameOldFields(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { objects?: unknown }).objects)) return raw;
  const objects = (raw as { objects: unknown[] }).objects.map((o) => {
    if (!o || typeof o !== 'object') return o;
    const obj = o as Record<string, unknown>;
    if (obj.kind === 'deck' && 'cardsSideways' in obj) {
      const { cardsSideways, ...rest } = obj;
      return cardsSideways === true && rest.cardRotation === undefined ? { ...rest, cardRotation: 90 } : rest;
    }
    if (obj.kind === 'button' && Array.isArray(obj.steps)) {
      const steps = obj.steps.map((s) => {
        if (!s || typeof s !== 'object' || (s as { type?: unknown }).type !== 'move' || 'targetIds' in s) return s;
        const { targetId, ...rest } = s as Record<string, unknown>;
        return { ...rest, targetIds: typeof targetId === 'string' ? [targetId] : [] };
      });
      return { ...obj, steps };
    }
    return o;
  });
  return { ...raw, objects };
}

/** Validates a stored or imported record into a Game. */
export function parseGame(raw: unknown): Game {
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw) {
    const v = (raw as { schemaVersion: unknown }).schemaVersion;
    if (typeof v === 'number' && v > SCHEMA_VERSION) {
      throw new SchemaError(`This file was created by a newer version of Tablenox (schema v${v}).`);
    }
    if (v !== SCHEMA_VERSION) throw new SchemaError(`Unsupported schema version: ${String(v)}`);
  }
  const r = gameSchema.safeParse(renameOldFields(raw));
  if (!r.success) throw new SchemaError(`Invalid game: ${formatIssues(r.error)}`);
  return r.data;
}
