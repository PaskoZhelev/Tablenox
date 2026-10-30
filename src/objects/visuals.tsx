import { useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Circle, Ellipse, Group, Image as KImage, Line, Path, Rect, RegularPolygon, Star, Text } from 'react-konva';
import { cardTextColor } from '../domain/cards';
import {
  bagCount,
  DEFAULT_HOLDER_COLOR,
  DEFAULT_HOLDER_FILL_OPACITY,
  DEFAULT_HOLDER_STROKE_OPACITY,
  DIE_PIP_LAYOUT,
  ownerDeckOf,
  ownerDecksById,
  resolveCardLook,
  tokenCount,
} from '../domain/objects';
import { useShallow } from 'zustand/react/shallow';
import { cardRotationOf, isSpread, spreadLayout } from '../domain/rules';
import { BUTTON_LABEL_PADDING, buttonMaxFontSize, fitFontSize } from '../domain/buttons';
import { holderShapePoints } from '../domain/geometry';
import { isTimerRunning, timerFinished, timerText } from '../domain/timer';
import { beep } from './beep';
import type {
  BagObject,
  BoardObject,
  ButtonObject,
  CardObject,
  CheckboxObject,
  CounterObject,
  DeckObject,
  DieObject,
  HolderShape,
  ImageObject,
  LabelObject,
  Mode,
  TabletopObject,
  TimerObject,
  TokenObject,
  TokenShape,
} from '../domain/types';
import { useTableStore } from '../state/tableStore';
import { tapsSuppressed } from '../canvas/touch';
import { loadAssetImage, useAssetImage, useCrispImage, useShapedImage } from './useAssetImage';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** A card image that is still loading. */
const LOADING_FILL = '#d5d9df';
/** Edge of a stack whose cards have a back image (their back colour isn't what the player sees). */
const IMAGE_STACK_EDGE_FILL = '#5d636c';

function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, ((n >> shift) & 255) + amount));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function Placeholder({ w, h, text, fill = '#e9e4d6' }: { w: number; h: number; text: string; fill?: string }) {
  return (
    <>
      <Rect width={w} height={h} fill={fill} stroke="#b9b29f" strokeWidth={2} dash={[10, 6]} />
      <Text
        width={w}
        height={h}
        text={text}
        align="center"
        verticalAlign="middle"
        fontFamily={FONT}
        fontSize={Math.max(12, Math.min(28, w / 16))}
        fill="#7a7466"
        padding={8}
      />
    </>
  );
}

export function BoardVisual({ o, mode }: { o: BoardObject; mode: Mode }) {
  const img = useCrispImage(o.assetId, o.width, o.height);
  if (img) return <KImage image={img} width={o.width} height={o.height} />;
  return o.assetId ? (
    <Placeholder w={o.width} h={o.height} text="Loading image…" fill={o.fill} />
  ) : mode === 'edit' ? (
    <Placeholder w={o.width} h={o.height} text="Board / sheet — choose an image in the inspector" fill={o.fill} />
  ) : (
    <Rect width={o.width} height={o.height} fill={o.fill} />
  );
}

export function ImageVisual({ o }: { o: ImageObject }) {
  const img = useCrispImage(o.assetId, o.width, o.height);
  if (img) return <KImage image={img} width={o.width} height={o.height} />;
  return <Placeholder w={o.width} h={o.height} text={o.assetId ? 'Loading image…' : 'Choose an image in the inspector'} />;
}

interface CardFaceProps {
  w: number;
  h: number;
  faceUp: boolean;
  faceAssetId?: string;
  backAssetId?: string;
  faceText: string;
  faceColor: string;
  backColor: string;
}

/** Shadow under a card; an irregularly shaped card casts it from its image, so it follows the shape. */
const CARD_SHADOW = { shadowColor: '#000', shadowBlur: 6, shadowOpacity: 0.25, shadowOffsetY: 2 };

function CardBack({
  w,
  h,
  backAssetId,
  backColor,
  shaped,
}: Pick<CardFaceProps, 'w' | 'h' | 'backAssetId' | 'backColor'> & { shaped?: boolean }) {
  const img = useCrispImage(backAssetId, w, h);
  const r = Math.min(w, h) * 0.07;
  if (img) {
    return shaped ? <KImage image={img} width={w} height={h} {...CARD_SHADOW} /> : <KImage image={img} width={w} height={h} cornerRadius={r} />;
  }
  // A back image that is still loading: a plain card, not the default back design, so it never flashes up.
  if (backAssetId) return <Rect width={w} height={h} cornerRadius={r} fill={LOADING_FILL} />;
  const inset = Math.min(w, h) * 0.08;
  return (
    <>
      <Rect width={w} height={h} cornerRadius={r} fill={backColor} />
      <Rect
        x={inset}
        y={inset}
        width={w - inset * 2}
        height={h - inset * 2}
        cornerRadius={r * 0.6}
        stroke="rgba(255,255,255,0.55)"
        strokeWidth={2}
      />
      <RegularPolygon x={w / 2} y={h / 2} sides={4} radius={Math.min(w, h) * 0.22} stroke="rgba(255,255,255,0.55)" strokeWidth={2} />
    </>
  );
}

