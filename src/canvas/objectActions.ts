import type { IconName } from '../components/Icon';
import { bagOf, homeDeckOf, nextRotation, pileHasHome, tokenSourceOf, tokensTakenFrom } from '../domain/rules';
import { fixedInPlay, hasPlayMovable, tokenCount } from '../domain/objects';
import type { DrawSide, Mode, TableState, TabletopObject } from '../domain/types';
import { useTableStore } from '../state/tableStore';
import {
  cycleDrawSide,
  cyclePutSide,
  deleteObject,
  deleteObjects,
  drawFromBag,
  drawFromDeck,
  duplicateObject,
  duplicateObjects,
  flipCard,
  flipDeck,
  pickCardsFromDeck,
  promptDrawCards,
  promptDrawFromBag,
  promptTakeTokens,
  recallToBag,
  recallTokens,
  resetDeck,
  returnCardToDeck,
  returnPileToHolders,
  returnToBag,
  rollDie,
  rotateStep,
  runButton,
  setZOrder,
  setHolderLayout,
  shuffleBag,
  shuffleDeck,
  sortDeck,
  takeTokens,
  toggleLock,
  toggleLockMany,
  togglePlayMovable,
  toggleCheckbox,
  toggleTimer,
  resetTimer,
} from './actions';
import { isTimerRunning, timerToggleLabel } from '../domain/timer';

/** Label of the draw-side action (it cycles through the three settings). */
export const DRAW_SIDE_LABELS: Record<DrawSide, string> = {
  keep: 'Draws as they lie',
  faceUp: 'Draws face up',
  faceDown: 'Draws face down',
};

/** Label of the put-side action (holders; it cycles through the three settings). */
export const PUT_SIDE_LABELS: Record<DrawSide, string> = {
  keep: 'Cards go in as they are',
  faceUp: 'Cards go in face up',
  faceDown: 'Cards go in face down',
};

export interface ObjectAction {
  id: string;
  label: string;
  icon?: IconName;
  run: () => void;
  /** Shown as a button in the floating selection bar (otherwise only in the menu). */
  primary?: boolean;
  /** Toggle state, rendered as pressed. */
  active?: boolean;
  danger?: boolean;
  shortcut?: string;
  /** Menu only: a choice of options shown below the entry when it is clicked (its own `run` is not used). */
  children?: ObjectAction[];
}

/** Objects whose menu title row has inline controls (die face, counter value, card / token count), so their menu is never empty. */
export function hasObjectControls(o: TabletopObject): boolean {
  return o.kind === 'die' || o.kind === 'counter' || o.kind === 'deck' || o.kind === 'bag' || (o.kind === 'token' && tokenCount(o) > 1);
}

/** Adds "Rotate to N°" (the object's next allowed angle) unless its rotation angles don't let it turn. */
function pushRotate(actions: ObjectAction[], o: TabletopObject, table: TableState, primary = false): void {
  const next = nextRotation(table, o);
  if (next === null) return;
  actions.push({ id: 'rotate', label: `Rotate to ${next}°`, icon: 'rotate', run: () => rotateStep(o.id), primary, shortcut: 'R' });
}

/** Actions for an Edit-mode multi-selection. */
export function getGroupActions(ids: string[], table: TableState): ObjectAction[] {
  const objs = table.objects.filter((o) => ids.includes(o.id));
  const allLocked = objs.length > 0 && objs.every((o) => o.locked);
  return [
    {
      id: 'duplicate',
      label: `Duplicate ${objs.length} objects`,
      icon: 'copy',
      run: () => duplicateObjects(ids),
      primary: true,
      shortcut: 'Ctrl+D',
    },
    {
      id: 'lock',
      label: allLocked ? 'Unlock all' : 'Lock all',
      icon: allLocked ? 'lock' : 'unlock',
      run: () => toggleLockMany(ids),
      primary: true,
      active: allLocked,
      shortcut: 'L',
    },
    {
      id: 'delete',
      label: `Delete ${objs.length} objects`,
      icon: 'trash',
      run: () => deleteObjects(ids),
      primary: true,
      danger: true,
      shortcut: 'Del',
    },
  ];
}

/**
 * Actions for one object. Play mode only offers what players do during a game (draw, shuffle, flip, roll…);
 * setup (how a holder deals and shows its cards, locking, stacking order, movability, duplicate, delete) is
 * Edit-mode only. Edit mode also keeps the play actions, to prepare the starting state.
 */
