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

  it('always exempts exact itemId already in positive anchor bank even if embedding drifts below positiveMinSim', () => {
    const anchors: AnchorVector[] = [
      {
        id: 'neg:1',
        polarity: 'negative',
        embedding: l2Normalize(new Float32Array([0.9, 0.4, 0])),
        weight: 1.0,
        lastHitAt: Date.now(),
      },
      {
        id: 'pos:bilibili:BV1CKWXzaEX4',
        itemId: 'BV1CKWXzaEX4',
        polarity: 'positive',
        text: '【恬豆】牢豆释放极致的压抑 | 直播切片',
        embedding: l2Normalize(new Float32Array([0.4, 0.9, 0.2])),
        weight: 1.0,
        lastHitAt: Date.now(),
      },
    ];

    const decision = scoreAgainstAnchors(
      'BV1CKWXzaEX4',
      l2Normalize(new Float32Array([0.88, 0.45, 0])),
      anchors,
      { ...DEFAULT_FILTER_CONFIG, l2Threshold: 0.78, positiveMinSim: 0.82 },
      Date.now(),
      'neural',
      { bypass: false, delta: 0.04, notes: ['极低弹幕(+0.04)'] },
      '【恬豆】牢豆释放极致的压抑',
    );
    expect(decision.blocked).toBe(false);
    expect(decision.reason).toBe('白库精确放行');
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

import {
  decodeQuantizedEmbedding,
  encodeQuantizedEmbedding,
  packSyncSnapshot,
  unpackSyncSnapshot,
} from '@/storage/sync-codec';

describe('Chrome storage.sync chunk codec', () => {
  it('splits large vector banks into <8KB chunks and round-trips losslessly', () => {
    const vectors = Array.from({ length: 120 }, (_, i) => ({
      id: `neg:bilibili:BV${i}`,
      p: (i % 15 === 0 ? 'p' : 'n') as 'n' | 'p',
      pl: 'bilibili' as const,
      iid: `BV${i}`,
      t: `测试样本标题编号${i}，用于验证 Chrome Sync 分片编码和解码不会超过单片 8KB 限制`,
      w: 1,
      c: 1795651200000 + i,
      l: 1795651200000 + i,
    }));

    const { items, chunkCount } = packSyncSnapshot({
      version: 1,
      updatedAt: 1795699999000,
      config: { l2Threshold: 0.72, positiveAlpha: 0.18 },
      rules: [{ k: 'keyword', v: '保姆级' }],
      vectors,
    });

    expect(chunkCount).toBeGreaterThan(1);
    for (const val of Object.values(items)) {
      const size = new TextEncoder().encode(JSON.stringify(val)).length;
      expect(size).toBeLessThan(8192);
    }

    const restored = unpackSyncSnapshot(items);
    expect(restored).not.toBeNull();
    expect(restored!.vectors.length).toBe(120);
    expect(restored!.rules).toEqual([{ k: 'keyword', v: '保姆级' }]);
    expect(restored!.config.l2Threshold).toBe(0.72);
  });

  it('packs and unpacks quantized 512-dim CLAP & 64-dim DSP BGM fingerprints with >0.999 cosine fidelity', () => {
    const rawClap = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.37) * Math.cos(i * 0.13));
    const norm = Math.sqrt(rawClap.reduce((s, v) => s + v * v, 0));
    const clapVec = rawClap.map((v) => v / norm);

    const encoded = encodeQuantizedEmbedding(clapVec);
    const { items, bgmChunkCount } = packSyncSnapshot({
      version: 1,
      updatedAt: 1795700000000,
      config: {},
      rules: [],
      vectors: [],
      bgmFingerprints: [
        {
          id: 'bgm:clap1',
          l: '压抑到极致的瞬间燃爆',
          s: 'b',
          m: 'c',
          e: encoded.e,
          a: encoded.a,
          c: 1795700000000,
        },
      ],
    });

    expect(bgmChunkCount).toBe(1);
    for (const val of Object.values(items)) {
      const size = new TextEncoder().encode(JSON.stringify(val)).length;
      expect(size).toBeLessThan(8192);
    }

    const restored = unpackSyncSnapshot(items);
    expect(restored?.bgmFingerprints?.length).toBe(1);
    const decoded = decodeQuantizedEmbedding(
      restored!.bgmFingerprints![0].e,
      restored!.bgmFingerprints![0].a,
    );
    expect(decoded.length).toBe(512);
    let dot = 0;
    for (let i = 0; i < 512; i++) dot += clapVec[i] * decoded[i];
    expect(dot).toBeGreaterThan(0.999);
  });
});

