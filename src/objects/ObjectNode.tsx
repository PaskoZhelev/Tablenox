import { memo, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Group, Rect } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  cardIndexAt,
  findGroupDropTarget,
  findHoverTarget,
  isSpread,
  pieceStacks,
  resolveGroupDrop,
  spreadInsertIndex,
} from '../domain/rules';
import { isHolder, raisedWhenMoved, sortByStacking } from '../domain/objects';
import { isMarkAnchor } from '../domain/annotations';
import { screenToWorld, worldToScreen } from '../domain/camera';
import { snapPosition } from '../domain/geometry';
import { SheetMarks } from '../drawing/AnnotationLayer';
import type { DeckObject, Mode, TabletopObject } from '../domain/types';
import { currentTable, useTableStore } from '../state/tableStore';
import {
  dropObject,
  flipCard,
  flipDeckCard,
  incrementCounter,
  pickOnTable,
  placesFreely,
  resetTimer,
  rollDie,
  runButton,
  toggleCheckbox,
  toggleTimer,
} from '../canvas/actions';
import { registerPrimaryClick, resetDoubleClick } from '../canvas/doubleClick';
import { tapsSuppressed } from '../canvas/touch';
import { LIFTED_ATTR } from '../canvas/stageRegistry';
import { HolderZoneShape, HolderZoneVisual, ObjectVisual, PieceStackBadge } from './visuals';
import { takeStackDrag } from './stackDrag';

interface Props {
  object: TabletopObject;
  mode: Mode;
  draggable: boolean;
  /** A dragged card would be added to this object on release. */
  dropTarget: boolean;
  /** Chosen for the button step being picked on the table. */
  picked?: boolean;
  /** Shown from the automations panel: outlined even when locked (no Transformer). */
  focused?: boolean;
}

function centerOf(node: Konva.Node) {
  return { x: node.x(), y: node.y() };
}

/** True while `id` is part of a multi-selection (the Transformer then drags all members together). */
function inGroupSelection(id: string): boolean {
  const s = useTableStore.getState();
  return s.selectedIds.length > 1 && s.selectedIds.includes(id);
}

// All members of one group drag share a key; the first member to land drops the whole selection.
let groupDragKey = '';
let groupDragSeq = 0;
/** The group drag that was already dropped (by the first member that lands). */
let groupDroppedKey = '';
/** The objects moving in the current group drag (each gets a dragstart from the Transformer). */
const groupDragIds = new Set<string>();
/** The group drag that moves a piece stack by its badge (see `markStackDrag`). */
let stackDragKey = '';

function liftToTop(node: Konva.Node | undefined): void {
  if (!node) return;
  node.setAttr(LIFTED_ATTR, true);
  node.moveToTop();
}

/** The selected objects that come to the front when the selection is moved, bottom first. */
function raisedMembers(ids: readonly string[], mode: Mode): string[] {
  const set = new Set(ids);
  const all = currentTable().objects;
  return sortByStacking(
    all.filter((x) => set.has(x.id) && raisedWhenMoved(x, mode)),
    all,
  ).map((x) => x.id);
}

/** Shuffle animation: quick, a few side-to-side swings that die out. */
const SHUFFLE = { ms: 450, halfWaves: 4, maxShift: 18, tilt: 4 };

/** "Picked up" look while dragging in Play mode: a slight clockwise tilt, a little larger, with a soft drop shadow. */
const LIFT = {
  rotation: 3,
  scale: 1.04,
  duration: 0.12,
  shadowX: 8,
  shadowY: 14,
  shadowOpacity: 0.5,
  shadowBlur: 10,
  /** Longest side of the blurred shadow bitmap, in pixels (keeps blurring cheap for large boards). */
  shadowResolution: 240,
};

