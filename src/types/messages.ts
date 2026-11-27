import type {
  BgmFingerprintRecord,
  DailyStatRecord,
  RuleRecord,
  VectorRecord,
} from '@/storage/db';
import type { SyncSnapshot } from '@/storage/sync-codec';
import type { SponsorSegment } from '@/engine/sponsorblock';
import type { FilterConfig, FilterDecision, NormalizedItem } from './item';

export interface PetDataBackup {
  schemaVersion: 1;
  exportedAt: string;
  config?: Partial<FilterConfig>;
  vectors: VectorRecord[];
  rules: RuleRecord[];
  stats: DailyStatRecord[];
  bgmFingerprints?: BgmFingerprintRecord[];
}

export type ExtensionMessage =
  | { type: 'EVALUATE_BATCH'; items: NormalizedItem[] }
  | { type: 'FEED_ITEM'; item: NormalizedItem; blockAuthor?: boolean }
  | { type: 'SPIT_ITEM'; item: NormalizedItem; matchedAnchorId?: string }
  | { type: 'UNDO_FEED'; itemId: string }
  | { type: 'GET_STATUS' }
  | { type: 'UPDATE_CONFIG'; patch: Partial<FilterConfig> }
  | { type: 'ADD_RULE'; kind: 'keyword' | 'author_block'; value: string }
  | { type: 'REMOVE_RULE'; id: number }
  | { type: 'REMOVE_VECTOR'; id: string }
  | { type: 'EXPORT_DATA' }
  | { type: 'IMPORT_DATA'; data: PetDataBackup; mode?: 'merge' | 'replace' }
  | { type: 'GET_SYNC_SNAPSHOT' }
  | { type: 'APPLY_SYNC_SNAPSHOT'; snapshot: SyncSnapshot }
  | { type: 'SYNC_NOW' }
  | {
      type: 'ADD_BGM_FINGERPRINT';
      label: string;
      severity?: 'block' | 'penalty';
      embedding: number[];
      pcmInt16?: number[];
      sourceItemId?: string;
    }
  | { type: 'REMOVE_BGM_FINGERPRINT'; id: string }
  | { type: 'MATCH_BGM_FINGERPRINT'; embedding: number[]; pcmInt16?: number[] }
  | { type: 'GET_SPONSOR_SEGMENTS'; bvid: string };

export interface BgmFingerprintSummary {
  id: string;
  label: string;
  severity: 'block' | 'penalty';
  embedder: 'dsp' | 'clap';
}

export interface RuleSummary {
  id: number;
  kind: 'keyword' | 'author_block';
  value: string;
}

export interface AnchorSummary {
  id: string;
  title: string;
}

export interface KeywordCount {
  word: string;
  count: number;
}

export interface RecentEatenEntry {
  itemId: string;
  title: string;
  reason: string;
  timestamp: number;
}

export interface PetStatus {
  modelReady: boolean;
  modelLoading: boolean;
  clapReady: boolean;
  clapLoading: boolean;
  backend: 'webgpu' | 'wasm' | 'ngram';
  todayEaten: number;
  negativeCount: number;
  positiveCount: number;
  authorFeedCounts: Record<string, number>;
  topKeywords: KeywordCount[];
  recentEaten: RecentEatenEntry[];
  rules: RuleSummary[];
  positiveAnchors: AnchorSummary[];
  bgmFingerprints: BgmFingerprintSummary[];
  config: FilterConfig;
}

export type EvaluateBatchResponse = {
  decisions: FilterDecision[];
  degraded: boolean;
};

export type FeedItemResponse = {
  ok: boolean;
  authorFeedCount: number;
  suggestBlockAuthor: boolean;
};

export type ExportDataResponse = {
  ok: boolean;
  data?: PetDataBackup;
};

export type ImportDataResponse = {
  ok: boolean;
  importedVectors: number;
  importedRules: number;
  importedBgm?: number;
  error?: string;
};

export type SyncNowResponse = {
  ok: boolean;
  syncedVectors: number;
  pulledVectors: number;
  syncedBgm?: number;
  pulledBgm?: number;
  error?: string;
};

export type MatchBgmResponse = {
  ok: boolean;
  matched: boolean;
  score: number;
  label?: string;
  severity?: 'block' | 'penalty';
  id?: string;
};

export type SponsorSegmentsResponse = {
  ok: boolean;
  segments: SponsorSegment[];
};
