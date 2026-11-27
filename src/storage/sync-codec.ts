import type { FilterConfig, Platform } from '@/types/item';

export interface SyncedVectorItem {
  id: string;
  /** 'n' = negative, 'p' = positive */
  p: 'n' | 'p';
  pl: Platform;
  iid: string;
  /** Truncated embedding text (title | tags) for local re-embedding on another device. */
  t: string;
  w: number;
  c: number;
  l: number;
}

export interface SyncedRuleItem {
  k: 'keyword' | 'author_block' | 'author_allow';
  v: string;
}

export interface SyncedBgmItem {
  id: string;
  /** Label (truncated to 40 chars). */
  l: string;
  /** 'b' = block, 'p' = penalty */
  s: 'b' | 'p';
  /** 'c' = clap (512-dim), 'd' = dsp (64-dim) */
  m: 'c' | 'd';
  /** Base64-encoded Int8 quantized embedding. */
  e: string;
  /** Quantization scale (max absolute value in original L2-normalized vector). */
  a: number;
  /** Created timestamp. */
  c: number;
}

export interface SyncSnapshot {
  version: 1;
  updatedAt: number;
  config: Partial<FilterConfig>;
  rules: SyncedRuleItem[];
  vectors: SyncedVectorItem[];
  bgmFingerprints?: SyncedBgmItem[];
}

export const SYNC_META_KEY = 'afp_sync_meta';
export const SYNC_CHUNK_PREFIX = 'afp_sync_v_';
export const SYNC_BGM_CHUNK_PREFIX = 'afp_sync_b_';
export const MAX_VECTOR_CHUNKS = 10;
export const MAX_BGM_CHUNKS = 3;
const MAX_CHUNK_BYTES = 6600; // Safely under chrome.storage.sync's 8192-byte per-item limit.

