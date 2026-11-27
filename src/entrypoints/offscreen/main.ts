import {
  AutoProcessor,
  ClapAudioModelWithProjection,
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';
import {
  DEFAULT_CLAP_MATCH_THRESHOLD,
  matchBgmFingerprint,
  type BgmFingerprintAnchor,
} from '@/engine/audio-fingerprint';
import { extractTopKeywords } from '@/engine/keywords';
import { createEmptyRuleSet, type L1RuleSet } from '@/engine/l1-rules';
import {
  buildEmbeddingText,
  l2Normalize,
  type AnchorVector,
  type EmbedderMode,
  type InferenceProvider,
} from '@/engine/l2-vector';
import { NgramEmbeddingProvider } from '@/engine/ngram-embedder';
import { evaluateBatch } from '@/engine/pipeline';
import { db, todayKey } from '@/storage/db';
import {
  decodeQuantizedEmbedding,
  encodeQuantizedEmbedding,
  type SyncSnapshot,
} from '@/storage/sync-codec';
import { DEFAULT_FILTER_CONFIG, type FilterConfig } from '@/types/item';
import type {
  ExportDataResponse,
  ExtensionMessage,
  ImportDataResponse,
  MatchBgmResponse,
  PetDataBackup,
  PetStatus,
  RecentEatenEntry,
} from '@/types/messages';

const MODEL_ID = 'Xenova/bge-small-zh-v1.5';
const CLAP_MODEL_ID = 'Xenova/clap-htsat-unfused';
const REMOTE_HOSTS = ['https://hf-mirror.com/', 'https://huggingface.co/'];
const MAX_NEGATIVE_ANCHORS = 1000;
const AUTHOR_BLOCK_SUGGEST_THRESHOLD = 3;

env.allowLocalModels = false;
env.useBrowserCache = true;
// MV3 extension pages cannot load scripts from CDN or use SharedArrayBuffer;
// serve ONNX Runtime Web assets locally from chrome-extension://<id>/ort/ in single-threaded mode.
if (env.backends?.onnx) {
  // Suppress harmless ONNX Runtime WebGPU startup warnings so Chrome doesn't flag them as extension errors.
  env.backends.onnx.logLevel = 'error';
  if (env.backends.onnx.webgpu) {
    env.backends.onnx.webgpu.powerPreference = undefined;
  }
}
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = new URL('/ort/', browser.runtime.getURL('/')).href;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}

class TransformersEmbeddingProvider implements InferenceProvider {
  readonly name = MODEL_ID;
  readonly mode: EmbedderMode = 'neural';
  private extractor: FeatureExtractionPipeline | null = null;
  private loadingPromise: Promise<boolean> | null = null;
  public loading = false;
  public backend: 'webgpu' | 'wasm' | null = null;

  isReady(): boolean {
    return this.extractor !== null;
  }

