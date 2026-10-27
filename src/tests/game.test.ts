import { describe, expect, it } from 'vitest';
import { duplicateGame } from '../domain/game';
import { parseGame, SchemaError } from '../domain/schema';
import { SCHEMA_VERSION } from '../domain/types';
import { fixtureGame } from './fixtures';

describe('game schema', () => {
  it('accepts valid games', () => {
    const g = fixtureGame('a1');
    expect(parseGame(JSON.parse(JSON.stringify(g)))).toEqual(g);
  });

  it('accepts a table colour and custom die faces', () => {
    const g = fixtureGame('a1');
    g.tableColor = '#2f4f6f';
    g.objects = g.objects.map((o) =>
      o.kind === 'die'
        ? {
            ...o,
            faces: [
              { id: 'f1', label: 'Sun', assetId: 'a1' },
              { id: 'f2', label: '' },
            ],
          }
        : o,
    );
    expect(parseGame(JSON.parse(JSON.stringify(g)))).toEqual(g);
  });

  it('rejects newer and unknown schema versions with a clear message', () => {
    expect(() => parseGame({ ...fixtureGame(), schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer version/);
    expect(() => parseGame({ ...fixtureGame(), schemaVersion: 0 })).toThrow(/Unsupported schema version/);
  });

  it('rejects malformed objects and non-objects', () => {
    const bad = JSON.parse(JSON.stringify(fixtureGame()));
    bad.objects[0].width = -5;
    expect(() => parseGame(bad)).toThrow(SchemaError);
    const bad2 = JSON.parse(JSON.stringify(fixtureGame()));
    bad2.objects.find((o: { kind: string }) => o.kind === 'die').sides = 7;
    expect(() => parseGame(bad2)).toThrow(SchemaError);
    expect(() => parseGame(null)).toThrow(SchemaError);
    expect(() => parseGame('hello')).toThrow(SchemaError);
  });

  it('duplicates games with a new id', () => {
    const g = fixtureGame();
    const d = duplicateGame(g);
    expect(d.id).not.toBe(g.id);
    expect(d.objects).toEqual(g.objects);
    expect(d.objects).not.toBe(g.objects);
  });
});
