export type ObjectId = string;
export type Vec2 = { x: number; y: number };

export const SCHEMA_VERSION = 1 as const;

/** Size of the enlarged preview shown while hovering an object. `off` disables it explicitly. */
export type HoverZoom = 'off' | 'small' | 'medium' | 'large' | 'xlarge';
export const HOVER_ZOOM_SIZES: HoverZoom[] = ['off', 'small', 'medium', 'large', 'xlarge'];

export interface BaseObject {
  id: ObjectId;
  kind: ObjectKind;
  name: string;
  /** Top-left corner of the unrotated bounding box, in world units. Rotation is about the centre. */
  position: Vec2;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  /** Zoom on hover. Missing means off (cards: same as the deck they belong to). */
  hoverZoom?: HoverZoom;
  /** Bag this object was last put into or drawn from; "recall" sends it back there. */
  bagId?: ObjectId;
}

export interface BoardObject extends BaseObject {
  kind: 'board';
  assetId?: string;
  fill: string;
  /** Boards only move in Edit mode unless this is set. */
  playMovable?: boolean;
}

export interface ImageObject extends BaseObject {
  kind: 'image';
  assetId?: string;
}

/** A card stored inside a deck or pile (not on the table). */
export interface CardDef {
  id: string;
  name: string;
  faceAssetId?: string;
  faceText: string;
  faceColor: string;
  /** Back of this particular card; falls back to the back of the deck that owns its definition. */
  backAssetId?: string;
  backColor?: string;
  /** Card size when it differs from its owning deck (or it has none); otherwise the owner's size is used. */
  width?: number;
  height?: number;
  /** Side the card lies on inside a holder or pile. Undefined means face down. */
  faceUp?: boolean;
}

export interface CardObject extends BaseObject {
  kind: 'card';
  faceUp: boolean;
  faceAssetId?: string;
  backAssetId?: string;
  faceText: string;
  faceColor: string;
  backColor: string;
  /** Deck this card was last drawn from. */
  sourceDeckId?: ObjectId;
  cardDefId?: string;
}

export type HolderLayout = 'stack' | 'spread';

/** `keep`: a card comes out as it lies (cards without a stored side lie face down). */
export type DrawSide = 'keep' | 'faceUp' | 'faceDown';

/**
 * A holder: a zone on the table that the cards live in (a "deck" is a holder with cards). Its cards are shown
 * stacked (drag draws the top card) or spread side by side (drag takes any card). A **pile** (`isPile`) is a
 * loose stack without a zone, created by dropping a card on a card; it disappears when empty.
 */
export interface DeckObject extends BaseObject {
  kind: 'deck';
  /** Cards currently in the holder. Index 0 is the TOP (in a spread: the right-most card). */
  cards: CardDef[];
  /** Full, ordered card definition used by Reset (empty for piles and plain holders). */
  initialCards: CardDef[];
  backAssetId?: string;
  backColor: string;
  /** Side a card comes out with when taken from the holder: as it lies (default), or always face up / face down. */
  drawSide: DrawSide;
  /** When true, every card may carry its own back (image/colour) instead of the shared deck back. */
  individualBacks?: boolean;
  /** Piles are created by dropping a card on a card and disappear when empty. */
  isPile: boolean;
  /** How the cards are shown. Missing means `stack`. */
  layout?: HolderLayout;
  /** Zone fill colour; missing means grey. */
  color?: string;
  /** Zone outline colour; missing means the fill colour. */
  strokeColor?: string;
  /** Opacity (0–1) of the zone fill; missing means `DEFAULT_HOLDER_FILL_OPACITY`. */
  fillOpacity?: number;
  /** Opacity (0–1) of the zone outline; missing means fully opaque. */
  strokeOpacity?: number;
  /** Text shown next to the zone; empty means no text. */
  label?: string;
  /** Where the label sits relative to the zone; missing means above. */
  labelPosition?: 'above' | 'below';
  /** Objects dropped onto the holder take on its rotation. */
  alignRotation?: boolean;
  /** Holders only move in Edit mode unless this is set (piles always move). */
  playMovable?: boolean;
  /** Size of the cards this holder owns; missing means the holder's own size. */
  cardWidth?: number;
  cardHeight?: number;
}