function CardFront({
  w,
  h,
  faceAssetId,
  faceText,
  faceColor,
  shaped,
}: Pick<CardFaceProps, 'w' | 'h' | 'faceAssetId' | 'faceText' | 'faceColor'> & { shaped?: boolean }) {
  const img = useCrispImage(faceAssetId, w, h);
  const r = Math.min(w, h) * 0.07;
  if (img) {
    return shaped ? <KImage image={img} width={w} height={h} {...CARD_SHADOW} /> : <KImage image={img} width={w} height={h} cornerRadius={r} />;
  }
  if (faceAssetId) return <Rect width={w} height={h} cornerRadius={r} fill={LOADING_FILL} />;
  const color = cardTextColor(faceText);
  const short = faceText.length <= 4;
  return (
    <>
      <Rect width={w} height={h} cornerRadius={r} fill={faceColor} />
      {short && faceText && (
        <>
          <Text
            x={w * 0.07}
            y={h * 0.05}
            text={faceText}
            fontFamily={FONT}
            fontStyle="bold"
            fontSize={Math.min(w, h) * 0.16}
            fill={color}
          />
          <Text
            x={w * 0.93}
            y={h * 0.95}
            rotation={180}
            text={faceText}
            fontFamily={FONT}
            fontStyle="bold"
            fontSize={Math.min(w, h) * 0.16}
            fill={color}
          />
        </>
      )}
      <Text
        width={w}
        height={h}
        padding={w * 0.1}
        text={faceText}
        align="center"
        verticalAlign="middle"
        fontFamily={FONT}
        fontStyle="bold"
        fontSize={short ? Math.min(w, h) * 0.32 : Math.min(w, h) * 0.13}
        fill={color}
        wrap="word"
      />
    </>
  );
}

export function CardVisual(p: CardFaceProps) {
  const r = Math.min(p.w, p.h) * 0.07;
  const shaped = useShapedImage(p.faceUp ? p.faceAssetId : p.backAssetId);
  if (shaped) return p.faceUp ? <CardFront {...p} shaped /> : <CardBack {...p} shaped />;
  return (
    <>
      <Rect
        width={p.w}
        height={p.h}
        cornerRadius={r}
        fill="#fff"
        {...CARD_SHADOW}
      />
      {p.faceUp ? <CardFront {...p} /> : <CardBack {...p} />}
      <Rect width={p.w} height={p.h} cornerRadius={r} stroke="rgba(0,0,0,0.25)" strokeWidth={1} listening={false} />
    </>
  );
}

export function CardObjectVisual({ o }: { o: CardObject }) {
  return (
    <CardVisual
      w={o.width}
      h={o.height}
      faceUp={o.faceUp}
      faceAssetId={o.faceAssetId}
      backAssetId={o.backAssetId}
      faceText={o.faceText}
      faceColor={o.faceColor}
      backColor={o.backColor}
    />
  );
}

/** Offset of the single edge drawn under a stack of cards, in world units. */
const STACK_EDGE = 1.5;

/** Edit mode draws holder outlines at least this opaque, so faint (Play-mode) outlines stay visible over the grid. */
const EDIT_MIN_STROKE_OPACITY = 0.85;

/**
 * A holder's zone shape filling a `w` x `h` box at `x`,`y` (rounded rectangle, circle / ellipse or polygon), with
 * whatever fill / stroke props it is given.
 */
export function HolderZoneShape({
  shape,
  x = 0,
  y = 0,
  w,
  h,
  cornerRadius = 10,
  ...style
}: {
  shape: HolderShape | undefined;
  x?: number;
  y?: number;
  w: number;
  h: number;
  cornerRadius?: number;
  name?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  opacity?: number;
  strokeScaleEnabled?: boolean;
  listening?: boolean;
}) {
  if (shape === 'circle') return <Ellipse x={x + w / 2} y={y + h / 2} radiusX={w / 2} radiusY={h / 2} {...style} />;
  const points = holderShapePoints(shape, w, h);
  if (points) return <Line x={x} y={y} points={points} closed lineJoin="round" {...style} />;
  return <Rect x={x} y={y} width={w} height={h} cornerRadius={cornerRadius} {...style} />;
}

/**
 * A holder's zone: fill, dashed / solid outline, label and (Edit mode) its deck size. Drawn by its own node under the
 * cards of every holder on the same board (`HolderZoneNode`); `ghost` draws it invisible and not hittable, so the
 * holder's own node keeps its full size (for the Transformer).
 */