  async init(): Promise<boolean> {
    if (this.extractor) return true;
    if (this.loadingPromise) return this.loadingPromise;

    this.loading = true;
    this.loadingPromise = (async () => {
      const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const devices: Array<'webgpu' | 'wasm'> = hasWebGpu ? ['webgpu', 'wasm'] : ['wasm'];

      for (const host of REMOTE_HOSTS) {
        env.remoteHost = host;
        for (const device of devices) {
          try {
            console.info(`[AFP] Loading ${MODEL_ID} from ${host} (${device})...`);
            const loaded = await pipeline('feature-extraction', MODEL_ID, {
              device,
              dtype: 'q8',
            });
            this.extractor = loaded as unknown as FeatureExtractionPipeline;
            this.backend = device;
            console.info(`[AFP] Loaded ${MODEL_ID} on ${device}`);
            return true;
          } catch (err) {
            console.warn(`[AFP] Failed to load ${MODEL_ID} from ${host} (${device}):`, err);
          }
        }
      }
      return false;
    })().finally(() => {
      this.loading = false;
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

const neuralProvider = new TransformersEmbeddingProvider();
const ngramProvider = new NgramEmbeddingProvider();

/**
 * Opt-in local CLAP audio encoder (~65MB audio tower only, q8) for 512-dim semantic BGM style embeddings.
 */
class ClapAudioEmbeddingProvider {
  private processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;
  private model: Awaited<ReturnType<typeof ClapAudioModelWithProjection.from_pretrained>> | null =
    null;
  private loadingPromise: Promise<boolean> | null = null;
  public loading = false;

  isReady(): boolean {
    return this.processor !== null && this.model !== null;
  }

  async init(): Promise<boolean> {
    if (this.isReady()) return true;
    if (this.loadingPromise) return this.loadingPromise;

    this.loading = true;
    this.loadingPromise = (async () => {
      const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const devices: Array<'webgpu' | 'wasm'> = hasWebGpu ? ['webgpu', 'wasm'] : ['wasm'];

      for (const host of REMOTE_HOSTS) {
        env.remoteHost = host;
        for (const device of devices) {
          try {
            console.info(`[AFP] Loading CLAP audio encoder (${CLAP_MODEL_ID}) from ${host} (${device})...`);
            const [proc, mdl] = await Promise.all([
              AutoProcessor.from_pretrained(CLAP_MODEL_ID),
              ClapAudioModelWithProjection.from_pretrained(CLAP_MODEL_ID, {
                device,
                dtype: 'q8',
              }),
            ]);
            this.processor = proc;
            this.model = mdl;
            console.info(`[AFP] Loaded CLAP audio encoder on ${device}`);
            return true;
          } catch (err) {
            console.warn(`[AFP] Failed to load CLAP from ${host} (${device}):`, err);
          }
        }
      }
      return false;
    })().finally(() => {
      this.loading = false;
      this.loadingPromise = null;
    });

    return this.loadingPromise;
  }

  async embedPcmInt16(pcmInt16: number[]): Promise<Float32Array> {
    if (!this.processor || !this.model) {
      throw new Error('CLAP audio model is not ready');
    }
    const pcm = new Float32Array(pcmInt16.length);
    for (let i = 0; i < pcmInt16.length; i++) {
      pcm[i] = pcmInt16[i] / 32767;
    }
    const audioInputs = await (this.processor as unknown as (audio: Float32Array) => Promise<Record<string, unknown>>)(pcm);
    const out = await (this.model as unknown as (inputs: Record<string, unknown>) => Promise<{ audio_embeds: { tolist: () => number[][] } }>)(audioInputs);
    const rows = out.audio_embeds.tolist();
    return l2Normalize(new Float32Array(rows[0]));
  }
}

const clapProvider = new ClapAudioEmbeddingProvider();

function getActiveProvider(): InferenceProvider {
  return neuralProvider.isReady() ? neuralProvider : ngramProvider;
}

let config: FilterConfig = { ...DEFAULT_FILTER_CONFIG };
let cachedRules: L1RuleSet = createEmptyRuleSet();
let cachedAnchors: AnchorVector[] = [];
let cachedBgmAnchors: BgmFingerprintAnchor[] = [];
const authorFeedCounts: Record<string, number> = {};
const authorPositiveCounts: Record<string, number> = {};
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

function readConfigFromStorage(): Partial<FilterConfig> | null {
  try {
    const raw = window.localStorage.getItem('afp_config');
    return raw ? (JSON.parse(raw) as Partial<FilterConfig>) : null;
  } catch {
    return null;
  }
}

function writeConfigToStorage(next: FilterConfig): void {
  try {
    window.localStorage.setItem('afp_config', JSON.stringify(next));
  } catch {
    // Non-fatal.
  }
}

async function loadStateFromDb(): Promise<void> {
  const [rules, vectors, bgms] = await Promise.all([
    db.rules.toArray(),
    db.vectors.toArray(),
    db.bgmFingerprints.toArray(),
  ]);

  const storedCfg = readConfigFromStorage();
  if (storedCfg) {
    const isLegacyPositiveCfg =
      storedCfg.positiveMinSim === undefined && storedCfg.positiveAlpha === 0.35;
    config = {
      ...DEFAULT_FILTER_CONFIG,
      ...storedCfg,
      positiveAlpha: isLegacyPositiveCfg
        ? DEFAULT_FILTER_CONFIG.positiveAlpha
        : (storedCfg.positiveAlpha ?? DEFAULT_FILTER_CONFIG.positiveAlpha),
      positiveMinSim: storedCfg.positiveMinSim ?? DEFAULT_FILTER_CONFIG.positiveMinSim,
      // Upgrade legacy 500ms timeout that caused large search pages to fail-open.
      inferenceTimeoutMs: Math.max(
        storedCfg.inferenceTimeoutMs ?? DEFAULT_FILTER_CONFIG.inferenceTimeoutMs,
        DEFAULT_FILTER_CONFIG.inferenceTimeoutMs,
      ),
    };
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
    itemId: v.itemId,
    polarity: v.polarity,
    embedding: new Float32Array(v.embedding),
    embedder: v.embedder ?? 'neural',
    text: v.text,
    weight: v.weight,
    lastHitAt: v.lastHitAt,
  }));

  cachedBgmAnchors = bgms.map((b) => ({
    id: b.id,
    label: b.label,
    severity: b.severity ?? 'block',
    embedder: b.embedder ?? 'dsp',
    embedding: new Float32Array(b.embedding),
  }));
}

/**
 * Once bge-small-zh finishes loading, upgrade any offline ngram vectors to neural embeddings.
 */
async function upgradeNgramVectorsToNeural(): Promise<void> {
  if (!neuralProvider.isReady()) return;
  const all = await db.vectors.toArray();
  const pending = all.filter((v) => v.embedder === 'ngram');
  if (pending.length === 0) return;

  try {
    const embeddings = await neuralProvider.embedTexts(pending.map((v) => v.text));
    for (let i = 0; i < pending.length; i++) {
      await db.vectors.update(pending[i].id, {
        embedding: Array.from(embeddings[i]),
        embedder: 'neural',
      });
    }
    await loadStateFromDb();
  } catch {
    // Keep existing ngram vectors if upgrade fails.
  }
}

/**
 * One-time idempotent cleanup for legacy vectors that had Bilibili rcmd_reason
 * badges (e.g. " | 1万点赞", " | 很多人都在看") concatenated into text.
 */
async function cleanupLegacyVectorSnippets(): Promise<void> {
  if (!neuralProvider.isReady()) return;
  const all = await db.vectors.toArray();
  const dirty = all.filter((v) => v.text.includes(' | '));
  if (dirty.length === 0) return;

  let cleaned = 0;
  const CHUNK = 16;
  for (let i = 0; i < dirty.length; i += CHUNK) {
    const slice = dirty.slice(i, i + CHUNK);
    const cleanTexts = slice.map((v) => v.text.split(' | ')[0].trim() || v.text);
    try {
      const embeddings = await neuralProvider.embedTexts(cleanTexts);
      for (let j = 0; j < slice.length; j++) {
        await db.vectors.update(slice[j].id, {
          text: cleanTexts[j],
          embedding: Array.from(embeddings[j]),
          embedder: 'neural',
        });
        cleaned += 1;
      }
    } catch {
      // Skip failed chunk; will retry on next startup.
    }
  }

  if (cleaned > 0) {
    console.info(`[AFP] Cleaned ${cleaned} legacy vectors (removed rcmd_reason suffix)`);
    await loadStateFromDb();
  }
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
      const activeProvider = getActiveProvider();
      const result = await evaluateBatch(msg.items, {
        rules: cachedRules,
        anchors: cachedAnchors,
        config,
        provider: activeProvider,
        authorFeedCounts,
        authorPositiveCounts,
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

      // Always embed using active provider (neural when ready, offline ngram otherwise).
      const activeProvider = getActiveProvider();
      try {
        const text = buildEmbeddingText(item);
        const [embedding] = await activeProvider.embedTexts([text]);
        await db.vectors.put({
          id: `neg:${item.platform}:${item.item_id}`,
          polarity: 'negative',
          platform: item.platform,
          itemId: item.item_id,
          text,
          embedding: Array.from(embedding),
          embedder: activeProvider.mode ?? 'neural',
          weight: 1.0,
          createdAt: now,
          lastHitAt: now,
        });
        await pruneNegativeBankIfNeeded();
      } catch {
        // Keep rule updates even if embedding fails.
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

      if (item.author_id) {
        authorPositiveCounts[item.author_id] = (authorPositiveCounts[item.author_id] ?? 0) + 1;
      }

      if (matchedAnchorId) {
        const existingNeg = await db.vectors.get(matchedAnchorId);
        if (existingNeg) {
          await db.vectors.update(matchedAnchorId, {
            weight: Math.max(0.4, Number((existingNeg.weight * 0.8).toFixed(2))),
          });
        }
      }

      const activeProvider = getActiveProvider();
      try {
        const text = buildEmbeddingText(item);
        const [embedding] = await activeProvider.embedTexts([text]);
        await db.vectors.put({
          id: `pos:${item.platform}:${item.item_id}`,
          polarity: 'positive',
          platform: item.platform,
          itemId: item.item_id,
          text,
          embedding: Array.from(embedding),
          embedder: activeProvider.mode ?? 'neural',
          weight: 1.0,
          createdAt: now,
          lastHitAt: now,
        });
      } catch {
        // Non-fatal.
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
      writeConfigToStorage(config);
      if (config.enableAudioClap && !clapProvider.isReady() && !clapProvider.loading) {
        void clapProvider.init();
      }
      return { ok: true, config };
    }

    case 'GET_STATUS': {
      const [stat, negRecords, allRules] = await Promise.all([
        db.stats.get(todayKey()),
        db.vectors.where('polarity').equals('negative').toArray(),
        db.rules.toArray(),
      ]);
      const texts = [
        ...negRecords.map((v) => v.text),
        ...recentEaten.map((e) => e.title),
      ];
      const rules = allRules
        .filter(
          (r): r is typeof r & { id: number; kind: 'keyword' | 'author_block' } =>
            typeof r.id === 'number' &&
            (r.kind === 'keyword' || r.kind === 'author_block'),
        )
        .map((r) => ({ id: r.id, kind: r.kind, value: r.value }));
      const positiveAnchors = cachedAnchors
        .filter((a) => a.polarity === 'positive')
        .map((a) => ({
          id: a.id,
          title: (a.text?.split(' | ')[0] ?? a.id).slice(0, 26),
        }));
      const status: PetStatus = {
        modelReady: neuralProvider.isReady(),
        modelLoading: neuralProvider.loading,
        clapReady: clapProvider.isReady(),
        clapLoading: clapProvider.loading,
        backend: neuralProvider.backend ?? 'ngram',
        todayEaten: stat?.eatenCount ?? 0,
        negativeCount: cachedAnchors.filter((a) => a.polarity === 'negative').length,
        positiveCount: positiveAnchors.length,
        authorFeedCounts,
        topKeywords: extractTopKeywords(texts, 12),
        recentEaten: recentEaten.slice(0, 10),
        rules,
        positiveAnchors,
        bgmFingerprints: cachedBgmAnchors.map((b) => ({
          id: b.id,
          label: b.label,
          severity: b.severity,
          embedder: b.embedder ?? 'dsp',
        })),
        config,
      };
      return status;
    }

    case 'ADD_BGM_FINGERPRINT': {
      const id = `bgm:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
      let finalEmbedding = msg.embedding;
      let embedder: 'dsp' | 'clap' = 'dsp';

      if (clapProvider.isReady() && Array.isArray(msg.pcmInt16) && msg.pcmInt16.length >= 24_000) {
        try {
          const clapVec = await clapProvider.embedPcmInt16(msg.pcmInt16);
          finalEmbedding = Array.from(clapVec);
          embedder = 'clap';
        } catch (err) {
          console.warn('[AFP] CLAP embed failed during capture, falling back to DSP:', err);
        }
      }

      await db.bgmFingerprints.put({
        id,
        label: msg.label.trim() || '罐头 BGM',
        severity: msg.severity ?? 'block',
        embedder,
        embedding: finalEmbedding,
        sourceItemId: msg.sourceItemId,
        createdAt: Date.now(),
      });
      await loadStateFromDb();
      return { ok: true, id, embedder };
    }

    case 'REMOVE_BGM_FINGERPRINT': {
      await db.bgmFingerprints.delete(msg.id);
      await loadStateFromDb();
      return { ok: true };
    }

    case 'MATCH_BGM_FINGERPRINT': {
      if (cachedBgmAnchors.length === 0) {
        const empty: MatchBgmResponse = { ok: true, matched: false, score: 0 };
        return empty;
      }

      // 1. When CLAP is ready and CLAP anchors exist, use CLAP authoritatively (do not fall back to legacy DSP chips).
      const hasClapAnchors = cachedBgmAnchors.some((a) => a.embedder === 'clap');
      if (
        hasClapAnchors &&
        clapProvider.isReady() &&
        Array.isArray(msg.pcmInt16) &&
        msg.pcmInt16.length >= 24_000
      ) {
        try {
          const clapProbe = await clapProvider.embedPcmInt16(msg.pcmInt16);
          const clapRes = matchBgmFingerprint(
            clapProbe,
            cachedBgmAnchors,
            DEFAULT_CLAP_MATCH_THRESHOLD,
            'clap',
          );
          const reply: MatchBgmResponse = {
            ok: true,
            matched: clapRes.matched,
            score: clapRes.score,
            label: clapRes.anchor?.label,
            severity: clapRes.anchor?.severity,
            id: clapRes.anchor?.id,
          };
          return reply;
        } catch (err) {
          console.warn('[AFP] CLAP match failed, falling back to DSP:', err);
        }
      }

      // 2. Fallback to 64-dim DSP fingerprint matching.
      if (!Array.isArray(msg.embedding)) {
        const empty: MatchBgmResponse = { ok: true, matched: false, score: 0 };
        return empty;
      }
      const probe = new Float32Array(msg.embedding);
      const res = matchBgmFingerprint(probe, cachedBgmAnchors, undefined, 'dsp');
      const reply: MatchBgmResponse = {
        ok: true,
        matched: res.matched,
        score: res.score,
        label: res.anchor?.label,
        severity: res.anchor?.severity,
        id: res.anchor?.id,
      };
      return reply;
    }

    case 'REMOVE_VECTOR': {
      await db.vectors.delete(msg.id);
      await loadStateFromDb();
      return { ok: true };
    }

    case 'ADD_RULE': {
      const rawValues =
        msg.kind === 'keyword'
          ? msg.value.split(/[,，\n]/).map((s) => s.trim())
          : [msg.value.trim()];
      const values = rawValues.filter((v) => v.length > 0);
      const now = Date.now();
      let added = 0;

      for (const value of values) {
        const existing = await db.rules
          .where('[kind+value]')
          .equals([msg.kind, value])
          .first();
        if (!existing) {
          await db.rules.add({
            kind: msg.kind,
            value,
            hitCount: 0,
            createdAt: now,
          });
          added += 1;
        }
      }

      await loadStateFromDb();
      return { ok: true, added };
    }

    case 'REMOVE_RULE': {
      await db.rules.delete(msg.id);
      await loadStateFromDb();
      return { ok: true };
    }

    case 'EXPORT_DATA': {
      const [vectors, rules, stats, bgmFingerprints] = await Promise.all([
        db.vectors.toArray(),
        db.rules.toArray(),
        db.stats.toArray(),
        db.bgmFingerprints.toArray(),
      ]);
      const data: PetDataBackup = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        config,
        vectors,
        rules,
        stats,
        bgmFingerprints,
      };
      const res: ExportDataResponse = { ok: true, data };
      return res;
    }

    case 'IMPORT_DATA': {
      const payload = msg.data;
      if (!payload || !Array.isArray(payload.vectors)) {
        const res: ImportDataResponse = {
          ok: false,
          importedVectors: 0,
          importedRules: 0,
          importedBgm: 0,
          error: '备份文件格式不正确（缺少 vectors 数组）',
        };
        return res;
      }

      const mode = msg.mode ?? 'merge';
      const validVectors = payload.vectors.filter(
        (v) =>
          v &&
          typeof v.id === 'string' &&
          (v.polarity === 'negative' || v.polarity === 'positive') &&
          typeof v.text === 'string' &&
          Array.isArray(v.embedding) &&
          v.embedding.length > 0,
      );
      const validRules = Array.isArray(payload.rules)
        ? payload.rules.filter(
            (r) => r && typeof r.kind === 'string' && typeof r.value === 'string',
          )
        : [];
      const validStats = Array.isArray(payload.stats)
        ? payload.stats.filter((s) => s && typeof s.date === 'string')
        : [];
      const validBgm = Array.isArray(payload.bgmFingerprints)
        ? payload.bgmFingerprints.filter(
            (b) =>
              b &&
              typeof b.id === 'string' &&
              typeof b.label === 'string' &&
              Array.isArray(b.embedding) &&
              b.embedding.length > 0,
          )
        : [];

      if (mode === 'replace') {
        await Promise.all([
          db.vectors.clear(),
          db.rules.clear(),
          db.stats.clear(),
          db.bgmFingerprints.clear(),
        ]);
      }

      if (validVectors.length > 0) {
        await db.vectors.bulkPut(validVectors);
      }

      if (validBgm.length > 0) {
        await db.bgmFingerprints.bulkPut(validBgm);
      }

      let importedRules = 0;
      for (const rule of validRules) {
        const existing = await db.rules
          .where('[kind+value]')
          .equals([rule.kind, rule.value])
          .first();
        if (!existing) {
          const { id: _ignored, ...rest } = rule;
          await db.rules.add(rest);
          importedRules += 1;
        }
      }

      for (const stat of validStats) {
        const existing = await db.stats.get(stat.date);
        if (!existing) {
          await db.stats.put(stat);
        } else {
          await db.stats.update(stat.date, {
            eatenCount: Math.max(existing.eatenCount, stat.eatenCount),
            spitCount: Math.max(existing.spitCount, stat.spitCount),
          });
        }
      }

      if (payload.config && typeof payload.config === 'object') {
        config = { ...config, ...payload.config };
        writeConfigToStorage(config);
      }

      await pruneNegativeBankIfNeeded();
      await loadStateFromDb();
      if (neuralProvider.isReady()) {
        void upgradeNgramVectorsToNeural();
      }

      const res: ImportDataResponse = {
        ok: true,
        importedVectors: validVectors.length,
        importedRules,
        importedBgm: validBgm.length,
      };
      return res;
    }

    case 'GET_SYNC_SNAPSHOT': {
      const [vectors, rules, bgmFingerprints] = await Promise.all([
        db.vectors.toArray(),
        db.rules.toArray(),
        db.bgmFingerprints.toArray(),
      ]);
      const snapshot: SyncSnapshot = {
        version: 1,
        updatedAt: Date.now(),
        config,
        rules: rules
          .filter(
            (r): r is typeof r & { kind: 'keyword' | 'author_block' | 'author_allow' } =>
              r.kind === 'keyword' || r.kind === 'author_block' || r.kind === 'author_allow',
          )
          .map((r) => ({ k: r.kind, v: r.value })),
        vectors: vectors.map((v) => ({
          id: v.id,
          p: v.polarity === 'positive' ? 'p' : 'n',
          pl: v.platform,
          iid: v.itemId,
          t: v.text.slice(0, 120),
          w: v.weight,
          c: v.createdAt,
          l: v.lastHitAt,
        })),
        bgmFingerprints: bgmFingerprints
          .filter((b) => Array.isArray(b.embedding) && b.embedding.length > 0)
          .map((b) => {
            const { e, a } = encodeQuantizedEmbedding(b.embedding);
            return {
              id: b.id,
              l: b.label.slice(0, 40),
              s: b.severity === 'penalty' ? 'p' : 'b',
              m: b.embedder === 'clap' ? 'c' : 'd',
              e,
              a,
              c: b.createdAt,
            };
          }),
      };
      return { ok: true, snapshot };
    }

    case 'APPLY_SYNC_SNAPSHOT': {
      const snap = msg.snapshot;
      if (!snap || snap.version !== 1) return { ok: false, pulledVectors: 0, pulledBgm: 0 };

      const [existingVectors, existingRules, existingBgm] = await Promise.all([
        db.vectors.toArray(),
        db.rules.toArray(),
        db.bgmFingerprints.toArray(),
      ]);
      const existingVecIds = new Set(existingVectors.map((v) => v.id));
      const existingRuleKeys = new Set(existingRules.map((r) => `${r.kind}:${r.value}`));
      const existingBgmIds = new Set(existingBgm.map((b) => b.id));

      // Merge remote rules.
      const now = Date.now();
      for (const r of snap.rules) {
        if (!existingRuleKeys.has(`${r.k}:${r.v}`)) {
          await db.rules.add({
            kind: r.k,
            value: r.v,
            hitCount: 0,
            createdAt: now,
          });
        }
      }

      // Merge remote BGM fingerprints.
      let pulledBgm = 0;
      if (Array.isArray(snap.bgmFingerprints)) {
        for (const b of snap.bgmFingerprints) {
          if (!existingBgmIds.has(b.id) && typeof b.e === 'string' && b.e.length > 0) {
            try {
              const embedding = decodeQuantizedEmbedding(b.e, b.a);
              if (embedding.length > 0) {
                await db.bgmFingerprints.put({
                  id: b.id,
                  label: b.l || '罐头 BGM',
                  severity: b.s === 'p' ? 'penalty' : 'block',
                  embedder: b.m === 'c' ? 'clap' : 'dsp',
                  embedding,
                  createdAt: b.c || now,
                });
                pulledBgm += 1;
              }
            } catch {
              // Skip malformed quantized entry.
            }
          }
        }
      }

      // Merge config if local has no vectors yet (fresh device) or missing keys.
      if (snap.config && existingVectors.length === 0) {
        config = { ...config, ...snap.config };
        writeConfigToStorage(config);
      }

      // Re-embed any missing synced vectors locally.
      const missing = snap.vectors.filter((v) => !existingVecIds.has(v.id) && v.t.trim().length > 0);
      let pulledVectors = 0;
      if (missing.length > 0) {
        const provider = getActiveProvider();
        const CHUNK = 16;
        for (let i = 0; i < missing.length; i += CHUNK) {
          const slice = missing.slice(i, i + CHUNK);
          try {
            const embeddings = await provider.embedTexts(slice.map((s) => s.t));
            for (let j = 0; j < slice.length; j++) {
              const s = slice[j];
              await db.vectors.put({
                id: s.id,
                polarity: s.p === 'p' ? 'positive' : 'negative',
                platform: s.pl,
                itemId: s.iid,
                text: s.t,
                embedding: Array.from(embeddings[j]),
                embedder: provider.mode ?? 'neural',
                weight: s.w,
                createdAt: s.c,
                lastHitAt: s.l,
              });
              pulledVectors += 1;
            }
          } catch {
            // Skip failed chunk.
          }
        }
      }

      await pruneNegativeBankIfNeeded();
      await loadStateFromDb();
      if (neuralProvider.isReady()) {
        void upgradeNgramVectorsToNeural().then(() => cleanupLegacyVectorSnippets());
      }
      return { ok: true, pulledVectors, pulledBgm };
    }
  }
}

void (async () => {
  await loadStateFromDb();
  const ok = await neuralProvider.init();
  if (ok) {
    await upgradeNgramVectorsToNeural();
    await cleanupLegacyVectorSnippets();
  }
  if (config.enableAudioClap) {
    void clapProvider.init();
  }
})();

browser.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
  const message = rawMessage as (ExtensionMessage & { target?: string }) | undefined;
  if (message?.target !== 'offscreen') return false;
  void handleMessage(message)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false }));
  return true;
});
