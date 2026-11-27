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
  /** Which embedder produced this vector ('neural' for bge-small-zh, 'ngram' for offline fallback). */
  embedder?: 'neural' | 'ngram';
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

export interface BgmFingerprintRecord {
  id: string;
  label: string;
  /** 'block' = hard dislike (annoying BGM), 'penalty' = overused/low-taste soft signal (e.g. Sold Out). */
  severity?: 'block' | 'penalty';
  /** 'dsp' = 64-dim spectral fingerprint, 'clap' = 512-dim CLAP semantic audio embedding. */
  embedder?: 'dsp' | 'clap';
  /** L2-normalized embedding (64-dim for dsp, 512-dim for clap). */
  embedding: number[];
  sourceItemId?: string;
  createdAt: number;
}

export class PetDatabase extends Dexie {
  vectors!: EntityTable<VectorRecord, 'id'>;
  rules!: EntityTable<RuleRecord, 'id'>;
  stats!: EntityTable<DailyStatRecord, 'date'>;
  bgmFingerprints!: EntityTable<BgmFingerprintRecord, 'id'>;

  constructor() {
    super('AttentionFilterPetDB');
    this.version(1).stores({
      vectors: 'id, polarity, platform, itemId, createdAt, lastHitAt',
      rules: '++id, kind, value, [kind+value]',
      stats: 'date',
    });
    this.version(2).stores({
      vectors: 'id, polarity, platform, itemId, createdAt, lastHitAt',
      rules: '++id, kind, value, [kind+value]',
      stats: 'date',
      bgmFingerprints: 'id, createdAt',
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