export function HolderZoneVisual({ o, mode, ghost }: { o: DeckObject; mode: Mode; ghost?: boolean }) {
  const w = o.width;
  const h = o.height;
  const edit = mode === 'edit';
  const zone = o.color ?? DEFAULT_HOLDER_COLOR;
  const labelBelow = o.labelPosition === 'below';
  const strokeOpacity = o.strokeOpacity ?? DEFAULT_HOLDER_STROKE_OPACITY;
  const showBadge = o.cards.length > 1;
  // Edit mode: a holder with its own card list (a deck) says so below the zone (under its label when that is below).
  const deckSize = edit ? o.initialCards.length : 0;
  return (
    <Group opacity={ghost ? 0 : 1} listening={!ghost}>
      <HolderZoneShape shape={o.zoneShape} w={w} h={h} fill={zone} opacity={o.fillOpacity ?? DEFAULT_HOLDER_FILL_OPACITY} />
      <HolderZoneShape
        shape={o.zoneShape}
        w={w}
        h={h}
        stroke={o.strokeColor ?? zone}
        strokeWidth={2}
        dash={o.strokeStyle === 'solid' ? undefined : [10, 6]}
        opacity={edit ? Math.max(strokeOpacity, EDIT_MIN_STROKE_OPACITY) : strokeOpacity}
      />
      {o.label && (
        <Text
          x={4}
          y={labelBelow ? h + 4 : -20}
          width={Math.max(0, w - 8 - (!labelBelow && showBadge ? 44 : 0))}
          text={o.label}
          ellipsis
          wrap="none"
          fontFamily={FONT}
          fontSize={14}
          fontStyle="bold"
          fill={zone}
        />
      )}
      {deckSize > 0 && (
        <Text
          name="deck-info"
          x={4}
          y={h + 4 + (labelBelow && o.label ? 18 : 0)}
          width={Math.max(0, w - 8)}
          text={`Deck (${deckSize} ${deckSize === 1 ? 'card' : 'cards'})`}
          ellipsis
          wrap="none"
          fontFamily={FONT}
          fontSize={12}
          fontStyle="italic"
          fill={zone}
          listening={false}
        />
      )}
    </Group>
  );
}

/** `zone`: `shown` draws the holder's zone too (previews); `ghost` leaves it to its own node (the table). */
export function DeckVisual({ o, mode, zone = 'shown' }: { o: DeckObject; mode: Mode; zone?: 'shown' | 'ghost' }) {
  const count = o.cards.length;
  const w = o.width;
  // Only the decks owning the cards shown here matter (their card size and back), so other table changes don't
  // re-render every holder and pile.
  const owners = useTableStore(
    useShallow((s) => {
      const byId = ownerDecksById(s.history.present.objects);
      return [...new Set(o.cards.map((c) => byId.get(c.id)).filter((d): d is DeckObject => !!d))];
    }),
  );
  const objects: TabletopObject[] = owners;
  const gapAt = useTableStore((s) => (s.dropTargetId === o.id ? s.dropIndex : null));
  const holder = !o.isPile;
  const showBadge = count > 1;
  const { slots, gap } = spreadLayout(objects, o, gapAt);
  const turn = cardRotationOf(o);
  // A stack of two or more cards gets one thin edge underneath, whatever its size.
  const stacked = slots.length === 1 && !isSpread(o) && count > 1;
  const lookOf = (i: number) => resolveCardLook(o.cards[i], o, ownerDeckOf(objects, o.cards[i].id));
  // The edge drawn under a stack is a rectangle, so it is left out for irregularly shaped cards.
  const shapedStack = useShapedImage(stacked ? lookOf(0).backAssetId : undefined);
  // Decode the images that can come to the top (a shuffle, sort, draw or flip) before they are needed: the side every
  // card lies on, plus the other side of the top and bottom cards. Otherwise a newly shown card is blank for a moment.
  const preload = [
    ...new Set(
      o.cards.flatMap((c, i) => {
        const back = lookOf(i).backAssetId;
        const shown = c.faceUp === true ? c.faceAssetId : back;
        const other = i === 0 || i === count - 1 ? (c.faceUp === true ? back : c.faceAssetId) : undefined;
        return [shown, other].filter((id): id is string => !!id);
      }),
    ),
  ].join('|');
  useEffect(() => {
    for (const id of preload ? preload.split('|') : []) loadAssetImage(id).catch(() => undefined);
  }, [preload]);
  return (
    <>
      {holder && <HolderZoneVisual o={o} mode={mode} ghost={zone === 'ghost'} />}
      {stacked && !shapedStack && (
        <Group
          x={slots[0].x + slots[0].width / 2 + STACK_EDGE}
          y={slots[0].y + slots[0].height / 2 + STACK_EDGE}
          rotation={turn}
          offsetX={lookOf(0).width / 2}
          offsetY={lookOf(0).height / 2}
          listening={false}
        >
          <Rect
            width={lookOf(0).width}
            height={lookOf(0).height}
            cornerRadius={Math.min(lookOf(0).width, lookOf(0).height) * 0.07}
            fill={lookOf(0).backAssetId ? IMAGE_STACK_EDGE_FILL : shade(lookOf(0).backColor, -30)}
            stroke="rgba(0,0,0,0.3)"
            strokeWidth={1}
          />
        </Group>
      )}
      {gap && (
        <Rect
          name="drop-gap"
          x={gap.x}
          y={gap.y}
          width={gap.width}
          height={gap.height}
          cornerRadius={Math.min(gap.width, gap.height) * 0.07}
          fill="rgba(244,197,66,0.25)"
          stroke="#f4c542"
          strokeWidth={2}
          dash={[8, 5]}
          listening={false}
        />
      )}
      {slots.map((s) => {
        const c = o.cards[s.index];
        const look = lookOf(s.index);
        // The card is drawn upright, then turned by the holder's card rotation about its slot's centre.
        return (
          <Group
            key={c.id}
            x={s.x + s.width / 2}
            y={s.y + s.height / 2}
            offsetX={look.width / 2}
            offsetY={look.height / 2}
            rotation={turn}
            name="deck-card"
          >
            <CardVisual
              w={look.width}
              h={look.height}
              faceUp={c.faceUp === true}
              faceAssetId={c.faceAssetId}
              faceText={c.faceText}
              faceColor={c.faceColor}
              backAssetId={look.backAssetId}
              backColor={look.backColor}
            />
          </Group>
        );
      })}
      {showBadge && <CountBadge x={w - 34} y={-14} count={count} />}
    </>
  );
}

