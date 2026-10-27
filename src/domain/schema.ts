import { z } from 'zod';
import { MAX_TOKEN_STACK, SCHEMA_VERSION, type Game, type TabletopObject } from './types';

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
    targetId: id.optional(),
    deckMode: z.enum(['top', 'bottom']),
    count: z.number().int().positive().max(5000).optional(),
    orientation: z.enum(['keep', 'faceUp', 'faceDown']),
  }),
  z.object({ id, objectIds, type: z.literal('recall') }),
  z.object({ id, objectIds, type: z.literal('rotate'), mode: z.enum(['by', 'to']), degrees: finite }),
  z.object({ id, objectIds, type: z.literal('flip'), mode: z.enum(['toggle', 'faceUp', 'faceDown']) }),
  z.object({ id, objectIds, type: z.literal('shuffle') }),
  z.object({ id, objectIds, type: z.literal('sort'), by: z.enum(['original', 'name']) }),
  z.object({ id, objectIds, type: z.literal('roll') }),
  z.object({ id, objectIds, type: z.literal('counter'), mode: z.enum(['add', 'set']), amount: finite }),
  z.object({ id, objectIds, type: z.literal('check'), mode: z.enum(['toggle', 'check', 'uncheck']) }),
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
  individualBacks: z.boolean().optional(),
  isPile: z.boolean(),
  layout: z.enum(['stack', 'spread']).optional(),
  color: color.optional(),
  strokeColor: color.optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  strokeOpacity: z.number().min(0).max(1).optional(),
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
  shape: z.enum(['circle', 'square', 'triangle', 'star', 'hexagon']),
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
});

export const textAnnotationSchema = z.object({
  id,
  position: vec2,
  text: z.string().max(10000),
  fontSize: positive,
  color,
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

/** Validates a stored or imported record into a Game. */
export function parseGame(raw: unknown): Game {
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw) {
    const v = (raw as { schemaVersion: unknown }).schemaVersion;
    if (typeof v === 'number' && v > SCHEMA_VERSION) {
      throw new SchemaError(`This file was created by a newer version of Tablenox (schema v${v}).`);
    }
    if (v !== SCHEMA_VERSION) throw new SchemaError(`Unsupported schema version: ${String(v)}`);
  }
  const r = gameSchema.safeParse(raw);
  if (!r.success) throw new SchemaError(`Invalid game: ${formatIssues(r.error)}`);
  return r.data;
}
