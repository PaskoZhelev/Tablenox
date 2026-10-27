import Dexie, { type EntityTable } from 'dexie';
import type { Game, StoredAsset } from '../domain/types';

export interface SettingRecord {
  key: string;
  value: unknown;
}

export class TablenoxDB extends Dexie {
  games!: EntityTable<Game, 'id'>;
  assets!: EntityTable<StoredAsset, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor(name = 'tablenox') {
    super(name);
    this.version(1).stores({
      games: 'id, updatedAt, title',
      assets: 'id, createdAt',
      settings: 'key',
    });
  }
}

export const db = new TablenoxDB();