/**
 * Black count badge at the top right of a holder, pile or token stack. It is also the handle that moves the whole
 * stack in Play mode (`name="deck-handle"`).
 */
function CountBadge({
  x,
  y,
  count,
  width = 50,
  height = 26,
  handle = true,
}: {
  x: number;
  y: number;
  count: number;
  width?: number;
  height?: number;
  /** Whether dragging the badge moves the whole stack; bags only show their count. */
  handle?: boolean;
}) {
  const name = handle ? 'deck-handle' : undefined;
  return (
    <Group
      x={x}
      y={y}
      name={name}
      onMouseEnter={(e) => {
        const c = e.target.getStage()?.container();
        if (c && handle) c.style.cursor = 'grab';
      }}
      onMouseLeave={(e) => {
        const c = e.target.getStage()?.container();
        if (c && handle) c.style.cursor = '';
      }}
    >
      <Rect
        name={name}
        width={width}
        height={height}
        cornerRadius={height / 2}
        fill="#111827"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth={1}
      />
      <Text
        name={name}
        width={width}
        height={height}
        text={String(count)}
        align="center"
        verticalAlign="middle"
        fill="#fff"
        fontFamily={FONT}
        fontStyle="bold"
        fontSize={height * 0.5}
      />
    </Group>
  );
}

export function BagVisual({ o }: { o: BagObject }) {
  const w = o.width;
  const h = o.height;
  const count = bagCount(o);
  const stroke = shade(o.color, -60);
  const neckY = h * 0.2;
  return (
    <>
      {/* Sack: a rounded body that narrows into a tied neck. */}
      <Line
        points={[
          w * 0.36,
          neckY,
          w * 0.1,
          h * 0.45,
          w * 0.02,
          h * 0.78,
          w * 0.2,
          h * 0.97,
          w * 0.5,
          h,
          w * 0.8,
          h * 0.97,
          w * 0.98,
          h * 0.78,
          w * 0.9,
          h * 0.45,
          w * 0.64,
          neckY,
        ]}
        closed
        tension={0.45}
        fill={o.color}
        stroke={stroke}
        strokeWidth={2}
        shadowColor="#000"
        shadowBlur={5}
        shadowOpacity={0.3}
        shadowOffsetY={2}
      />
      <Line
        points={[w * 0.36, neckY, w * 0.3, h * 0.04, w * 0.5, h * 0.1, w * 0.7, h * 0.04, w * 0.64, neckY]}
        closed
        tension={0.4}
        fill={shade(o.color, 25)}
        stroke={stroke}
        strokeWidth={2}
      />
      <Rect
        x={w * 0.34}
        y={neckY - 3}
        width={w * 0.32}
        height={7}
        cornerRadius={3}
        fill={shade(o.color, -45)}
        stroke={stroke}
        strokeWidth={1}
      />
      <Text
        x={w * 0.12}
        y={h * 0.4}
        width={w * 0.76}
        height={h * 0.45}
        text={o.name}
        align="center"
        verticalAlign="middle"
        fontFamily={FONT}
        fontStyle="bold"
        fontSize={Math.max(10, Math.min(18, w * 0.13))}
        fill="rgba(255,255,255,0.92)"
        wrap="word"
        ellipsis
        listening={false}
      />
      {count > 0 && <CountBadge x={w - 34} y={-14} count={count} handle={false} />}
    </>
  );
}

/** Offset of each token drawn under the top one of a stack, in world units. */
const TOKEN_STACK_EDGE = 3;

export function TokenVisual({ o }: { o: TokenObject }) {
  const count = tokenCount(o);
  if (count < 2) return <TokenShape o={o} />;
  const layers = count > 2 ? 2 : 1;
  const badgeH = Math.max(18, Math.min(26, Math.round(Math.min(o.width, o.height) * 0.4)));
  const badgeW = Math.max(badgeH * 1.4, badgeH * 0.6 * String(count).length + badgeH * 0.8);
  return (
    <>
      {/* Coloured tokens underneath peek out below the top one; an image token stack shows just the top token and its badge. */}
      {!o.assetId &&
        Array.from({ length: layers }, (_, i) => (
          <Group key={i} y={(layers - i) * TOKEN_STACK_EDGE} listening={false}>
            <TokenShape o={o} />
            <TokenShape o={o} shadeOnly />
          </Group>
        ))}
      <TokenShape o={o} />
      <CountBadge x={o.width - badgeW * 0.6} y={-badgeH * 0.5} count={count} width={badgeW} height={badgeH} />
    </>
  );
}

