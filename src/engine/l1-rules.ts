import type { FilterDecision, NormalizedItem } from '@/types/item';

export interface L1RuleSet {
  allowedAuthors: Set<string>;
  blockedAuthors: Set<string>;
  blockedKeywords: string[];
  /** music_id -> number of times fed by the user */
  suspectBgmCounts: Map<string, number>;
}

const AI_TEMPLATE_PATTERNS: RegExp[] = [
  /震惊[!！].{0,8}不知道/,
  /99%的人都不知道/,
  /在这个.{1,10}的时代/,
  /深度解析[:：].{0,12}(震撼|颠覆|炸裂)/,
  /千万别再.{1,10}了/,
];

const EXTRA_CLICKBAIT_PATTERNS: RegExp[] = [
  /彻底颠覆|王炸|保姆级|全网最全|赚米|月入.{0,4}万|普通人逆袭/,
];

export function isClickbaitTitle(title: string): boolean {
  return (
    AI_TEMPLATE_PATTERNS.some((re) => re.test(title)) ||
    EXTRA_CLICKBAIT_PATTERNS.some((re) => re.test(title))
  );
}

const BGM_SUSPECT_MIN_HITS = 2;
const BGM_SUSPECT_SCORE = 40;
const AI_TEMPLATE_SCORE = 35;
const L1_WEIGHTED_BLOCK_THRESHOLD = 70;

export function createEmptyRuleSet(): L1RuleSet {
  return {
    allowedAuthors: new Set(),
    blockedAuthors: new Set(),
    blockedKeywords: [],
    suspectBgmCounts: new Map(),
  };
}

/**
 * L1 deterministic & metadata weighted filter (< 1ms, zero model compute).
 * Returns a decisive FilterDecision if matched, or `null` to pass to L2.
 */
export function evaluateL1(
  item: NormalizedItem,
  rules: L1RuleSet,
): { decision: FilterDecision | null; suspectScore: number } {
  // 1. Explicit whitelist bypasses all downstream layers.
  if (item.author_id && rules.allowedAuthors.has(item.author_id)) {
    return {
      decision: {
        item_id: item.item_id,
        blocked: false,
        layer: 'L1',
        score: 0,
        reason: '白名单作者放行',
      },
      suspectScore: 0,
    };
  }

  // 2. Explicit author blocklist.
  if (item.author_id && rules.blockedAuthors.has(item.author_id)) {
    return {
      decision: {
        item_id: item.item_id,
        blocked: true,
        layer: 'L1',
        score: 100,
        reason: `已屏蔽作者：${item.author_name || item.author_id}`,
      },
      suspectScore: 100,
    };
  }

  const haystack = `${item.title} ${item.snippet ?? ''} ${item.tags.join(' ')}`.toLowerCase();

  // 3. Explicit keyword blocklist.
  for (const kw of rules.blockedKeywords) {
    const trimmed = kw.trim().toLowerCase();
    if (trimmed && haystack.includes(trimmed)) {
      return {
        decision: {
          item_id: item.item_id,
          blocked: true,
          layer: 'L1',
          score: 100,
          reason: `命中关键词：${kw}`,
        },
        suspectScore: 100,
      };
    }
  }

  // 4. Metadata & template soft-scoring (e.g., repeated canned BGM + AI clickbait template).
  let suspectScore = 0;
  const reasons: string[] = [];

  if (item.bgm?.music_id) {
    const bgmHits = rules.suspectBgmCounts.get(item.bgm.music_id) ?? 0;
    if (bgmHits >= BGM_SUSPECT_MIN_HITS) {
      suspectScore += BGM_SUSPECT_SCORE;
      reasons.push(`高危罐头 BGM (${item.bgm.music_title || item.bgm.music_id})`);
    }
  }

  for (const pattern of AI_TEMPLATE_PATTERNS) {
    if (pattern.test(item.title)) {
      suspectScore += AI_TEMPLATE_SCORE;
      reasons.push('命中高频 AI 模板标题');
      break;
    }
  }

  if (suspectScore >= L1_WEIGHTED_BLOCK_THRESHOLD) {
    return {
      decision: {
        item_id: item.item_id,
        blocked: true,
        layer: 'L1',
        score: suspectScore,
        reason: reasons.join(' + '),
      },
      suspectScore,
    };
  }

  return { decision: null, suspectScore };
}