export function encodeQuantizedEmbedding(embedding: number[]): { e: string; a: number } {
  let maxAbs = 0;
  for (let i = 0; i < embedding.length; i++) {
    const abs = Math.abs(embedding[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  const scale = maxAbs > 1e-8 ? maxAbs : 1;
  let binary = '';
  for (let i = 0; i < embedding.length; i++) {
    const q = Math.max(-127, Math.min(127, Math.round((embedding[i] / scale) * 127)));
    binary += String.fromCharCode(q & 0xff);
  }
  return {
    e: btoa(binary),
    a: Math.round(scale * 1e6) / 1e6,
  };
}

export function decodeQuantizedEmbedding(encoded: string, scale: number): number[] {
  const binary = atob(encoded);
  const out = new Array<number>(binary.length);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  let normSq = 0;
  for (let i = 0; i < binary.length; i++) {
    const byte = binary.charCodeAt(i);
    const signed = byte > 127 ? byte - 256 : byte;
    const v = (signed / 127) * safeScale;
    out[i] = v;
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq);
  if (norm > 1e-8) {
    for (let i = 0; i < out.length; i++) {
      out[i] /= norm;
    }
  }
  return out;
}

function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Pack a SyncSnapshot into chrome.storage.sync-safe key/value chunks (each < 6.6 KB).
 */
export function packSyncSnapshot(snapshot: SyncSnapshot): {
  items: Record<string, unknown>;
  chunkCount: number;
  bgmChunkCount: number;
} {
  // Prioritize positive anchors and most recently hit negative anchors if space is tight.
  const sortedVectors = [...snapshot.vectors].sort((a, b) => {
    if (a.p !== b.p) return a.p === 'p' ? -1 : 1;
    return b.l - a.l;
  });

  const chunks: SyncedVectorItem[][] = [];
  let current: SyncedVectorItem[] = [];
  let currentBytes = 2; // "[]"

  for (const vec of sortedVectors) {
    const compact: SyncedVectorItem = {
      ...vec,
      t: vec.t.slice(0, 120),
    };
    const itemBytes = byteLength(JSON.stringify(compact)) + 1;
    if (current.length > 0 && currentBytes + itemBytes > MAX_CHUNK_BYTES) {
      chunks.push(current);
      if (chunks.length >= MAX_VECTOR_CHUNKS) break;
      current = [compact];
      currentBytes = 2 + itemBytes;
    } else {
      current.push(compact);
      currentBytes += itemBytes;
    }
  }
  if (current.length > 0 && chunks.length < MAX_VECTOR_CHUNKS) {
    chunks.push(current);
  }

  // Pack BGM fingerprints into dedicated chunks (prioritize CLAP over DSP, newest first).
  const sortedBgm = [...(snapshot.bgmFingerprints ?? [])].sort((a, b) => {
    if (a.m !== b.m) return a.m === 'c' ? -1 : 1;
    return b.c - a.c;
  });
  const bgmChunks: SyncedBgmItem[][] = [];
  let curBgm: SyncedBgmItem[] = [];
  let curBgmBytes = 2;

  for (const bgm of sortedBgm) {
    const compact: SyncedBgmItem = {
      ...bgm,
      l: bgm.l.slice(0, 40),
    };
    const itemBytes = byteLength(JSON.stringify(compact)) + 1;
    if (curBgm.length > 0 && curBgmBytes + itemBytes > MAX_CHUNK_BYTES) {
      bgmChunks.push(curBgm);
      if (bgmChunks.length >= MAX_BGM_CHUNKS) break;
      curBgm = [compact];
      curBgmBytes = 2 + itemBytes;
    } else {
      curBgm.push(compact);
      curBgmBytes += itemBytes;
    }
  }
  if (curBgm.length > 0 && bgmChunks.length < MAX_BGM_CHUNKS) {
    bgmChunks.push(curBgm);
  }

  // Keep rules compact within meta item (< 6.6 KB).
  const safeRules: SyncedRuleItem[] = [];
  const metaBase = {
    version: 1 as const,
    updatedAt: snapshot.updatedAt,
    config: snapshot.config,
    rules: safeRules,
    chunkCount: chunks.length,
    bgmChunkCount: bgmChunks.length,
  };
  for (const rule of snapshot.rules) {
    safeRules.push(rule);
    if (byteLength(JSON.stringify(metaBase)) > MAX_CHUNK_BYTES) {
      safeRules.pop();
      break;
    }
  }

  const items: Record<string, unknown> = {
    [SYNC_META_KEY]: metaBase,
  };
  for (let i = 0; i < chunks.length; i++) {
    items[`${SYNC_CHUNK_PREFIX}${i}`] = chunks[i];
  }
  for (let i = 0; i < bgmChunks.length; i++) {
    items[`${SYNC_BGM_CHUNK_PREFIX}${i}`] = bgmChunks[i];
  }

  return { items, chunkCount: chunks.length, bgmChunkCount: bgmChunks.length };
}

/**
 * Unpack chrome.storage.sync records back into a SyncSnapshot.
 */
export function unpackSyncSnapshot(
  raw: Record<string, unknown>,
): SyncSnapshot | null {
  const meta = raw[SYNC_META_KEY] as
    | {
        version?: number;
        updatedAt?: number;
        config?: Partial<FilterConfig>;
        rules?: SyncedRuleItem[];
        chunkCount?: number;
        bgmChunkCount?: number;
      }
    | undefined;

  if (!meta || meta.version !== 1 || typeof meta.updatedAt !== 'number') {
    return null;
  }

  const chunkCount = Math.min(MAX_VECTOR_CHUNKS, Math.max(0, Number(meta.chunkCount ?? 0)));
  const vectors: SyncedVectorItem[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = raw[`${SYNC_CHUNK_PREFIX}${i}`];
    if (Array.isArray(chunk)) {
      for (const item of chunk) {
        if (item && typeof (item as SyncedVectorItem).id === 'string') {
          vectors.push(item as SyncedVectorItem);
        }
      }
    }
  }

  const bgmChunkCount = Math.min(MAX_BGM_CHUNKS, Math.max(0, Number(meta.bgmChunkCount ?? 0)));
  const bgmFingerprints: SyncedBgmItem[] = [];
  for (let i = 0; i < bgmChunkCount; i++) {
    const chunk = raw[`${SYNC_BGM_CHUNK_PREFIX}${i}`];
    if (Array.isArray(chunk)) {
      for (const item of chunk) {
        if (
          item &&
          typeof (item as SyncedBgmItem).id === 'string' &&
          typeof (item as SyncedBgmItem).e === 'string'
        ) {
          bgmFingerprints.push(item as SyncedBgmItem);
        }
      }
    }
  }

  return {
    version: 1,
    updatedAt: meta.updatedAt,
    config: meta.config ?? {},
    rules: Array.isArray(meta.rules) ? meta.rules : [],
    vectors,
    bgmFingerprints,
  };
}

export function getAllSyncKeys(): string[] {
  const keys = [SYNC_META_KEY];
  for (let i = 0; i < MAX_VECTOR_CHUNKS; i++) {
    keys.push(`${SYNC_CHUNK_PREFIX}${i}`);
  }
  for (let i = 0; i < MAX_BGM_CHUNKS; i++) {
    keys.push(`${SYNC_BGM_CHUNK_PREFIX}${i}`);
  }
  return keys;
}
