export type Platform = 'bilibili' | 'xiaohongshu' | 'douyin';

export type MediaType = 'video' | 'short_video' | 'image_text';

export interface BgmInfo {
  music_id: string;
  music_title?: string;
}

export interface ItemMetrics {
  views?: number;
  likes?: number;
  danmaku?: number;
}

/**
 * Normalized content schema shared across all site adapters and filter layers.
 */
export interface NormalizedItem {
  platform: Platform;
  item_id: string;
  media_type: MediaType;
  author_id: string;
  author_name: string;
  title: string;
  snippet?: string;
  tags: string[];
  cover_url?: string;
  bgm?: BgmInfo;
  duration_sec?: number;
  metrics?: ItemMetrics;
  fetched_at: number;
}

export type FilterLayer = 'L1' | 'L2' | 'L3' | 'FAIL_OPEN';

export interface FilterDecision {
  item_id: string;
  blocked: boolean;
  layer: FilterLayer;
  score: number;
  reason?: string;
  /** ID of the negative anchor that triggered L2 blocking (used for spit down-weighting). */
  matchedAnchorId?: string;
}

export interface FilterConfig {
  /** Threshold for L2 boundary score: Score_neg - alpha * Score_pos > threshold. */
  l2Threshold: number;
  /** Repulsion coefficient for positive whitelist anchors. */
  positiveAlpha: number;
  /** Timeout (ms) before L2 inference fails open. */
  inferenceTimeoutMs: number;
  /** Whether L2 semantic vector filtering is enabled. */
  enableL2: boolean;
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  l2Threshold: 0.78,
  positiveAlpha: 0.35,
  inferenceTimeoutMs: 500,
  enableL2: true,
};
