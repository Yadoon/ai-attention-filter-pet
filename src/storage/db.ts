import Dexie, { type EntityTable } from 'dexie';
import type { Platform } from '@/types/item';

export interface VectorRecord {
  id: string;
  polarity: 'negative' | 'positive';
  platform: Platform;
  itemId: string;
  text: string;
  /** L2-normalized embedding stored as plain number array for IndexedDB portability. */
  embedding: number[];
  /** Weight in (0, 1]; down-weighted when a user spits out a false positive. */
  weight: number;
  createdAt: number;
  lastHitAt: number;
}

export interface RuleRecord {
  id?: number;
  kind: 'author_block' | 'author_allow' | 'keyword' | 'bgm_suspect';
  value: string;
  platform?: Platform;
  hitCount: number;
  createdAt: number;
}

export interface DailyStatRecord {
  /** YYYY-MM-DD */
  date: string;
  eatenCount: number;
  spitCount: number;
}

export class PetDatabase extends Dexie {
  vectors!: EntityTable<VectorRecord, 'id'>;
  rules!: EntityTable<RuleRecord, 'id'>;
  stats!: EntityTable<DailyStatRecord, 'date'>;

  constructor() {
    super('AttentionFilterPetDB');
    this.version(1).stores({
      vectors: 'id, polarity, platform, itemId, createdAt, lastHitAt',
      rules: '++id, kind, value, [kind+value]',
      stats: 'date',
    });
  }
}

export const db = new PetDatabase();

export function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
