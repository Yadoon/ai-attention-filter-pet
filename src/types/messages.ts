import type { FilterConfig, FilterDecision, NormalizedItem } from './item';

export type ExtensionMessage =
  | { type: 'EVALUATE_BATCH'; items: NormalizedItem[] }
  | { type: 'FEED_ITEM'; item: NormalizedItem; blockAuthor?: boolean }
  | { type: 'SPIT_ITEM'; item: NormalizedItem; matchedAnchorId?: string }
  | { type: 'UNDO_FEED'; itemId: string }
  | { type: 'GET_STATUS' }
  | { type: 'UPDATE_CONFIG'; patch: Partial<FilterConfig> };

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
  backend: 'webgpu' | 'wasm' | 'ngram';
  todayEaten: number;
  negativeCount: number;
  positiveCount: number;
  authorFeedCounts: Record<string, number>;
  topKeywords: KeywordCount[];
  recentEaten: RecentEatenEntry[];
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
