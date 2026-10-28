import { describe, expect, it } from 'vitest';
import { filterAndSortGames } from '../features/library/libraryView';
import { fixtureGame } from './fixtures';

const game = (title: string, createdAt: string, updatedAt: string, lastPlayedAt?: string) => ({
  ...fixtureGame(title),
  title,
  createdAt,
  updatedAt,
  ...(lastPlayedAt ? { lastPlayedAt } : {}),
});

const games = [
  game('Zombie Dice', '2026-01-01', '2026-03-01', '2026-02-01'),
  game('Éclat', '2026-02-01', '2026-01-15'),
  game('Card game 10', '2026-03-01', '2026-02-15', '2026-03-05'),
  game('Card game 2', '2026-01-10', '2026-01-20'),
];
const titles = (list: { title: string }[]) => list.map((g) => g.title);

describe('library list', () => {
  it('sorts by last change, last played (never played last), creation and name', () => {
    expect(titles(filterAndSortGames(games, '', 'updated'))).toEqual(['Zombie Dice', 'Card game 10', 'Card game 2', 'Éclat']);
    expect(titles(filterAndSortGames(games, '', 'played'))).toEqual(['Card game 10', 'Zombie Dice', 'Card game 2', 'Éclat']);
    expect(titles(filterAndSortGames(games, '', 'created'))).toEqual(['Card game 10', 'Éclat', 'Card game 2', 'Zombie Dice']);
    // Names compare numbers naturally and ignore accents and case.
    expect(titles(filterAndSortGames(games, '', 'name'))).toEqual(['Card game 2', 'Card game 10', 'Éclat', 'Zombie Dice']);
  });

  it('searches titles by every word, ignoring case and accents', () => {
    expect(titles(filterAndSortGames(games, 'eclat', 'name'))).toEqual(['Éclat']);
    expect(titles(filterAndSortGames(games, '  GAME  10 ', 'name'))).toEqual(['Card game 10']);
    expect(filterAndSortGames(games, 'chess', 'name')).toEqual([]);
    // The input list isn't reordered.
    expect(titles(games)[0]).toBe('Zombie Dice');
  });
});
