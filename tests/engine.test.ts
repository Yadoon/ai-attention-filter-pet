import { describe, expect, it } from 'vitest';
import { createEmptyRuleSet, evaluateL1 } from '@/engine/l1-rules';
import {
  l2Normalize,
  scoreAgainstAnchors,
  type AnchorVector,
  type InferenceProvider,
} from '@/engine/l2-vector';
import { evaluateBatch } from '@/engine/pipeline';
import { DEFAULT_FILTER_CONFIG, type NormalizedItem } from '@/types/item';

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    platform: 'bilibili',
    item_id: 'BV1TEST0001',
    media_type: 'video',
    author_id: '1001',
    author_name: '测试UP',
    title: '普通视频标题',
    tags: [],
    fetched_at: 1795651200,
    ...overrides,
  };
}

describe('L1 rules engine', () => {
  it('bypasses all rules for whitelisted authors', () => {
    const rules = createEmptyRuleSet();
    rules.allowedAuthors.add('1001');
    rules.blockedKeywords.push('震惊');

    const item = makeItem({ title: '震惊！99%的人都不知道的真相' });
    const { decision } = evaluateL1(item, rules);
    expect(decision?.blocked).toBe(false);
    expect(decision?.layer).toBe('L1');
  });

  it('blocks when repeated canned BGM combines with AI clickbait template', () => {
    const rules = createEmptyRuleSet();
    rules.suspectBgmCounts.set('bgm_suspense_01', 2);

    const item = makeItem({
      title: '震惊！99%的人都不知道的秘密',
      bgm: { music_id: 'bgm_suspense_01', music_title: '悬疑配乐' },
    });
    const { decision } = evaluateL1(item, rules);
    expect(decision?.blocked).toBe(true);
    expect(decision?.reason).toContain('罐头 BGM');
  });
});

describe('L2 negative-vs-positive boundary scoring', () => {
  it('blocks near-duplicate spam but protects same-topic quality content via positive anchor', () => {
    const now = Date.now();
    // Same-topic space: dim 0 = topic (GPT-5), dim 1 = slop style, dim 2 = deep tech style
    const negSlop = l2Normalize(new Float32Array([0.85, 0.52, 0.0]));
    const posQuality = l2Normalize(new Float32Array([0.85, 0.0, 0.52]));

    const anchors: AnchorVector[] = [
      { id: 'neg:1', polarity: 'negative', embedding: negSlop, weight: 1.0, lastHitAt: now },
      { id: 'pos:1', polarity: 'positive', embedding: posQuality, weight: 1.0, lastHitAt: now },
    ];

    const config = { ...DEFAULT_FILTER_CONFIG, l2Threshold: 0.65, positiveAlpha: 0.35 };

    // Another slop video on the same topic -> should be blocked
    const anotherSlop = l2Normalize(new Float32Array([0.84, 0.54, 0.0]));
    const slopDecision = scoreAgainstAnchors('BV_SLOP', anotherSlop, anchors, config, now);
    expect(slopDecision.blocked).toBe(true);
    expect(slopDecision.matchedAnchorId).toBe('neg:1');

    // High-quality deep dive on the same topic -> protected by positive anchor
    const qualityVideo = l2Normalize(new Float32Array([0.84, 0.0, 0.54]));
    const qualityDecision = scoreAgainstAnchors('BV_GOOD', qualityVideo, anchors, config, now);
    expect(qualityDecision.blocked).toBe(false);
  });
});

import { extractTopKeywords } from '@/engine/keywords';

describe('Pipeline Fail-Open degradation', () => {
  it('fails open without blocking cards when local inference times out', async () => {
    const slowProvider: InferenceProvider = {
      name: 'mock-slow',
      isReady: () => true,
      embedTexts: () => new Promise((resolve) => setTimeout(() => resolve([]), 200)),
    };

    const anchors: AnchorVector[] = [
      {
        id: 'neg:1',
        polarity: 'negative',
        embedding: l2Normalize(new Float32Array([1, 0, 0])),
        weight: 1,
        lastHitAt: Date.now(),
      },
    ];

    const result = await evaluateBatch([makeItem()], {
      rules: createEmptyRuleSet(),
      anchors,
      config: { ...DEFAULT_FILTER_CONFIG, inferenceTimeoutMs: 20 },
      provider: slowProvider,
    });

    expect(result.degraded).toBe(true);
    expect(result.decisions[0].blocked).toBe(false);
    expect(result.decisions[0].layer).toBe('FAIL_OPEN');
  });
});

import { NgramEmbeddingProvider } from '@/engine/ngram-embedder';

describe('Local junk word cloud extractor', () => {
  it('extracts frequent meaningful tokens while filtering stop words', () => {
    const keywords = extractTopKeywords([
      '震惊！AI 批量生产低质套路内容',
      '都在用的 AI 套路揭秘，震惊全网',
      'AI 批量套路是怎么污染推荐流的',
    ]);
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords[0].word).toBe('ai');
    expect(keywords[0].count).toBe(3);
    expect(keywords.some((k) => k.word === '震惊' && k.count === 2)).toBe(true);
    expect(keywords.some((k) => k.word === '批量' && k.count === 2)).toBe(true);
    expect(keywords.some((k) => k.word === '的' || k.word === '怎么')).toBe(false);
  });
});

describe('Offline N-gram vector fallback', () => {
  it('auto-blocks similar titles immediately even without neural model loaded', async () => {
    const ngram = new NgramEmbeddingProvider();
    const fedTitle = '小米最难三季报！利润少一半到底发生了啥？';
    const [fedVec] = await ngram.embedTexts([fedTitle]);

    const anchors: AnchorVector[] = [
      {
        id: 'neg:bilibili:BV_FED',
        polarity: 'negative',
        embedding: fedVec,
        embedder: 'ngram',
        text: fedTitle,
        weight: 1.0,
        lastHitAt: Date.now(),
      },
    ];

    const result = await evaluateBatch(
      [
        makeItem({ item_id: 'BV_SIMILAR', title: '小米三季报利润少一半，到底发生了啥' }),
        makeItem({ item_id: 'BV_UNRELATED', title: '手工木工制作一把古风折扇全过程' }),
      ],
      {
        rules: createEmptyRuleSet(),
        anchors,
        config: DEFAULT_FILTER_CONFIG,
        provider: ngram,
      },
    );

    expect(result.degraded).toBe(false);
    expect(result.decisions[0].blocked).toBe(true);
    expect(result.decisions[0].reason).toContain('词面相似');
    expect(result.decisions[1].blocked).toBe(false);
  });
});