export function getObjectActions(o: TabletopObject, mode: Mode, table: TableState): ObjectAction[] {
  const edit = mode === 'edit';
  const actions: ObjectAction[] = [];
  switch (o.kind) {
    case 'card': {
      actions.push({ id: 'flip', label: 'Flip', icon: 'flip', run: () => flipCard(o.id), primary: true, shortcut: 'F' });
      pushRotate(actions, o, table, true);
      if (homeDeckOf(table, o)) {
        actions.push({ id: 'return', label: 'Return to holder', icon: 'deck', run: () => returnCardToDeck(o.id), primary: true });
      }
      if (bagOf(table, o)) {
        actions.push({ id: 'return-bag', label: 'Return to bag', icon: 'bag', run: () => returnToBag(o.id), primary: true });
      }
      break;
    }
    case 'bag': {
      if (o.items.length > 0) {
        actions.push({ id: 'draw', label: 'Draw a random piece', icon: 'draw', run: () => drawFromBag(o.id), primary: true });
        actions.push({ id: 'draw-many', label: 'Draw several pieces…', icon: 'draw', run: () => void promptDrawFromBag(o.id) });
      }
      if (o.items.length > 1) {
        actions.push({ id: 'shuffle', label: 'Shuffle', icon: 'shuffle', run: () => shuffleBag(o.id), primary: true, shortcut: 'S' });
      }
      if (table.objects.some((x) => x.bagId === o.id)) {
        actions.push({ id: 'recall', label: 'Recall everything to the bag', icon: 'reset', run: () => recallToBag(o.id), primary: true });
      }
      break;
    }
    case 'deck': {
      const hasCards = o.cards.length > 0;
      if (o.isPile && pileHasHome(table, o)) {
        actions.push({
          id: 'return',
          label: 'Return cards to their holders',
          icon: 'reset',
          run: () => returnPileToHolders(o.id),
          primary: true,
        });
      }
      if (hasCards) {
        actions.push({ id: 'draw', label: 'Draw a card', icon: 'draw', run: () => drawFromDeck(o.id), primary: true });
        actions.push({ id: 'shuffle', label: 'Shuffle', icon: 'shuffle', run: () => shuffleDeck(o.id), primary: true, shortcut: 'S' });
        actions.push({ id: 'flipdeck', label: 'Flip all cards', icon: 'flip', run: () => flipDeck(o.id), primary: true, shortcut: 'F' });
        actions.push({ id: 'draw-top', label: 'Draw cards from top…', icon: 'draw', run: () => void promptDrawCards(o.id, 'top') });
        actions.push({
          id: 'draw-bottom',
          label: 'Draw cards from bottom…',
          icon: 'draw',
          run: () => void promptDrawCards(o.id, 'bottom'),
        });
        actions.push({ id: 'pick-card', label: 'Pick card(s)…', icon: 'card', run: () => void pickCardsFromDeck(o.id) });
      }
      if (o.cards.length > 1) {
        actions.push({
          id: 'sort',
          label: 'Sort',
          icon: 'sort',
          run: () => undefined,
          children: [
            { id: 'sort-original', label: 'Original deck order', run: () => sortDeck(o.id, 'original') },
            { id: 'sort-name', label: 'By card name', run: () => sortDeck(o.id, 'name') },
            { id: 'sort-reverse', label: 'Reverse the order', run: () => sortDeck(o.id, 'reverse') },
          ],
        });
      }
      if (!o.isPile && o.initialCards.length > 0) {
        actions.push({ id: 'reset', label: 'Gather & reset deck', icon: 'reset', run: () => resetDeck(o.id) });
      }
      // Piles turn like cards; holders only where they may move (Edit mode, or movable in Play mode).
      if (!o.locked && (o.isPile || edit || !fixedInPlay(o))) pushRotate(actions, o, table);
      if (edit) {
        actions.push({
          id: 'drawside',
          label: DRAW_SIDE_LABELS[o.drawSide],
          icon: o.drawSide === 'faceDown' ? 'eyeOff' : 'eye',
          run: () => cycleDrawSide(o.id),
          primary: hasCards,
          active: o.drawSide !== 'keep',
        });
        if (!o.isPile) {
          const putSide = o.putSide ?? 'keep';
          actions.push({
            id: 'putside',
            label: PUT_SIDE_LABELS[putSide],
            icon: putSide === 'faceDown' ? 'eyeOff' : 'eye',
            run: () => cyclePutSide(o.id),
            active: putSide !== 'keep',
          });
          const spread = o.layout === 'spread';
          actions.push({
            id: 'layout',
            label: spread ? 'Show cards stacked' : 'Spread cards out',
            icon: spread ? 'deck' : 'holder',
            run: () => setHolderLayout(o.id, spread ? 'stack' : 'spread'),
          });
        }
      }
      break;
    }
    case 'die':
      actions.push({ id: 'roll', label: 'Roll', icon: 'dice', run: () => rollDie(o.id), primary: true, shortcut: 'R' });
      if (bagOf(table, o)) {
        actions.push({ id: 'return-bag', label: 'Return to bag', icon: 'bag', run: () => returnToBag(o.id), primary: true });
      }
      break;
    case 'button':
      if (edit) {
        actions.push({
          id: 'automations',
          label: 'Automations…',
          icon: 'bolt',
          run: () => useTableStore.getState().openAutomations(o.id),
          primary: true,
        });
      }
      actions.push({ id: 'run', label: edit ? 'Run (test)' : 'Run', icon: 'play', run: () => runButton(o.id), primary: true });
      break;
    case 'token': {
      if (tokenCount(o) > 1) {
        actions.push({ id: 'take-token', label: 'Take a token', icon: 'draw', run: () => takeTokens(o.id), primary: true });
        actions.push({ id: 'take-tokens', label: 'Take several tokens…', icon: 'draw', run: () => void promptTakeTokens(o.id) });
      }
      if (tokensTakenFrom(table, o).length > 0) {
        actions.push({ id: 'recall-tokens', label: 'Recall all tokens', icon: 'reset', run: () => recallTokens(o.id), primary: true });
      } else if (tokenSourceOf(table, o)) {
        actions.push({ id: 'recall-token', label: 'Return to stack', icon: 'reset', run: () => recallTokens(o.id), primary: true });
      }
      if (bagOf(table, o)) {
        actions.push({ id: 'return-bag', label: 'Return to bag', icon: 'bag', run: () => returnToBag(o.id), primary: true });
      }
      pushRotate(actions, o, table);
      break;
    }
    case 'checkbox':
      actions.push({
        id: 'check',
        label: o.checked ? 'Uncheck' : 'Check',
        icon: 'checkbox',
        run: () => toggleCheckbox(o.id),
        primary: true,
        active: o.checked,
      });
      break;
    case 'timer': {
      const label = timerToggleLabel(o, Date.now());
      actions.push({ id: 'timer-toggle', label, icon: label === 'Pause' ? 'pause' : 'play', run: () => toggleTimer(o.id), primary: true });
      if (isTimerRunning(o) || o.elapsedMs > 0) {
        actions.push({ id: 'timer-reset', label: 'Reset', icon: 'reset', run: () => resetTimer(o.id), primary: true });
      }
      break;
    }
    case 'image':
    case 'label':
      pushRotate(actions, o, table);
      if (bagOf(table, o)) {
        actions.push({ id: 'return-bag', label: 'Return to bag', icon: 'bag', run: () => returnToBag(o.id) });
      }
      break;
    default:
      break;
  }
  if (!edit) return actions;
  actions.push({
    id: 'lock',
    label: o.locked ? 'Unlock (allow moving)' : 'Lock in place',
    icon: o.locked ? 'lock' : 'unlock',
    run: () => toggleLock(o.id),
    primary: true,
    active: o.locked,
    shortcut: 'L',
  });
  if (hasPlayMovable(o)) {
    actions.push({
      id: 'playmove',
      label: 'Movable in Play mode',
      icon: o.playMovable ? 'move' : 'moveOff',
      run: () => togglePlayMovable(o.id),
      active: !!o.playMovable,
    });
  }
  actions.push({ id: 'front', label: 'Bring to front', icon: 'front', run: () => setZOrder(o.id, 'front') });
  actions.push({ id: 'back', label: 'Send to back', icon: 'backward', run: () => setZOrder(o.id, 'back') });
  actions.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy', run: () => duplicateObject(o.id), shortcut: 'Ctrl+D' });
  actions.push({ id: 'delete', label: 'Delete', icon: 'trash', run: () => deleteObject(o.id), danger: true, shortcut: 'Del' });
  return actions;
}
