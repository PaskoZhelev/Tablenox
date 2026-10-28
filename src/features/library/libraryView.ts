import type { Game } from '../../domain/types';

export type LibraryView = 'grid' | 'list';
export type LibrarySort = 'updated' | 'played' | 'created' | 'name';

export const LIBRARY_SORT_LABELS: Record<LibrarySort, string> = {
  updated: 'Last changed',
  played: 'Last played',
  created: 'Newest first',
  name: 'Name (A–Z)',
};

export interface LibraryPrefs {
  view: LibraryView;
  sort: LibrarySort;
}

export const DEFAULT_LIBRARY_PREFS: LibraryPrefs = { view: 'grid', sort: 'updated' };
const PREFS_KEY = 'tablenox.library';

export function readLibraryPrefs(): LibraryPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<LibraryPrefs>;
    return {
      view: raw.view === 'list' ? 'list' : 'grid',
      sort: raw.sort && raw.sort in LIBRARY_SORT_LABELS ? raw.sort : DEFAULT_LIBRARY_PREFS.sort,
    };
  } catch {
    return DEFAULT_LIBRARY_PREFS;
  }
}

export function writeLibraryPrefs(prefs: LibraryPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable (private mode); the choice just isn't remembered.
  }
}

/** Lower-cased text without accents, so "Été" matches "ete". */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

const newestFirst = (a: string | undefined, b: string | undefined) => (b ?? '').localeCompare(a ?? '');

/**
 * Games whose title contains every word of `query` (case and accents ignored), in the chosen order. Never-played
 * games come last when sorting by last played.
 */
export function filterAndSortGames(games: readonly Game[], query: string, sort: LibrarySort): Game[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matching = words.length ? games.filter((g) => words.every((w) => fold(g.title).includes(w))) : [...games];
  const byName = (a: Game, b: Game) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  return matching.sort((a, b) => {
    switch (sort) {
      case 'name':
        return byName(a, b);
      case 'created':
        return newestFirst(a.createdAt, b.createdAt) || byName(a, b);
      case 'played':
        if (!a.lastPlayedAt !== !b.lastPlayedAt) return a.lastPlayedAt ? -1 : 1;
        return newestFirst(a.lastPlayedAt, b.lastPlayedAt) || newestFirst(a.updatedAt, b.updatedAt);
      case 'updated':
        return newestFirst(a.updatedAt, b.updatedAt) || byName(a, b);
    }
  });
}