/** One token. `shadeOnly` draws a dark translucent copy, used to darken the tokens under a stack's top one. */
function TokenShape({ o, shadeOnly }: { o: TokenObject; shadeOnly?: boolean }) {
  const img = useCrispImage(o.assetId, o.width, o.height);
  const w = o.width;
  const h = o.height;
  const r = Math.min(w, h) / 2;
  const stroke = shade(o.color, -60);
  const common = shadeOnly
    ? { fill: '#000', opacity: 0.28 }
    : { fill: o.color, stroke, strokeWidth: 2, shadowColor: '#000', shadowBlur: 4, shadowOpacity: 0.3, shadowOffsetY: 2 };
  if (img && shadeOnly && o.shape !== 'circle') return <Rect width={w} height={h} {...common} />;
  if (img && !shadeOnly) {
    return o.shape === 'circle' ? (
      <Group clipFunc={(ctx) => ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2)}>
        <KImage image={img} width={w} height={h} />
      </Group>
    ) : (
      <KImage image={img} width={w} height={h} />
    );
  }
  switch (o.shape) {
    case 'square':
      return <Rect width={w} height={h} cornerRadius={4} {...common} />;
    case 'triangle':
      return <Line points={[w / 2, 0, w, h, 0, h]} closed {...common} />;
    case 'star':
      return <Star x={w / 2} y={h / 2} numPoints={5} innerRadius={r * 0.45} outerRadius={r} {...common} />;
    case 'hexagon':
      return <RegularPolygon x={w / 2} y={h / 2} sides={6} radius={r} {...common} />;
    case 'circle':
      return <Circle x={w / 2} y={h / 2} radius={r} {...common} />;
    default: {
      const scale = { scaleX: w / 100, scaleY: h / 100, strokeScaleEnabled: false };
      const outline = <Path data={TOKEN_PATHS[o.shape].outline} {...scale} {...common} />;
      const detail = TOKEN_PATHS[o.shape].detail;
      if (shadeOnly || !detail) return outline;
      // Faces of a cube / the top of a cylinder: darker overlays and edges so they read as 3D pieces.
      return (
        <Group>
          {outline}
          <Path data={detail} {...scale} fill="rgba(0,0,0,0.18)" stroke={stroke} strokeWidth={1.5} listening={false} />
        </Group>
      );
    }
  }
}

/** Outlines of the figure-like token shapes in a 100 × 100 box (scaled to the token), with optional shaded detail. */
const TOKEN_PATHS: Record<
  Exclude<TokenShape, 'circle' | 'square' | 'triangle' | 'star' | 'hexagon'>,
  { outline: string; detail?: string }
> = {
  diamond: { outline: 'M50 2 L94 50 L50 98 L6 50 Z' },
  heart: {
    outline: 'M50 92 C20 70 4 52 4 32 C4 16 16 6 30 6 C40 6 46 12 50 20 C54 12 60 6 70 6 C84 6 96 16 96 32 C96 52 80 70 50 92 Z',
  },
  pawn: {
    outline:
      'M50 6 A16 16 0 0 1 61 33.5 L58 38 H66 V44 H59 C60 60 66 74 78 82 L80 84 V96 H20 V84 L22 82 C34 74 40 60 41 44 H34 V38 H42 L39 33.5 A16 16 0 0 1 50 6 Z',
  },
  meeple: {
    outline:
      'M50 4 C60 4 66 11 66 21 C66 27 63 31 60 34 C72 36 92 40 96 48 C99 55 92 60 80 58 L68 56 C70 66 76 80 86 94 C88 97 86 98 82 98 H62 C58 98 56 96 54 92 L50 82 L46 92 C44 96 42 98 38 98 H18 C14 98 12 97 14 94 C24 80 30 66 32 56 L20 58 C8 60 1 55 4 48 C8 40 28 36 40 34 C37 31 34 27 34 21 C34 11 40 4 50 4 Z',
  },
  cube: { outline: 'M50 4 L92 27 V73 L50 96 L8 73 V27 Z', detail: 'M50 50 L92 27 V73 L50 96 Z M8 27 L50 50' },
  cylinder: {
    outline: 'M6 28 A44 18 0 0 1 94 28 V72 A44 18 0 0 1 6 72 Z',
    detail: 'M6 28 A44 18 0 0 0 94 28 V72 A44 18 0 0 1 6 72 Z',
  },
};

function CounterButton({ x, y, size, label, onClick }: { x: number; y: number; size: number; label: string; onClick: () => void }) {
  return (
    <Group
      x={x}
      y={y}
      name="ui-button"
      onClick={(e) => {
        e.cancelBubble = true;
        if (e.evt.button === 0) onClick();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        if (!tapsSuppressed()) onClick();
      }}
    >
      <Circle name="ui-button" radius={size / 2} fill="#eef1f5" stroke="#9aa4b2" strokeWidth={1.5} />
      <Text
        name="ui-button"
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        text={label}
        align="center"
        verticalAlign="middle"
        fontFamily={FONT}
        fontStyle="bold"
        fontSize={size * 0.6}
        fill="#1f2937"
      />
    </Group>
  );
}

