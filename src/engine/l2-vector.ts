import type { FilterConfig, FilterDecision, NormalizedItem } from '@/types/item';
import type { SignalAdjustment } from './signals';

export type EmbedderMode = 'neural' | 'ngram';

export interface AnchorVector {
  id: string;
  itemId?: string;
  polarity: 'negative' | 'positive';
  embedding: Float32Array;
  embedder?: EmbedderMode;
  text?: string;
  weight: number;
  lastHitAt: number;
}

/**
 * Unified inference provider contract.
 * MVP uses Offscreen WebGPU/WASM with offline N-gram fallback;
 * Phase 3 can swap in a local daemon without changing callers.
 */
export interface InferenceProvider {
  readonly name: string;
  readonly mode?: EmbedderMode;
  isReady(): boolean;
  embedTexts(texts: string[]): Promise<Float32Array[]>;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function l2Normalize(vec: Float32Array): Float32Array {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm === 0) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

export function dotProduct(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Time-decay factor to prevent the negative bank from growing stale and over-blocking.
 */
export function computeTimeDecay(lastHitAt: number, now = Date.now()): number {
  const ageMs = Math.max(0, now - lastHitAt);
  if (ageMs <= NINETY_DAYS_MS) return 1.0;
  const extraPeriods = (ageMs - NINETY_DAYS_MS) / NINETY_DAYS_MS;
  return Math.max(0.5, Math.pow(0.85, extraPeriods));
}

export function buildEmbeddingText(item: NormalizedItem): string {
  const parts = [item.title];
  if (item.tags.length > 0) {
    parts.push(item.tags.slice(0, 5).join(' '));
  }
  return parts.join(' | ').trim();
}

/**
 * Compute effective threshold for the active embedding space.
 * N-gram lexical cosine scores are naturally sparser than neural semantic embeddings,
 * so we map the user's slider (0.55..0.95) into an intuitive ngram threshold (0.28..0.57).
 */
export function getEffectiveThreshold(
  config: FilterConfig,
  mode: EmbedderMode = 'neural',
): number {
  if (mode === 'ngram') {
    return Math.max(0.28, Number((config.l2Threshold - 0.38).toFixed(2)));
  }
  return config.l2Threshold;
}

/**
 * Evaluate a single normalized embedding against negative & positive anchor banks.
 * Boundary formula: boundaryScore = maxWeightedNeg - alpha * maxPos
 */
export function scoreAgainstAnchors(
  itemId: string,
  embedding: Float32Array,
  anchors: AnchorVector[],
  config: FilterConfig,
  now = Date.now(),
  mode: EmbedderMode = 'neural',
  signal?: SignalAdjustment,
  itemTitle?: string,
): FilterDecision {
  let maxNegScore = 0;
  let matchedAnchorId: string | undefined;
  let matchedTitle: string | undefined;
  let maxPosScore = 0;
  let matchedPosTitle: string | undefined;
  let exactPosItemMatch = false;
  const normalizedItemTitle = itemTitle?.trim();

  for (const anchor of anchors) {
    const anchorTitle = anchor.text?.split(' | ')[0]?.trim();
    if (anchor.polarity === 'positive') {
      if (anchor.itemId && anchor.itemId === itemId) {
        exactPosItemMatch = true;
        maxPosScore = 1;
        matchedPosTitle = anchorTitle || itemTitle;
        continue;
      }
      if (normalizedItemTitle && anchorTitle && anchorTitle === normalizedItemTitle) {
        maxPosScore = 1;
        matchedPosTitle = anchorTitle;
        continue;
      }
    }

    // Never compare vectors from different embedding spaces.
    const anchorMode = anchor.embedder ?? 'neural';
    if (anchorMode !== mode) continue;

    const sim = dotProduct(embedding, anchor.embedding);
    if (anchor.polarity === 'negative') {
      const effective = sim * anchor.weight * computeTimeDecay(anchor.lastHitAt, now);
      if (effective > maxNegScore) {
        maxNegScore = effective;
        matchedAnchorId = anchor.id;
        matchedTitle = anchorTitle;
      }
    } else if (sim > maxPosScore) {
      maxPosScore = sim;
      matchedPosTitle = anchorTitle;
    }
  }

  const threshold = getEffectiveThreshold(config, mode);
  const minPosSim = mode === 'ngram' ? Math.max(0.35, config.positiveMinSim - 0.35) : config.positiveMinSim;
  const effectivePos = maxPosScore >= minPosSim ? maxPosScore : 0;
  const signalDelta = signal && !signal.bypass ? signal.delta : 0;
  const boundaryScore = maxNegScore - config.positiveAlpha * effectivePos + signalDelta;
  const blocked = exactPosItemMatch || signal?.bypass ? false : boundaryScore > threshold;

  const shortTitle = matchedTitle
    ? `《${matchedTitle.slice(0, 16)}${matchedTitle.length > 16 ? '…' : ''}》`
    : '历史投喂';
  const modeLabel = mode === 'ngram' ? '词面相似' : '语义相似';

  return {
    item_id: itemId,
    blocked,
    layer: 'L2',
    score: Number(boundaryScore.toFixed(4)),
    reason: exactPosItemMatch
      ? '白库精确放行'
      : signal?.bypass
        ? '已关注UP主豁免'
        : blocked
          ? `${modeLabel}${shortTitle} (${boundaryScore.toFixed(2)})`
          : undefined,
    matchedAnchorId: blocked ? matchedAnchorId : undefined,
    matchedTitle: blocked ? matchedTitle : undefined,
    debug: {
      maxNeg: Number(maxNegScore.toFixed(3)),
      maxPos: Number(maxPosScore.toFixed(3)),
      effectivePos: Number(effectivePos.toFixed(3)),
      threshold: Number(threshold.toFixed(2)),
      matchedNegTitle: matchedTitle,
      matchedPosTitle,
      signalDelta: signal ? signal.delta : 0,
      signalNotes: signal?.notes,
    },
  };
}
