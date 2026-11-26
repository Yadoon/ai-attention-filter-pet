import type { FilterConfig, FilterDecision, NormalizedItem } from '@/types/item';

export interface AnchorVector {
  id: string;
  polarity: 'negative' | 'positive';
  embedding: Float32Array;
  weight: number;
  lastHitAt: number;
}

/**
 * Unified inference provider contract.
 * MVP uses Offscreen WebGPU/WASM; Phase 3 can swap in a local daemon without changing callers.
 */
export interface InferenceProvider {
  readonly name: string;
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
  if (item.snippet) {
    parts.push(item.snippet.slice(0, 120));
  }
  return parts.join(' | ').trim();
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
): FilterDecision {
  let maxNegScore = 0;
  let matchedAnchorId: string | undefined;
  let maxPosScore = 0;

  for (const anchor of anchors) {
    const sim = dotProduct(embedding, anchor.embedding);
    if (anchor.polarity === 'negative') {
      const effective = sim * anchor.weight * computeTimeDecay(anchor.lastHitAt, now);
      if (effective > maxNegScore) {
        maxNegScore = effective;
        matchedAnchorId = anchor.id;
      }
    } else if (sim > maxPosScore) {
      maxPosScore = sim;
    }
  }

  const boundaryScore = maxNegScore - config.positiveAlpha * maxPosScore;
  const blocked = boundaryScore > config.l2Threshold;

  return {
    item_id: itemId,
    blocked,
    layer: 'L2',
    score: Number(boundaryScore.toFixed(4)),
    reason: blocked
      ? `语义匹配负样本 (边界分 ${boundaryScore.toFixed(2)})`
      : undefined,
    matchedAnchorId: blocked ? matchedAnchorId : undefined,
  };
}
