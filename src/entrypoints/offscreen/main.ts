import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { extractTopKeywords } from '@/engine/keywords';
import { createEmptyRuleSet, type L1RuleSet } from '@/engine/l1-rules';
import {
  buildEmbeddingText,
  l2Normalize,
  type AnchorVector,
  type InferenceProvider,
} from '@/engine/l2-vector';
import { evaluateBatch } from '@/engine/pipeline';
import { db, todayKey } from '@/storage/db';
import { DEFAULT_FILTER_CONFIG, type FilterConfig } from '@/types/item';
import type { ExtensionMessage, PetStatus, RecentEatenEntry } from '@/types/messages';

const MODEL_ID = 'Xenova/bge-small-zh-v1.5';
const MAX_NEGATIVE_ANCHORS = 1000;
const AUTHOR_BLOCK_SUGGEST_THRESHOLD = 3;

env.allowLocalModels = false;
env.useBrowserCache = true;

class TransformersEmbeddingProvider implements InferenceProvider {
  readonly name = MODEL_ID;
  private extractor: FeatureExtractionPipeline | null = null;
  private loadingPromise: Promise<void> | null = null;
  public backend: 'webgpu' | 'wasm' | 'rules-only' = 'rules-only';

  isReady(): boolean {
    return this.extractor !== null;
  }

  async init(): Promise<void> {
    if (this.extractor) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const devices: Array<'webgpu' | 'wasm'> = hasWebGpu ? ['webgpu', 'wasm'] : ['wasm'];

      for (const device of devices) {
        try {
          const loaded = await pipeline('feature-extraction', MODEL_ID, {
            device,
            dtype: 'q8',
          });
          this.extractor = loaded as unknown as FeatureExtractionPipeline;
          this.backend = device;
          return;
        } catch {
          // Try next available backend.
        }
      }
      this.backend = 'rules-only';
    })().finally(() => {
      this.loadingPromise = null;
    });

    return this.loadingPromise;
  }

  async embedTexts(texts: string[]): Promise<Float32Array[]> {
    if (!this.extractor) {
      throw new Error('Embedding model is not ready');
    }
    const output = await this.extractor(texts, {
      pooling: 'cls',
      normalize: true,
    });
    const list = output.tolist() as number[][];
    return list.map((row) => l2Normalize(new Float32Array(row)));
  }
}

const provider = new TransformersEmbeddingProvider();
let config: FilterConfig = { ...DEFAULT_FILTER_CONFIG };
let cachedRules: L1RuleSet = createEmptyRuleSet();
let cachedAnchors: AnchorVector[] = [];
const authorFeedCounts: Record<string, number> = {};
const recentEaten: RecentEatenEntry[] = [];
const MAX_RECENT_EATEN = 20;

function recordRecentEaten(itemId: string, title: string, reason: string): void {
  const existingIdx = recentEaten.findIndex((e) => e.itemId === itemId);
  if (existingIdx !== -1) recentEaten.splice(existingIdx, 1);
  recentEaten.unshift({ itemId, title, reason, timestamp: Date.now() });
  if (recentEaten.length > MAX_RECENT_EATEN) {
    recentEaten.length = MAX_RECENT_EATEN;
  }
}

async function loadStateFromDb(): Promise<void> {
  const [rules, vectors, storedCfg] = await Promise.all([
    db.rules.toArray(),
    db.vectors.toArray(),
    browser.storage.local.get('afp_config'),
  ]);

  if (storedCfg?.afp_config) {
    config = { ...DEFAULT_FILTER_CONFIG, ...(storedCfg.afp_config as Partial<FilterConfig>) };
  }

  const nextRules = createEmptyRuleSet();
  for (const r of rules) {
    if (r.kind === 'author_block') nextRules.blockedAuthors.add(r.value);
    else if (r.kind === 'author_allow') nextRules.allowedAuthors.add(r.value);
    else if (r.kind === 'keyword') nextRules.blockedKeywords.push(r.value);
    else if (r.kind === 'bgm_suspect') nextRules.suspectBgmCounts.set(r.value, r.hitCount);
  }
  cachedRules = nextRules;

  cachedAnchors = vectors.map((v) => ({
    id: v.id,
    polarity: v.polarity,
    embedding: new Float32Array(v.embedding),
    weight: v.weight,
    lastHitAt: v.lastHitAt,
  }));
}

async function incrementDailyStat(field: 'eatenCount' | 'spitCount', delta = 1): Promise<void> {
  const key = todayKey();
  const existing = await db.stats.get(key);
  if (existing) {
    await db.stats.update(key, { [field]: Math.max(0, existing[field] + delta) });
  } else {
    await db.stats.put({
      date: key,
      eatenCount: field === 'eatenCount' ? Math.max(0, delta) : 0,
      spitCount: field === 'spitCount' ? Math.max(0, delta) : 0,
    });
  }
}

async function pruneNegativeBankIfNeeded(): Promise<void> {
  const negatives = await db.vectors.where('polarity').equals('negative').sortBy('lastHitAt');
  if (negatives.length <= MAX_NEGATIVE_ANCHORS) return;
  const excess = negatives.slice(0, negatives.length - MAX_NEGATIVE_ANCHORS);
  await db.vectors.bulkDelete(excess.map((v) => v.id));
}