export function CounterVisual({ o, onStep }: { o: CounterObject; onStep: (dir: 1 | -1) => void }) {
  const w = o.width;
  const h = o.height;
  const btn = Math.min(h * 0.45, w * 0.22);
  const labelH = o.label ? Math.min(20, h * 0.28) : 0;
  return (
    <>
      <Rect
        width={w}
        height={h}
        cornerRadius={10}
        fill={o.color}
        stroke="#9aa4b2"
        strokeWidth={1.5}
        shadowColor="#000"
        shadowBlur={4}
        shadowOpacity={0.2}
        shadowOffsetY={1}
      />
      {o.label && (
        <Text
          y={4}
          width={w}
          height={labelH}
          text={o.label}
          align="center"
          verticalAlign="middle"
          fontFamily={FONT}
          fontSize={labelH * 0.75}
          fill="#4b5563"
        />
      )}
      <Text
        y={labelH}
        width={w}
        height={h - labelH}
        text={String(o.value)}
        align="center"
        verticalAlign="middle"
        fontFamily={FONT}
        fontStyle="bold"
        fontSize={Math.min((h - labelH) * 0.6, w * 0.25)}
        fill="#111827"
      />
      <CounterButton x={btn / 2 + 6} y={labelH + (h - labelH) / 2} size={btn} label="−" onClick={() => onStep(-1)} />
      <CounterButton x={w - btn / 2 - 6} y={labelH + (h - labelH) / 2} size={btn} label="+" onClick={() => onStep(1)} />
    </>
  );
}

const POLY_SIDES: Record<number, number> = { 4: 3, 8: 4, 10: 5, 12: 5, 20: 6 };

function CustomDieFace({ o, stroke }: { o: DieObject; stroke: string }) {
  const face = o.faces?.[o.value - 1];
  const img = useAssetImage(face?.assetId);
  const w = o.width;
  const h = o.height;
  const s = Math.min(w, h);
  const pad = s * 0.08;
  let imgBox = { x: pad, y: pad, width: w - pad * 2, height: h - pad * 2 };
  if (img) {
    // Fit the image inside the die face, preserving its aspect ratio.
    const k = Math.min(imgBox.width / img.naturalWidth, imgBox.height / img.naturalHeight);
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    imgBox = { x: (w - iw) / 2, y: (h - ih) / 2, width: iw, height: ih };
  }
  return (
    <>
      <Rect
        width={w}
        height={h}
        cornerRadius={s * 0.18}
        fill={o.color}
        stroke={stroke}
        strokeWidth={2}
        shadowColor="#000"
        shadowBlur={5}
        shadowOpacity={0.3}
        shadowOffsetY={2}
      />
      {img ? (
        <KImage image={img} {...imgBox} cornerRadius={s * 0.1} />
      ) : (
        <Text
          width={w}
          height={h}
          padding={pad}
          text={face?.label || String(o.value)}
          align="center"
          verticalAlign="middle"
          fontFamily={FONT}
          fontStyle="bold"
          fontSize={(face?.label?.length ?? 1) > 3 ? s * 0.2 : s * 0.4}
          fill={o.pipColor}
          wrap="word"
        />
      )}
    </>
  );
}

export function DieVisual({ o }: { o: DieObject }) {
  const ref = useRef<Konva.Group>(null);
  const first = useRef(true);
  const w = o.width;
  const h = o.height;
  const s = Math.min(w, h);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const node = ref.current;
    if (!node) return;
    node.rotation(-25);
    node.scale({ x: 0.8, y: 0.8 });
    node.to({ rotation: 0, scaleX: 1, scaleY: 1, duration: 0.25 });
  }, [o.rollCount]);

  const stroke = shade(o.color, -70);
  const custom = o.faces && o.faces.length > 0;
  return (
    <Group ref={ref} x={w / 2} y={h / 2} offsetX={w / 2} offsetY={h / 2}>
      {custom ? (
        <CustomDieFace o={o} stroke={stroke} />
      ) : o.sides === 6 ? (
        <>
          <Rect
            width={w}
            height={h}
            cornerRadius={s * 0.18}
            fill={o.color}
            stroke={stroke}
            strokeWidth={2}
            shadowColor="#000"
            shadowBlur={5}
            shadowOpacity={0.3}
            shadowOffsetY={2}
          />
          {(DIE_PIP_LAYOUT[o.value] ?? []).map(([px, py], i) => (
            <Circle key={i} x={px * w} y={py * h} radius={s * 0.085} fill={o.pipColor} />
          ))}
        </>
      ) : (
        <>
          <RegularPolygon
            x={w / 2}
            y={h / 2 + (o.sides === 4 ? s * 0.08 : 0)}
            sides={POLY_SIDES[o.sides]}
            radius={s * (o.sides === 4 ? 0.58 : 0.52)}
            rotation={o.sides === 12 ? 36 : 0}
            fill={o.color}
            stroke={stroke}
            strokeWidth={2}
            shadowColor="#000"
            shadowBlur={5}
            shadowOpacity={0.3}
            shadowOffsetY={2}
          />
          <Text
            width={w}
            height={h}
            y={o.sides === 4 ? s * 0.08 : 0}
            text={String(o.value)}
            align="center"
            verticalAlign="middle"
            fontFamily={FONT}
            fontStyle="bold"
            fontSize={s * 0.36}
            fill={o.pipColor}
          />
          <Text width={w} y={h - s * 0.02} text={`d${o.sides}`} align="center" fontFamily={FONT} fontSize={s * 0.16} fill="#6b7280" />
        </>
      )}
    </Group>
  );
}

