import type { PetSkinId } from '@/ui/pet-skins';

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
  /** True when the creator is already followed by the user (natural whitelist protection). */
  is_followed?: boolean;
  /** True when the card is a paid-boosted / rocket-promoted ("创作推广 / 起飞") video. */
  is_promoted?: boolean;
  fetched_at: number;
}

export type FilterLayer = 'L1' | 'L2' | 'L3' | 'FAIL_OPEN';

export interface FilterDecisionDebug {
  maxNeg: number;
  maxPos: number;
  effectivePos: number;
  threshold: number;
  matchedNegTitle?: string;
  matchedPosTitle?: string;
  signalDelta?: number;
  signalNotes?: string[];
}

export interface FilterDecision {
  item_id: string;
  blocked: boolean;
  layer: FilterLayer;
  score: number;
  reason?: string;
  /** ID of the negative anchor that triggered L2 blocking (used for spit down-weighting). */
  matchedAnchorId?: string;
  /** Short title of the matched negative anchor for user-facing transparency. */
  matchedTitle?: string;
  /** Detailed scoring breakdown for optional debug overlay. */
  debug?: FilterDecisionDebug;
}

export interface FilterConfig {
  /** Threshold for L2 boundary score: Score_neg - alpha * Score_pos > threshold. */
  l2Threshold: number;
  /** Repulsion coefficient for positive whitelist anchors. */
  positiveAlpha: number;
  /** Minimum similarity to a positive anchor before whitelist protection activates. */
  positiveMinSim: number;
  /** Timeout (ms) before L2 inference fails open. */
  inferenceTimeoutMs: number;
  /** Whether L2 semantic vector filtering is enabled. */
  enableL2: boolean;
  /** Active companion pet avatar skin. */
  petSkin: PetSkinId;
  /** Also click Bilibili's native "not interested" action when feeding a card. */
  syncNativeDislike: boolean;
  /** Show per-card scoring breakdown badges for debugging & tuning. */
  debugMode: boolean;
  /** Automatically eat and hide Bilibili native ad cards. */
  hideAds: boolean;
  /** Automatically hide non-video floor/promo cards (live, drama, documentary, manga, etc.). */
  hideFloorCards: boolean;
  /** Fuse observable signals (like rate, danmaku, duration, followed status, author history) into L2 scoring. */
  enableSignalFusion: boolean;
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  l2Threshold: 0.78,
  positiveAlpha: 0.18,
  positiveMinSim: 0.82,
  inferenceTimeoutMs: 4000,
  enableL2: true,
  petSkin: 'pikachu',
  syncNativeDislike: true,
  debugMode: false,
  hideAds: true,
  hideFloorCards: true,
  enableSignalFusion: true,
};