function ObjectNodeImpl({ object: o, mode, draggable, dropTarget, picked, focused }: Props) {
  const liftRef = useRef<Konva.Group>(null);
  const shadowRef = useRef<Konva.Group>(null);
  const [lifted, setLifted] = useState(false);
  const latest = useRef(o);
  useEffect(() => {
    latest.current = o;
  });
  const shuffleSeq = useTableStore((s) => (s.shuffled?.ids.includes(o.id) ? s.shuffled.seq : 0));
  // Top piece of a holder's piece stack: the number of pieces in it, shown on its badge (0 = no badge).
  const stackCount = useTableStore((s) => pieceStacks(s.history.present.objects).get(o.id)?.count ?? 0);
  // Edit mode with "Snap to grid": the grid size a drag snaps to (0 = free).
  const gridSize = useTableStore((s) => (s.mode === 'edit' && s.ui.snapToGrid ? s.ui.gridSize : 0));

  /**
   * Keeps a dragged object's bounding box corner on the grid (Shift or "Place freely" places freely). Only the object under the pointer
   * snaps; the rest of a multi-selection follows it by the same amount, so their layout is kept.
   */
  const snapDrag = (pos: { x: number; y: number }, evt?: { shiftKey?: boolean }) => {
    if (placesFreely(evt)) return pos;
    const { camera } = useTableStore.getState();
    const obj = latest.current;
    const center = screenToWorld(camera, pos);
    const p = snapPosition(obj, { x: center.x - obj.width / 2, y: center.y - obj.height / 2 }, gridSize);
    return worldToScreen(camera, { x: p.x + obj.width / 2, y: p.y + obj.height / 2 });
  };

  // Shuffled: a holder's / pile's cards riffle (alternate cards slide left and right); a bag wobbles.
  useEffect(() => {
    const root = liftRef.current;
    const layer = root?.getLayer();
    if (!shuffleSeq || !root || !layer || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const obj = latest.current;
    const cards = obj.kind === 'deck' ? root.find('.deck-card') : [];
    const base = (cards.length ? cards : [root]).map((n) => ({ n, x: n.x(), r: n.rotation() }));
    const amp = Math.max(6, Math.min(SHUFFLE.maxShift, obj.width * 0.15));
    const reset = () => base.forEach(({ n, x, r }) => n.setAttrs({ x, rotation: r }));
    const anim = new Konva.Animation((frame) => {
      const p = Math.min(1, (frame?.time ?? 0) / SHUFFLE.ms);
      const wave = Math.sin(p * Math.PI * SHUFFLE.halfWaves) * (1 - p);
      base.forEach(({ n, x, r }, i) => {
        const dir = i % 2 === 0 ? 1 : -1;
        n.setAttrs({ x: x + dir * amp * wave, rotation: r + dir * SHUFFLE.tilt * wave });
      });
      if (p >= 1) {
        anim.stop();
        reset();
      }
    }, layer);
    anim.start();
    return () => {
      anim.stop();
      reset();
    };
  }, [shuffleSeq]);

  // The shadow is a blurred, blackened copy of the object, so it follows its real silhouette (cards, round tokens…).
  useEffect(() => {
    const g = shadowRef.current;
    if (!lifted || !g) return;
    try {
      g.cache({ pixelRatio: Math.min(1, LIFT.shadowResolution / Math.max(o.width, o.height)), offset: LIFT.shadowBlur * 3 });
      g.filters([Konva.Filters.Blur, Konva.Filters.Brighten]);
      g.blurRadius(LIFT.shadowBlur);
      g.brightness(-1);
    } catch {
      // Caching needs a real canvas; without one the object simply has no shadow.
    }
  }, [lifted, o.width, o.height]);

  const lift = () => {
    // Play mode only: in Edit mode objects move without the picked-up effect.
    if (useTableStore.getState().mode !== 'play') return;
    setLifted(true);
    liftRef.current?.to({ rotation: LIFT.rotation, scaleX: LIFT.scale, scaleY: LIFT.scale, duration: LIFT.duration });
  };

  const land = () => {
    setLifted(false);
    liftRef.current?.to({ rotation: 0, scaleX: 1, scaleY: 1, duration: LIFT.duration });
  };

  const onDragStart = (e: KonvaEventObject<DragEvent>) => {
    const s = useTableStore.getState();
    lift();
    if (inGroupSelection(o.id)) {
      if (!s.draggingId) {
        groupDragKey = `group-drag:${++groupDragSeq}`;
        stackDragKey = takeStackDrag() ? groupDragKey : '';
        groupDragIds.clear();
        // The selection is lifted above everything else while it moves, keeping its own order.
        const layer = e.target.getLayer();
        const nodes = new Map((layer?.getChildren((n) => n.hasName('object')) ?? []).map((n) => [n.id(), n]));
        for (const m of raisedMembers(s.selectedIds, s.mode)) liftToTop(nodes.get(m));
      }
      groupDragIds.add(o.id);
    } else {
      if (raisedWhenMoved(o, s.mode)) liftToTop(e.target);
      s.select(o.id);
    }
    if (!s.draggingId) s.setDragging(o.id);
  };

  const onDragMove = (e: KonvaEventObject<DragEvent>) => {
    const free = placesFreely(e.evt as MouseEvent | undefined);
    const center = centerOf(e.target);
    const table = currentTable();
    if (inGroupSelection(o.id)) {
      // A selection: the object under the pointer shows where the whole selection would go.
      const s = useTableStore.getState();
      if (s.draggingId !== o.id) return;
      const ids = [...groupDragIds];
      const target = free ? undefined : findGroupDropTarget(table, ids, center);
      const withCards = ids.some((id) => {
        const m = table.objects.find((x) => x.id === id);
        return m?.kind === 'card' || (m?.kind === 'deck' && m.isPile);
      });
      const index = withCards && target?.kind === 'deck' && isSpread(target) ? spreadInsertIndex(table.objects, target, center) : null;
      s.setDropTarget(target?.id ?? null, index);
      return;
    }
    const dragsCards = o.kind === 'card' || o.kind === 'deck';
    if (o.kind === 'board' || o.kind === 'bag' || isHolder(o)) return;
    const target = free ? undefined : findHoverTarget(table, o.id, center);
    // Cards and piles over a spread holder show the place they would take.
    const index = dragsCards && target?.kind === 'deck' && isSpread(target) ? spreadInsertIndex(table.objects, target, center) : null;
    useTableStore.getState().setDropTarget(target?.id ?? null, index);
  };

  const onDragEnd = (e: KonvaEventObject<DragEvent>) => {
    const node = e.target as unknown as Konva.Group;
    node.setAttr(LIFTED_ATTR, false);
    const free = placesFreely(e.evt as MouseEvent | undefined);
    const s = useTableStore.getState();
    const leaderId = s.draggingId;
    land();
    s.setDropTarget(null);
    s.setDragging(null);
    const position = { x: Math.round(node.x() - o.width / 2), y: Math.round(node.y() - o.height / 2) };
    if (inGroupSelection(o.id)) {
      if (groupDroppedKey !== groupDragKey) {
        // Every member has reached its place by now: drop the whole selection as one undo step.
        groupDroppedKey = groupDragKey;
        const table = currentTable();
        const layer = node.getLayer();
        const moves = [...groupDragIds].flatMap((id) => {
          const m = table.objects.find((x) => x.id === id);
          const n = layer?.findOne((x: Konva.Node) => x.id() === id && x.hasName('object'));
          return m && n ? [{ id, position: { x: Math.round(n.x() - m.width / 2), y: Math.round(n.y() - m.height / 2) } }] : [];
        });
        s.dispatch(resolveGroupDrop(table, moves, leaderId ?? o.id, s.mode, { free }));
        // After every member has landed (they all get their dragend in this same pointer-up).
        if (groupDragKey === stackDragKey) setTimeout(() => useTableStore.getState().select(leaderId ?? o.id), 0);
      }
    } else {
      dropObject(o.id, position, free);
    }
    // react-konva will not reposition the node if the stored value is unchanged, so sync it explicitly.
    const after = currentTable().objects.find((x) => x.id === o.id);
    if (after) node.position({ x: after.position.x + after.width / 2, y: after.position.y + after.height / 2 });
  };

  const runDoubleAction = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const s = useTableStore.getState();
    if (s.tool !== 'select' || s.picking) return;
    if (o.kind === 'card' && !o.locked) flipCard(o.id);
    else if (o.kind === 'die') rollDie(o.id);
    else if (o.kind === 'checkbox' && mode === 'edit') toggleCheckbox(o.id);
    else if (o.kind === 'deck') {
      // A stack turns its top card over; a spread turns over the card that was double-clicked.
      const world = e.target.getStage()?.getRelativePointerPosition();
      const index = isSpread(o) ? (world ? cardIndexAt(currentTable().objects, o, world) : null) : 0;
      if (index !== null) flipDeckCard(o.id, index);
    }
  };

  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const isPlayButton = o.kind === 'button' && mode === 'play';
  /** Play-mode buttons and checkboxes react to a click (they don't move or get an action bar there). */
  const clickInPlay = (o.kind === 'button' || o.kind === 'checkbox') && mode === 'play';
  const [pressed, setPressed] = useState(false);

  // Play-mode buttons sink while held and spring back when released (wherever the pointer is let go).
  useEffect(() => {
    liftRef.current?.to({ scaleX: pressed ? 0.95 : 1, scaleY: pressed ? 0.95 : 1, duration: pressed ? 0.05 : 0.12 });
    if (!pressed) return;
    const release = () => setPressed(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, [pressed]);

  const onPress = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const p = 'touches' in e.evt ? e.evt.touches[0] : (e.evt as MouseEvent);
    pressAt.current = p ? { x: p.clientX, y: p.clientY } : null;
    const primary = 'touches' in e.evt || (e.evt as MouseEvent).button === 0;
    if (isPlayButton && primary && useTableStore.getState().tool === 'select') setPressed(true);
  };

  /** Play mode: a click (not a camera drag that started on it) runs the button / toggles the checkbox. */
  const runButtonClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const press = pressAt.current;
    pressAt.current = null;
    const p = 'changedTouches' in e.evt ? e.evt.changedTouches[0] : (e.evt as MouseEvent);
    if (press && p && Math.hypot(p.clientX - press.x, p.clientY - press.y) > 6) return;
    if (useTableStore.getState().tool !== 'select') return;
    if (o.kind === 'checkbox') toggleCheckbox(o.id);
    else runButton(o.id);
  };

  const onClick = (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return resetDoubleClick();
    if (useTableStore.getState().picking) return;
    if (clickInPlay) return runButtonClick(e);
    if (registerPrimaryClick(o.id)) runDoubleAction(e);
  };

  const onTap = (e: KonvaEventObject<TouchEvent>) => {
    if (clickInPlay && !tapsSuppressed()) runButtonClick(e);
  };

  const onDblTap = (e: KonvaEventObject<TouchEvent>) => {
    if (!tapsSuppressed()) runDoubleAction(e);
  };

  /** Reports the object (and, for a holder/pile, the card) under the mouse for the hover preview. */
  const hoverAt = (e: KonvaEventObject<MouseEvent>) => {
    let cardId: string | null = null;
    if (o.kind === 'deck') {
      const world = e.target.getStage()?.getRelativePointerPosition();
      const index = world ? cardIndexAt(currentTable().objects, o, world) : null;
      cardId = index === null ? null : (o.cards[index]?.id ?? null);
    }
    useTableStore.getState().setHover(o.id, cardId);
  };

  return (
    <Group
      id={o.id}
      name="object"
      x={o.position.x + o.width / 2}
      y={o.position.y + o.height / 2}
      offsetX={o.width / 2}
      offsetY={o.height / 2}
      rotation={o.rotation}
      draggable={draggable}
      dragBoundFunc={gridSize ? snapDrag : undefined}
      opacity={dropTarget && !(o.kind === 'deck' && isSpread(o)) ? 0.45 : o.visible ? 1 : 0.35}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onTap}
      onMouseDown={onPress}
      onTouchStart={onPress}
      onDblTap={onDblTap}
      onMouseEnter={(e) => {
        hoverAt(e);
        const c = e.target.getStage()?.container();
        if (clickInPlay && c) c.style.cursor = 'pointer';
      }}
      onMouseMove={o.kind === 'deck' ? hoverAt : undefined}
      onMouseLeave={(e) => {
        useTableStore.getState().setHover(null);
        const c = e.target.getStage()?.container();
        if (clickInPlay && c) c.style.cursor = '';
      }}
    >
      {/* Tilted and scaled while lifted; rotation/scale are animated imperatively, so they are not props here. */}
      <Group ref={liftRef} name="lift" x={o.width / 2} y={o.height / 2} offsetX={o.width / 2} offsetY={o.height / 2}>
        {lifted && (
          <Group ref={shadowRef} name="lift-shadow" x={LIFT.shadowX} y={LIFT.shadowY} opacity={LIFT.shadowOpacity} listening={false}>
            <ObjectVisual o={o} mode={mode} holderZone="ghost" />
          </Group>
        )}
        <ObjectVisual
          o={o}
          mode={mode}
          holderZone="ghost"
          pressed={pressed}
          stackBadge={stackCount === 0}
          onStep={(d) => (useTableStore.getState().picking ? pickOnTable([o.id], 'toggle') : incrementCounter(o.id, d))}
          onTimer={(a) => {
            if (useTableStore.getState().picking) pickOnTable([o.id], 'toggle');
            else if (a === 'toggle') toggleTimer(o.id);
            else resetTimer(o.id);
          }}
        />
        {isMarkAnchor(o) && <SheetMarks objectId={o.id} />}
        {stackCount > 0 && <PieceStackBadge o={o} count={stackCount} />}
      </Group>
      {focused && (
        <Rect
          name="focus-outline"
          x={-12}
          y={-12}
          width={o.width + 24}
          height={o.height + 24}
          stroke="#f4c542"
          strokeWidth={3}
          cornerRadius={8}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {picked && (
        <Rect
          name="pick-outline"
          x={-6}
          y={-6}
          width={o.width + 12}
          height={o.height + 12}
          stroke="#38bdf8"
          strokeWidth={3}
          dash={[10, 6]}
          cornerRadius={6}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {dropTarget && (
        <HolderZoneShape
          shape={o.kind === 'deck' && !o.isPile ? o.zoneShape : undefined}
          x={-10}
          y={-10}
          w={o.width + 20}
          h={o.height + 20}
          stroke="#f4c542"
          strokeWidth={4}
          cornerRadius={6}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </Group>
  );
}

export const ObjectNode = memo(ObjectNodeImpl);

export const HOLDER_ZONE_NAME = 'holder-zone';
/** The attribute of a zone node naming its holder. */
export const HOLDER_ID_ATTR = 'holderId';

const FOLLOWED_ATTRS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const;

/**
 * A holder's zone (fill, outline, label), drawn under the cards of every holder on the same board while the holder's
 * own node (`ObjectNode`, drawing its cards) lies above them all (see `drawOrder`). Presses on the zone act on the
 * holder: they are handed to its node, and `findObjectNode` in `TableCanvas` resolves the zone to it. The zone follows
 * the holder's node while that is dragged or transformed.
 */
function HolderZoneNodeImpl({ o, mode, dropTarget }: { o: DeckObject; mode: Mode; dropTarget: boolean }) {
  const ref = useRef<Konva.Group>(null);

  useEffect(() => {
    const zone = ref.current;
    const holder = zone?.getLayer()?.findOne((n: Konva.Node) => n.id() === o.id && n.hasName('object'));
    if (!zone || !holder) return;
    const follow = () => {
      zone.setAttrs(Object.fromEntries(FOLLOWED_ATTRS.map((a) => [a, holder.getAttr(a) ?? (a.startsWith('scale') ? 1 : 0)])));
    };
    holder.on(FOLLOWED_ATTRS.map((a) => `${a}Change.holderZone`).join(' '), follow);
    return () => {
      holder.off('.holderZone');
    };
  }, [o.id]);

  const holderNode = (e: KonvaEventObject<Event>) =>
    e.target.getLayer()?.findOne((n: Konva.Node) => n.id() === o.id && n.hasName('object'));
  // Handing the press over starts Konva's drag of the holder (Edit mode) just as a press on the holder itself would.
  const press = (e: KonvaEventObject<MouseEvent | TouchEvent>) => holderNode(e)?.fire(e.type, e, false);
  const hover = () => useTableStore.getState().setHover(o.id, null);

  return (
    <Group
      ref={ref}
      id={`zone:${o.id}`}
      name={HOLDER_ZONE_NAME}
      {...{ [HOLDER_ID_ATTR]: o.id }}
      x={o.position.x + o.width / 2}
      y={o.position.y + o.height / 2}
      offsetX={o.width / 2}
      offsetY={o.height / 2}
      rotation={o.rotation}
      opacity={dropTarget && !isSpread(o) ? 0.45 : o.visible ? 1 : 0.35}
      onMouseDown={press}
      onTouchStart={press}
      onMouseEnter={hover}
      onMouseMove={hover}
      onMouseLeave={() => useTableStore.getState().setHover(null)}
    >
      <HolderZoneVisual o={o} mode={mode} />
    </Group>
  );
}

export const HolderZoneNode = memo(HolderZoneNodeImpl);