export function LabelVisual({ o }: { o: LabelObject }) {
  return (
    <>
      <Rect width={o.width} height={o.height} fill={o.background ?? 'rgba(0,0,0,0)'} cornerRadius={4} />
      <Text
        width={o.width}
        height={o.height}
        padding={4}
        text={o.text}
        align={o.align}
        verticalAlign="middle"
        fontFamily={FONT}
        fontSize={o.fontSize}
        fill={o.color}
        wrap="word"
      />
    </>
  );
}

let labelMeasurer: Konva.Text | null = null;

/** Width of `text` in the button label font at `size` px. */
function measureLabel(text: string, size: number): number {
  try {
    labelMeasurer ??= new Konva.Text({ fontFamily: FONT, fontStyle: 'bold' });
    labelMeasurer.fontSize(size);
    return labelMeasurer.measureSize(text).width;
  } catch {
    return text.length * size * 0.6; // no canvas (tests)
  }
}

/** Automation button. `pressed` (Play mode) pushes it down while the pointer is held on it. */
export function ButtonVisual({ o, pressed = false }: { o: ButtonObject; pressed?: boolean }) {
  const s = Math.min(o.width, o.height);
  const pad = BUTTON_LABEL_PADDING;
  const fontSize = useMemo(() => fitFontSize(o.label, o.width - pad * 2, o.height - pad * 2, buttonMaxFontSize(o), measureLabel), [o, pad]);
  const dy = pressed ? 2 : 0;
  return (
    <>
      <Rect
        y={dy}
        width={o.width}
        height={o.height}
        cornerRadius={s * 0.2}
        fill={pressed ? shade(o.color, -35) : o.color}
        stroke={shade(o.color, -60)}
        strokeWidth={2}
        shadowColor="#000"
        shadowBlur={pressed ? 1 : 5}
        shadowOpacity={pressed ? 0.2 : 0.3}
        shadowOffsetY={pressed ? 0 : 2}
      />
      <Text
        y={dy}
        width={o.width}
        height={o.height}
        padding={pad}
        text={o.label}
        align="center"
        verticalAlign="middle"
        fontFamily={FONT}
        fontStyle="bold"
        fontSize={fontSize}
        lineHeight={1}
        fill={o.textColor}
        wrap="word"
      />
    </>
  );
}

/** Checkbox: an optional square / round box with a check, cross, dot or fill when checked. */
export function CheckboxVisual({ o }: { o: CheckboxObject }) {
  const w = o.width;
  const h = o.height;
  const s = Math.min(w, h);
  const round = o.boxShape === 'circle';
  const box = o.boxShape !== 'none';
  const sw = Math.max(1.5, s * 0.07);
  const markW = Math.max(2, s * 0.13);
  const inset = box ? s * 0.2 : s * 0.08;
  const common = { stroke: o.color, strokeWidth: markW, lineCap: 'round' as const, lineJoin: 'round' as const, listening: false };
  let mark: React.ReactNode = null;
  if (o.checked) {
    switch (o.mark) {
      case 'check':
        mark = <Line points={[inset, h * 0.52, w * 0.42, h - inset, w - inset, inset]} {...common} />;
        break;
      case 'cross':
        mark = (
          <>
            <Line points={[inset, inset, w - inset, h - inset]} {...common} />
            <Line points={[w - inset, inset, inset, h - inset]} {...common} />
          </>
        );
        break;
      case 'dot':
        mark = <Circle x={w / 2} y={h / 2} radius={s * (box ? 0.24 : 0.32)} fill={o.color} listening={false} />;
        break;
      case 'fill':
        mark = round ? (
          <Circle x={w / 2} y={h / 2} radius={s / 2 - sw * 1.5} fill={o.color} listening={false} />
        ) : (
          <Rect x={sw * 1.5} y={sw * 1.5} width={w - sw * 3} height={h - sw * 3} cornerRadius={s * 0.08} fill={o.color} listening={false} />
        );
        break;
    }
  }
  // The whole area is clickable, even without a box or fill.
  const hit = o.boxFill ?? 'rgba(0,0,0,0.001)';
  return (
    <>
      {round ? (
        <Circle x={w / 2} y={h / 2} radius={s / 2} fill={hit} stroke={box ? o.boxColor : undefined} strokeWidth={box ? sw : 0} />
      ) : (
        <Rect
          width={w}
          height={h}
          cornerRadius={box ? s * 0.12 : 0}
          fill={hit}
          stroke={box ? o.boxColor : undefined}
          strokeWidth={box ? sw : 0}
        />
      )}
      {mark}
    </>
  );
}

export type TimerAction = 'toggle' | 'reset';

/** Icons of the timer's on-table buttons, in a 24 × 24 box. */
const TIMER_ICONS = {
  play: { data: 'M7 4l13 8-13 8z', filled: true },
  pause: { data: 'M7 4h3v16H7zM14 4h3v16h-3z', filled: true },
  reset: { data: 'M1 4v6h6M3.5 15a9 9 0 102.1-9.4L1 10', filled: false },
};