export type TokenShape = 'circle' | 'square' | 'triangle' | 'star' | 'hexagon';

export interface TokenObject extends BaseObject {
  kind: 'token';
  shape: TokenShape;
  color: string;
  assetId?: string;
  /** Number of identical tokens in this stack (shown with a count badge); missing means one. */
  count?: number;
  /** Stack this token was taken off; "recall" puts it back there. */
  sourceId?: ObjectId;
}

export const MAX_TOKEN_STACK = 999;

export interface CounterObject extends BaseObject {
  kind: 'counter';
  label: string;
  value: number;
  min: number | null;
  max: number | null;
  step: number;
  color: string;
}

export type DieSides = 4 | 6 | 8 | 10 | 12 | 20;
export const DIE_SIDES: DieSides[] = [4, 6, 8, 10, 12, 20];

/** One face of a custom die. */
export interface DieFace {
  id: string;
  label: string;
  assetId?: string;
}

export interface DieObject extends BaseObject {
  kind: 'die';
  /** Number of sides of a standard (numbered) die. Ignored when `faces` is non-empty. */
  sides: DieSides;
  /** 1-based index of the face currently shown. */
  value: number;
  color: string;
  pipColor: string;
  /** Incremented on every roll, so the renderer can animate even if the value repeats. */
  rollCount: number;
  /** Custom faces (images and/or labels). Empty or missing means a standard numbered die. */
  faces?: DieFace[];
}

export interface LabelObject extends BaseObject {
  kind: 'label';
  text: string;
  fontSize: number;
  color: string;
  background: string | null;
  align: 'left' | 'center' | 'right';
}

/** What a checked checkbox shows. */
export type CheckMark = 'check' | 'cross' | 'dot' | 'fill';
export const CHECK_MARKS: CheckMark[] = ['check', 'cross', 'dot', 'fill'];
/** The box drawn around the mark; `none` shows only the mark (e.g. to tick boxes printed on a sheet). */
export type CheckboxShape = 'square' | 'circle' | 'none';

/** A checkbox: a click in Play mode checks / unchecks it. */
export interface CheckboxObject extends BaseObject {
  kind: 'checkbox';
  checked: boolean;
  mark: CheckMark;
  boxShape: CheckboxShape;
  /** Colour of the mark. */
  color: string;
  /** Colour of the box outline. */
  boxColor: string;
  /** Box background; null means transparent. */
  boxFill: string | null;
}

/** What a bag can hold: loose pieces (and piles), never boards, buttons, holders or other bags. */
export type BagItem = CardObject | DeckObject | TokenObject | CounterObject | DieObject | LabelObject | ImageObject;

/**
 * A bag: a container that holds cards, piles, tokens, dice and the like out of sight. Pieces go in by being
 * dropped on it, come out by drawing (random from the pieces, or top/bottom of the order), and a bag can be
 * shuffled and recalled. Stored items keep their ids, so they come back as the very same objects.
 */
export interface BagObject extends BaseObject {
  kind: 'bag';
  /** Index 0 is the top. */
  items: BagItem[];
  color: string;
  /** Bags only move in Edit mode unless this is set. */
  playMovable?: boolean;
}

export type StepOrientation = 'keep' | 'faceUp' | 'faceDown';
export type DeckMoveMode = 'top' | 'bottom';
export type RotateMode = 'by' | 'to';
export type FlipMode = 'toggle' | 'faceUp' | 'faceDown';
export type SortBy = 'original' | 'name';
export type CounterMode = 'add' | 'set';