import { computeSignalAdjustment } from '@/engine/signals';

describe('Observable signal fusion', () => {
  it('bypasses followed creators and refines gray-zone scores via like/danmaku/duration', () => {
    const followed = computeSignalAdjustment(
      makeItem({ is_followed: true }),
      { authorFeedCount: 2, authorPositiveCount: 0 },
    );
    expect(followed.bypass).toBe(true);

    const lowQualityClip = computeSignalAdjustment(
      makeItem({
        duration_sec: 45,
        metrics: { views: 20000, likes: 120, danmaku: 0 },
      }),
      { authorFeedCount: 1, authorPositiveCount: 0 },
    );
    expect(lowQualityClip.bypass).toBe(false);
    expect(lowQualityClip.delta).toBeCloseTo(0.2, 2); // clamped max +0.20 (0.08+0.06+0.04+0.03 -> 0.20)

    const highQualityLong = computeSignalAdjustment(
      makeItem({
        duration_sec: 1200,
        metrics: { views: 10000, likes: 800, danmaku: 80 },
      }),
      { authorFeedCount: 0, authorPositiveCount: 0 },
    );
    expect(highQualityLong.delta).toBeCloseTo(-0.14, 2); // -0.06 -0.04 -0.04
  });
});

import {
  analyzeAudioStyle,
  analyzeDecodedPcm,
  computeBgmFingerprint,
  matchBgmFingerprint,
  matchOverusedBgmTitle,
} from '@/engine/audio-fingerprint';