function TimerButton({
  x,
  y,
  size,
  icon,
  onClick,
}: {
  x: number;
  y: number;
  size: number;
  icon: keyof typeof TIMER_ICONS;
  onClick: () => void;
}) {
  const { data, filled } = TIMER_ICONS[icon];
  const s = (size * 0.5) / 24;
  return (
    <Group
      x={x}
      y={y}
      name={`ui-button timer-${icon}`}
      onClick={(e) => {
        e.cancelBubble = true;
        if (e.evt.button === 0) onClick();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        if (!tapsSuppressed()) onClick();
      }}
    >
      <Circle name="ui-button" radius={size / 2} fill="#eef1f5" stroke="#9aa4b2" strokeWidth={1.5} />
      <Path
        name="ui-button"
        data={data}
        x={-12 * s}
        y={-12 * s}
        scaleX={s}
        scaleY={s}
        fill={filled ? '#1f2937' : undefined}
        stroke="#1f2937"
        strokeWidth={filled ? 0 : 2.5}
        lineCap="round"
        lineJoin="round"
        strokeScaleEnabled={false}
      />
    </Group>
  );
}

/** Current time, refreshed a few times a second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** Runs (`id:startedAt`) that already beeped, so copies of a timer's visual (drag shadow) beep only once. */
const beepedRuns = new Set<string>();

/** Timer: the time left (countdown) or counted (stopwatch), with start / pause and reset buttons; it flashes red at 0:00. */
export function TimerVisual({ o, onTimer }: { o: TimerObject; onTimer: (action: TimerAction) => void }) {
  const running = isTimerRunning(o);
  const now = useNow(running);
  const finished = timerFinished(o, now);
  const wasFinished = useRef(finished);
  useEffect(() => {
    const was = wasFinished.current;
    wasFinished.current = finished;
    // Only a countdown seen running out here beeps (not one that had already run out when the table opened).
    if (!finished || was || !running || !o.sound) return;
    const key = `${o.id}:${o.startedAt}`;
    if (beepedRuns.has(key)) return;
    beepedRuns.add(key);
    beep();
  }, [finished, running, o.sound, o.id, o.startedAt]);

  const w = o.width;
  const h = o.height;
  const pad = Math.min(w, h) * 0.08;
  const btn = Math.min(h * 0.38, w * 0.2);
  const textW = w - btn - pad * 3;
  const labelH = o.label ? Math.min(18, h * 0.22) : 0;
  const text = timerText(o, now);
  const fontSize = Math.max(8, Math.min((h - labelH) * 0.62, textW / (text.length * 0.62)));
  const alarm = finished && (!running || Math.floor(now / 500) % 2 === 0);
  return (
    <>
      <Rect
        width={w}
        height={h}
        cornerRadius={10}
        fill={alarm ? '#c62828' : o.color}
        stroke="#9aa4b2"
        strokeWidth={1.5}
        shadowColor="#000"
        shadowBlur={4}
        shadowOpacity={0.2}
        shadowOffsetY={1}
      />
      {o.label && (
        <Text
          x={pad}
          y={pad * 0.6}
          width={textW}
          height={labelH}
          text={o.label}
          align="center"
          verticalAlign="middle"
          fontFamily={FONT}
          fontSize={labelH * 0.8}
          fill={alarm ? '#ffffff' : o.textColor}
          opacity={0.8}
          ellipsis
          wrap="none"
          listening={false}
        />
      )}
      <Text
        name="timer-text"
        x={pad}
        y={labelH}
        width={textW}
        height={h - labelH}
        text={text}
        align="center"
        verticalAlign="middle"
        fontFamily={FONT}
        fontStyle="bold"
        fontSize={fontSize}
        fill={alarm ? '#ffffff' : o.textColor}
        listening={false}
      />
      <TimerButton
        x={w - pad - btn / 2}
        y={h / 2 - btn * 0.56}
        size={btn}
        icon={running && !finished ? 'pause' : 'play'}
        onClick={() => onTimer('toggle')}
      />
      <TimerButton x={w - pad - btn / 2} y={h / 2 + btn * 0.56} size={btn} icon="reset" onClick={() => onTimer('reset')} />
    </>
  );
}

export function ObjectVisual({
  o,
  mode,
  onStep,
  onTimer,
  pressed,
  holderZone,
}: {
  o: TabletopObject;
  mode: Mode;
  onStep?: (d: 1 | -1) => void;
  onTimer?: (action: TimerAction) => void;
  pressed?: boolean;
  /** Holders: whether their zone is drawn here (`shown`, default) or by its own node (`ghost`). */
  holderZone?: 'shown' | 'ghost';
}) {
  switch (o.kind) {
    case 'board':
      return <BoardVisual o={o} mode={mode} />;
    case 'image':
      return <ImageVisual o={o} />;
    case 'card':
      return <CardObjectVisual o={o} />;
    case 'deck':
      return <DeckVisual o={o} mode={mode} zone={holderZone} />;
    case 'token':
      return <TokenVisual o={o} />;
    case 'counter':
      return <CounterVisual o={o} onStep={onStep ?? (() => {})} />;
    case 'die':
      return <DieVisual o={o} />;
    case 'label':
      return <LabelVisual o={o} />;
    case 'button':
      return <ButtonVisual o={o} pressed={pressed} />;
    case 'bag':
      return <BagVisual o={o} />;
    case 'checkbox':
      return <CheckboxVisual o={o} />;
    case 'timer':
      return <TimerVisual o={o} onTimer={onTimer ?? (() => {})} />;
  }
}

export { FONT };
