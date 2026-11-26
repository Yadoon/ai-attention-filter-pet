import { l2Normalize, type InferenceProvider } from './l2-vector';

const VECTOR_DIM = 384;

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function addFeature(vec: Float32Array, feature: string, weight: number): void {
  const h = fnv1a(feature);
  const idx = h % VECTOR_DIM;
  const sign = (h & 0x80000000) === 0 ? 1 : -1;
  vec[idx] += sign * weight;
}

/**
 * Normalize text and project character 2-grams, 3-grams, and ASCII words into
 * a deterministic 384-dim L2-normalized vector (zero network, < 0.1ms).
 */
export function embedTextNgram(text: string): Float32Array {
  const vec = new Float32Array(VECTOR_DIM);
  const cleaned = text
    .toLowerCase()
    .replace(/[\s|【】\[\]()（）《》「」『』.,!?;:，。！？；：、#@~—…\-"'`]+/g, ' ')
    .trim();

  if (!cleaned) return vec;

  // Compact string without spaces for Chinese character n-grams.
  const compact = cleaned.replace(/\s+/g, '');
  for (let i = 0; i < compact.length - 1; i++) {
    addFeature(vec, `b:${compact.slice(i, i + 2)}`, 1.0);
  }
  for (let i = 0; i < compact.length - 2; i++) {
    addFeature(vec, `t:${compact.slice(i, i + 3)}`, 1.4);
  }

  // English / alphanumeric words (e.g., "gpt5", "anthropic", "agent").
  const words = cleaned.match(/[a-z0-9]{2,}/g) ?? [];
  for (const w of words) {
    addFeature(vec, `w:${w}`, 1.3);
  }

  return l2Normalize(vec);
}

/**
 * Always-ready offline fallback provider using character n-gram feature hashing.
 */
export class NgramEmbeddingProvider implements InferenceProvider {
  readonly name = 'local-ngram-384';
  readonly mode = 'ngram' as const;

  isReady(): boolean {
    return true;
  }

  async embedTexts(texts: string[]): Promise<Float32Array[]> {
    return texts.map(embedTextNgram);
  }
}