async function handleMessage(msg: ExtensionMessage): Promise<unknown> {
  switch (msg.type) {
    case 'EVALUATE_BATCH': {
      const result = await evaluateBatch(msg.items, {
        rules: cachedRules,
        anchors: cachedAnchors,
        config,
        provider,
      });
      const itemMap = new Map(msg.items.map((item) => [item.item_id, item]));
      let eatenNow = 0;
      for (const decision of result.decisions) {
        if (decision.blocked) {
          eatenNow += 1;
          const item = itemMap.get(decision.item_id);
          if (item) {
            recordRecentEaten(item.item_id, item.title, decision.reason ?? '自动拦截');
          }
        }
      }
      if (eatenNow > 0) {
        void incrementDailyStat('eatenCount', eatenNow);
      }
      return result;
    }

    case 'FEED_ITEM': {
      const { item, blockAuthor } = msg;
      const now = Date.now();

      if (item.author_id) {
        authorFeedCounts[item.author_id] = (authorFeedCounts[item.author_id] ?? 0) + 1;
      }

      if (blockAuthor && item.author_id) {
        await db.rules.put({
          kind: 'author_block',
          value: item.author_id,
          platform: item.platform,
          hitCount: 1,
          createdAt: now,
        });
      }

      if (item.bgm?.music_id) {
        const existingBgm = await db.rules
          .where('[kind+value]')
          .equals(['bgm_suspect', item.bgm.music_id])
          .first();
        if (existingBgm?.id) {
          await db.rules.update(existingBgm.id, { hitCount: existingBgm.hitCount + 1 });
        } else {
          await db.rules.add({
            kind: 'bgm_suspect',
            value: item.bgm.music_id,
            platform: item.platform,
            hitCount: 1,
            createdAt: now,
          });
        }
      }

      if (provider.isReady()) {
        try {
          const text = buildEmbeddingText(item);
          const [embedding] = await provider.embedTexts([text]);
          await db.vectors.put({
            id: `neg:${item.platform}:${item.item_id}`,
            polarity: 'negative',
            platform: item.platform,
            itemId: item.item_id,
            text,
            embedding: Array.from(embedding),
            weight: 1.0,
            createdAt: now,
            lastHitAt: now,
          });
          await pruneNegativeBankIfNeeded();
        } catch {
          // Keep rule updates even if embedding fails.
        }
      }

      recordRecentEaten(item.item_id, item.title, '手动投喂');
      await incrementDailyStat('eatenCount', 1);
      await loadStateFromDb();

      const count = item.author_id ? authorFeedCounts[item.author_id] ?? 1 : 0;
      return {
        ok: true,
        authorFeedCount: count,
        suggestBlockAuthor: !blockAuthor && count >= AUTHOR_BLOCK_SUGGEST_THRESHOLD,
      };
    }

    case 'SPIT_ITEM': {
      const { item, matchedAnchorId } = msg;
      const now = Date.now();

      // Down-weight the specific historical negative anchor that caused the false positive.
      if (matchedAnchorId) {
        const existingNeg = await db.vectors.get(matchedAnchorId);
        if (existingNeg) {
          await db.vectors.update(matchedAnchorId, {
            weight: Math.max(0.4, Number((existingNeg.weight * 0.8).toFixed(2))),
          });
        }
      }

      // Add a positive anchor so similar high-quality content is repelled from the block boundary.
      if (provider.isReady()) {
        try {
          const text = buildEmbeddingText(item);
          const [embedding] = await provider.embedTexts([text]);
          await db.vectors.put({
            id: `pos:${item.platform}:${item.item_id}`,
            polarity: 'positive',
            platform: item.platform,
            itemId: item.item_id,
            text,
            embedding: Array.from(embedding),
            weight: 1.0,
            createdAt: now,
            lastHitAt: now,
          });
        } catch {
          // Non-fatal.
        }
      }

      await incrementDailyStat('spitCount', 1);
      await loadStateFromDb();
      return { ok: true };
    }

    case 'UNDO_FEED': {
      const idx = recentEaten.findIndex((e) => e.itemId === msg.itemId);
      if (idx !== -1) recentEaten.splice(idx, 1);
      const candidates = await db.vectors.where('itemId').equals(msg.itemId).toArray();
      if (candidates.length > 0) {
        await db.vectors.bulkDelete(candidates.map((c) => c.id));
      }
      await incrementDailyStat('eatenCount', -1);
      await loadStateFromDb();
      return { ok: true };
    }

    case 'UPDATE_CONFIG': {
      config = { ...config, ...msg.patch };
      await browser.storage.local.set({ afp_config: config });
      return { ok: true, config };
    }

    case 'GET_STATUS': {
      const [stat, negRecords] = await Promise.all([
        db.stats.get(todayKey()),
        db.vectors.where('polarity').equals('negative').toArray(),
      ]);
      const texts = [
        ...negRecords.map((v) => v.text),
        ...recentEaten.map((e) => e.title),
      ];
      const status: PetStatus = {
        modelReady: provider.isReady(),
        backend: provider.backend,
        todayEaten: stat?.eatenCount ?? 0,
        negativeCount: cachedAnchors.filter((a) => a.polarity === 'negative').length,
        positiveCount: cachedAnchors.filter((a) => a.polarity === 'positive').length,
        authorFeedCounts,
        topKeywords: extractTopKeywords(texts, 12),
        recentEaten: recentEaten.slice(0, 10),
        config,
      };
      return status;
    }
  }
}

void (async () => {
  await loadStateFromDb();
  void provider.init();
})();

browser.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
  const message = rawMessage as (ExtensionMessage & { target?: string }) | undefined;
  if (message?.target !== 'offscreen') return false;
  void handleMessage(message)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false }));
  return true;
});
