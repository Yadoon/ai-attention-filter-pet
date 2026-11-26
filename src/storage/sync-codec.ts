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

export interface SyncSnapshot {
  version: 1;
  updatedAt: number;
  config: Partial<FilterConfig>;
  rules: SyncedRuleItem[];
  vectors: SyncedVectorItem[];
}

export const SYNC_META_KEY = 'afp_sync_meta';
export const SYNC_CHUNK_PREFIX = 'afp_sync_v_';
const MAX_CHUNK_BYTES = 6800; // Safely under chrome.storage.sync's 8192-byte per-item limit.
const MAX_CHUNKS = 10; // Safely under chrome.storage.sync's 102400-byte total quota.

function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Pack a SyncSnapshot into chrome.storage.sync-safe key/value chunks (each < 6.8 KB).
 */
export function packSyncSnapshot(snapshot: SyncSnapshot): {
  items: Record<string, unknown>;
  chunkCount: number;
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
      if (chunks.length >= MAX_CHUNKS) break;
      current = [compact];
      currentBytes = 2 + itemBytes;
    } else {
      current.push(compact);
      currentBytes += itemBytes;
    }
  }
  if (current.length > 0 && chunks.length < MAX_CHUNKS) {
    chunks.push(current);
  }

  // Keep rules compact within meta item (< 6.8 KB).
  const safeRules: SyncedRuleItem[] = [];
  let metaBase = {
    version: 1 as const,
    updatedAt: snapshot.updatedAt,
    config: snapshot.config,
    rules: safeRules,
    chunkCount: chunks.length,
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

  return { items, chunkCount: chunks.length };
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
      }
    | undefined;

  if (!meta || meta.version !== 1 || typeof meta.updatedAt !== 'number') {
    return null;
  }

  const chunkCount = Math.min(MAX_CHUNKS, Math.max(0, Number(meta.chunkCount ?? 0)));
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

  return {
    version: 1,
    updatedAt: meta.updatedAt,
    config: meta.config ?? {},
    rules: Array.isArray(meta.rules) ? meta.rules : [],
    vectors,
  };
}

export function getAllSyncKeys(): string[] {
  const keys = [SYNC_META_KEY];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    keys.push(`${SYNC_CHUNK_PREFIX}${i}`);
  }
  return keys;
}