describe('BGM acoustic fingerprint & L1 style guard', () => {
  it('matches same BGM spectrum with voiceover perturbation and rejects distinct BGM', () => {
    const makeFrames = (bassDb: number, midDb: number, highDb: number, wobble = 0) =>
      Array.from({ length: 24 }, (_, t) => {
        const frame = new Float32Array(1024).fill(-85);
        for (let i = 2; i < 16; i++) frame[i] = bassDb + Math.sin(t * 0.7) * 4;
        for (let i = 16; i < 60; i++) frame[i] = midDb + wobble * Math.cos(t);
        for (let i = 60; i < 250; i++) frame[i] = highDb + Math.cos(t * 0.5) * 3;
        return frame;
      });

    const bgmA = computeBgmFingerprint(makeFrames(-22, -55, -28));
    // Same BGM with louder speech in mid-band (300-850Hz) and slightly different volume
    const bgmAWithVoice = computeBgmFingerprint(makeFrames(-25, -42, -31, 3));
    // Completely different acoustic profile (mid-heavy, quiet bass & highs)
    const bgmB = computeBgmFingerprint(makeFrames(-80, -20, -78));

    const hit = matchBgmFingerprint(bgmAWithVoice, [
      { id: 'bgm:1', label: '悬疑罐头', severity: 'block', embedding: bgmA },
    ]);
    expect(hit.matched).toBe(true);
    expect(hit.score).toBeGreaterThan(0.88);

    const miss = matchBgmFingerprint(bgmB, [
      { id: 'bgm:1', label: '悬疑罐头', severity: 'block', embedding: bgmA },
    ]);
    expect(miss.matched).toBe(false);
    expect(miss.score).toBeLessThan(0.8);
  });

  it('detects pounding bass remix, repetitive meme loop, overused BGM titles, and gates calm speech', () => {
    // 1. Pounding ~125 BPM bass beat (period = 6 frames @ 80ms = 0.48s)
    const bassBeatFrames = Array.from({ length: 40 }, (_, t) => {
      const frame = new Float32Array(1024).fill(-80);
      const kick = t % 6 === 0 || t % 6 === 1 ? -8 : -48;
      for (let i = 2; i <= 7; i++) frame[i] = kick;
      for (let i = 60; i < 200; i++) frame[i] = -32;
      return frame;
    });
    const beatStyle = analyzeAudioStyle(bassBeatFrames);
    expect(beatStyle.isLikelySpeechOnly).toBe(false);
    expect(beatStyle.bassBeatScore).toBeGreaterThanOrEqual(0.72);
    expect(beatStyle.hardDisgust).toBe(true);

    // 2. Repetitive 10-frame meme loop (period = 0.8s)
    const loopFrames = Array.from({ length: 40 }, (_, t) => {
      const frame = new Float32Array(1024).fill(-75);
      const phase = t % 10;
      const peakBin = 30 + phase * 18;
      for (let i = peakBin; i < peakBin + 12; i++) frame[i] = -15;
      return frame;
    });
    const loopStyle = analyzeAudioStyle(loopFrames);
    expect(loopStyle.loopScore).toBeGreaterThanOrEqual(0.82);
    expect(loopStyle.hardDisgust).toBe(true);

    // 3. Calm non-repetitive speech (dominant mid band, weak bass & highs, varying syllable formants)
    let seed = 1337;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const speechFrames = Array.from({ length: 40 }, () => {
      const frame = new Float32Array(1024).fill(-85);
      for (let i = 13; i < 45; i++) {
        frame[i] = -45 + nextRand() * 30;
      }
      return frame;
    });
    const speechStyle = analyzeAudioStyle(speechFrames);
    expect(speechStyle.isLikelySpeechOnly).toBe(true);
    expect(speechStyle.hardDisgust).toBe(false);

    // 3b. Steady dramatic/ambient build-up (flat spectrum, NOT a repetitive meme loop)
    const steadyPadFrames = Array.from({ length: 40 }, (_, t) => {
      const frame = new Float32Array(1024).fill(-70);
      const swell = -35 + t * 0.4;
      for (let i = 10; i < 120; i++) frame[i] = swell;
      return frame;
    });
    const padStyle = analyzeAudioStyle(steadyPadFrames);
    expect(padStyle.loopScore).toBeLessThan(0.5);
    expect(padStyle.hardDisgust).toBe(false);

    // 4. Built-in overused BGM title detection
    expect(matchOverusedBgmTitle('Hawk Nelson - Sold Out (Official)')).toBe('sold out');
    expect(matchOverusedBgmTitle('肖邦夜曲 Op.9 No.2')).toBeNull();
  });

  it('skips silent intro and analyzes peak 5s window from offline decoded 10s PCM', () => {
    const sr = 16000;
    const pcm = new Float32Array(sr * 10);
    // 0..2s: silence (intro); 2..10s: pounding 125 BPM (0.48s period) broadband bass kicks + synth
    for (let i = sr * 2; i < pcm.length; i++) {
      const sec = i / sr;
      const beatPhase = (sec % 0.48) / 0.48;
      const kickEnv = beatPhase < 0.3 ? 0.45 : 0.04;
      const kick =
        Math.sin(2 * Math.PI * 72 * sec) +
        Math.sin(2 * Math.PI * 96 * sec) +
        Math.sin(2 * Math.PI * 124 * sec) +
        Math.sin(2 * Math.PI * 152 * sec);
      pcm[i] = kickEnv * kick + 0.12 * Math.sin(2 * Math.PI * 2400 * sec);
    }

    const sample = analyzeDecodedPcm(pcm, sr, true);
    expect(sample).not.toBeNull();
    expect(sample!.fingerprint.length).toBe(64);
    expect(sample!.pcmInt16 && sample!.pcmInt16.length).toBeGreaterThan(24000);
    expect(sample!.style.isLikelySpeechOnly).toBe(false);
    expect(sample!.style.bassBeatScore).toBeGreaterThan(0.5);
  });
});

import { extractMatchingSegments, sha256Prefix } from '@/engine/sponsorblock';

describe('Bilibili SponsorBlock helper', () => {
  it('computes 4-char SHA-256 prefix and extracts matching BV skip/full segments', async () => {
    const prefix = await sha256Prefix('BV1xx411c7mD', 4);
    expect(prefix).toMatch(/^[0-9a-f]{4}$/);

    const segments = extractMatchingSegments(
      [
        {
          videoID: 'BV1OTHER0001',
          segments: [{ UUID: 'u0', category: 'sponsor', actionType: 'skip', segment: [10, 40] }],
        },
        {
          videoID: 'BV1xx411c7mD',
          segments: [
            { UUID: 'u1', category: 'sponsor', actionType: 'skip', segment: [60.5, 110.2] },
            { UUID: 'u2', category: 'sponsor', actionType: 'full', segment: [0, 0] },
          ],
        },
      ],
      'BV1xx411c7mD',
    );
    expect(segments.length).toBe(2);
    expect(segments[0].UUID).toBe('u1');
    expect(segments[1].actionType).toBe('full');
  });
});