interface StepBase {
  id: string;
  /** Targets of the step. A holder stands for its own cards plus the pieces lying on it. */
  objectIds: ObjectId[];
}

/** Moves objects (or cards out of holders/piles) onto a destination object. */
export interface MoveStep extends StepBase {
  type: 'move';
  /** Holder, pile or any other object the items are moved onto. */
  targetId?: ObjectId;
  /** Holders/piles give up cards from their top or bottom (the holder itself never moves). */
  deckMode: DeckMoveMode;
  /** Number of cards taken from each holder/pile; missing means all of them. */
  count?: number;
  orientation: StepOrientation;
}

/** Sends cards back to their deck and gathers decks (like "Gather & reset"). */
export interface RecallStep extends StepBase {
  type: 'recall';
}

export interface RotateStep extends StepBase {
  type: 'rotate';
  mode: RotateMode;
  degrees: number;
}

export interface FlipStep extends StepBase {
  type: 'flip';
  mode: FlipMode;
}

export interface ShuffleStep extends StepBase {
  type: 'shuffle';
}

export interface SortStep extends StepBase {
  type: 'sort';
  by: SortBy;
}

export interface RollStep extends StepBase {
  type: 'roll';
}

export interface CounterStep extends StepBase {
  type: 'counter';
  mode: CounterMode;
  amount: number;
}

export type CheckMode = 'toggle' | 'check' | 'uncheck';

/** Checks, unchecks or toggles checkboxes (a board or holder stands for the checkboxes lying on it). */
export interface CheckStep extends StepBase {
  type: 'check';
  mode: CheckMode;
}

export type ButtonStep = MoveStep | RecallStep | RotateStep | FlipStep | ShuffleStep | SortStep | RollStep | CounterStep | CheckStep;
export type StepType = ButtonStep['type'];

/** An automation button: clicking it in Play mode runs its steps in order, as one undo step. */
export interface ButtonObject extends BaseObject {
  kind: 'button';
  label: string;
  color: string;
  textColor: string;
  /** Label font size; missing means "fit the button". The label always shrinks to fit. */
  fontSize?: number;
  steps: ButtonStep[];
}

export type TabletopObject =
  | BoardObject
  | ImageObject
  | CardObject
  | DeckObject
  | TokenObject
  | CounterObject
  | DieObject
  | LabelObject
  | ButtonObject
  | BagObject
  | CheckboxObject;

export type ObjectKind = TabletopObject['kind'];

export type ObjectOfKind<K extends ObjectKind> = Extract<TabletopObject, { kind: K }>;

export interface CameraState {
  /** Screen translation in CSS pixels. */
  x: number;
  y: number;
  scale: number;
}

export interface InkStroke {
  id: string;
  /** x1,y1,x2,y2,... in WORLD units */
  points: number[];
  color: string;
  width: number;
  opacity: number;
}

export interface TextAnnotation {
  id: string;
  position: Vec2;
  text: string;
  fontSize: number;
  color: string;
}

export interface Annotations {
  strokes: InkStroke[];
  text: TextAnnotation[];
}

/** The undoable, serialisable state of a game table. */
export interface TableState {
  objects: TabletopObject[];
  annotations: Annotations;
}

export type AssetMimeType = 'image/png' | 'image/jpeg' | 'image/webp';
export const ASSET_MIME_TYPES: AssetMimeType[] = ['image/png', 'image/jpeg', 'image/webp'];

export interface StoredAsset {
  id: string;
  name: string;
  mimeType: AssetMimeType;
  sizeBytes: number;
  blob: Blob;
  createdAt: string;
}

/** A game is a single saved document; Edit and Play mode both work on it. */
export interface Game {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  objects: TabletopObject[];
  camera: CameraState;
  annotations: Annotations;
  /** Table (background) colour; default felt colour when missing. */
  tableColor?: string;
  thumbnail?: string;
}

export type Mode = 'edit' | 'play';
