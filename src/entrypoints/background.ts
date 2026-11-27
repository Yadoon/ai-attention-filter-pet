import { fetchSponsorSegments } from '@/engine/sponsorblock';
import {
  MAX_BGM_CHUNKS,
  MAX_VECTOR_CHUNKS,
  SYNC_BGM_CHUNK_PREFIX,
  SYNC_CHUNK_PREFIX,
  SYNC_META_KEY,
  getAllSyncKeys,
  packSyncSnapshot,
  unpackSyncSnapshot,
  type SyncSnapshot,
} from '@/storage/sync-codec';
import type {
  ExtensionMessage,
  SponsorSegmentsResponse,
  SyncNowResponse,
} from '@/types/messages';

const OFFSCREEN_URL = '/offscreen.html';
let creatingOffscreen: Promise<void> | null = null;
let syncPushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushedAt = 0;

const MUTATING_TYPES = new Set([
  'FEED_ITEM',
  'SPIT_ITEM',
  'UNDO_FEED',
  'UPDATE_CONFIG',
  'ADD_RULE',
  'REMOVE_RULE',
  'REMOVE_VECTOR',
  'ADD_BGM_FINGERPRINT',
  'REMOVE_BGM_FINGERPRINT',
  'IMPORT_DATA',
]);

async function ensureOffscreenDocument(): Promise<void> {
  if (!browser.offscreen) return;

  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = browser.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['WORKERS'],
        justification: 'Run local ONNX/WebGPU embedding inference and IndexedDB vector search.',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function pullFromChromeSync(): Promise<{ pulledVectors: number; pulledBgm: number }> {
  if (!browser.storage?.sync) return { pulledVectors: 0, pulledBgm: 0 };
  try {
    const raw = (await browser.storage.sync.get(getAllSyncKeys())) as Record<string, unknown>;
    const snapshot = unpackSyncSnapshot(raw);
    if (!snapshot) return { pulledVectors: 0, pulledBgm: 0 };
    await ensureOffscreenDocument();
    const res = (await browser.runtime.sendMessage({
      type: 'APPLY_SYNC_SNAPSHOT',
      snapshot,
      target: 'offscreen',
    })) as { ok?: boolean; pulledVectors?: number; pulledBgm?: number } | undefined;
    return {
      pulledVectors: res?.pulledVectors ?? 0,
      pulledBgm: res?.pulledBgm ?? 0,
    };
  } catch (err) {
    console.warn('[AFP] Failed to pull from chrome.storage.sync:', err);
    return { pulledVectors: 0, pulledBgm: 0 };
  }
}

async function pushToChromeSync(): Promise<{ syncedVectors: number; syncedBgm: number }> {
  if (!browser.storage?.sync) return { syncedVectors: 0, syncedBgm: 0 };
  try {
    await ensureOffscreenDocument();
    const res = (await browser.runtime.sendMessage({
      type: 'GET_SYNC_SNAPSHOT',
      target: 'offscreen',
    })) as { ok?: boolean; snapshot?: SyncSnapshot } | undefined;
    if (!res?.ok || !res.snapshot) return { syncedVectors: 0, syncedBgm: 0 };

    const { items, chunkCount, bgmChunkCount } = packSyncSnapshot(res.snapshot);
    lastPushedAt = res.snapshot.updatedAt;
    await browser.storage.sync.set(items);

    // Clean up any stale chunks from previous larger snapshots.
    const staleKeys: string[] = [];
    for (let i = chunkCount; i < MAX_VECTOR_CHUNKS; i++) {
      staleKeys.push(`${SYNC_CHUNK_PREFIX}${i}`);
    }
    for (let i = bgmChunkCount; i < MAX_BGM_CHUNKS; i++) {
      staleKeys.push(`${SYNC_BGM_CHUNK_PREFIX}${i}`);
    }
    if (staleKeys.length > 0) {
      await browser.storage.sync.remove(staleKeys);
    }
    return {
      syncedVectors: res.snapshot.vectors.length,
      syncedBgm: res.snapshot.bgmFingerprints?.length ?? 0,
    };
  } catch (err) {
    console.warn('[AFP] Failed to push to chrome.storage.sync:', err);
    return { syncedVectors: 0, syncedBgm: 0 };
  }
}

function schedulePushToSync(delayMs = 3000): void {
  if (syncPushTimer !== null) {
    clearTimeout(syncPushTimer);
  }
  syncPushTimer = setTimeout(() => {
    syncPushTimer = null;
    void pushToChromeSync();
  }, delayMs);
}

export default defineBackground(() => {
  void ensureOffscreenDocument()
    .then(() => pullFromChromeSync())
    .catch(() => {
      // Will retry lazily on first message.
    });

  // Listen for remote sync updates arriving from another Chrome device.
  browser.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !(SYNC_META_KEY in changes)) return;
    const nextMeta = changes[SYNC_META_KEY]?.newValue as { updatedAt?: number } | undefined;
    if (nextMeta?.updatedAt && nextMeta.updatedAt === lastPushedAt) {
      return; // Ignore echo from our own write.
    }
    void pullFromChromeSync();
  });

  browser.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
    const message = rawMessage as (ExtensionMessage & { target?: string }) | undefined;
    // Avoid infinite loop for messages already targeted at the offscreen document.
    if (message?.target === 'offscreen') return false;

    if (message?.type === 'GET_SPONSOR_SEGMENTS') {
      (async () => {
        const segments = await fetchSponsorSegments(message.bvid);
        const res: SponsorSegmentsResponse = { ok: true, segments };
        sendResponse(res);
      })();
      return true;
    }

    if (message?.type === 'SYNC_NOW') {
      (async () => {
        try {
          const { pulledVectors, pulledBgm } = await pullFromChromeSync();
          const { syncedVectors, syncedBgm } = await pushToChromeSync();
          const res: SyncNowResponse = {
            ok: true,
            syncedVectors,
            pulledVectors,
            syncedBgm,
            pulledBgm,
          };
          sendResponse(res);
        } catch (err) {
          const res: SyncNowResponse = {
            ok: false,
            syncedVectors: 0,
            pulledVectors: 0,
            syncedBgm: 0,
            pulledBgm: 0,
            error: err instanceof Error ? err.message : '云同步失败',
          };
          sendResponse(res);
        }
      })();
      return true;
    }

    const validTypes = new Set([
      'EVALUATE_BATCH',
      'FEED_ITEM',
      'SPIT_ITEM',
      'UNDO_FEED',
      'GET_STATUS',
      'UPDATE_CONFIG',
      'ADD_RULE',
      'REMOVE_RULE',
      'REMOVE_VECTOR',
      'EXPORT_DATA',
      'IMPORT_DATA',
      'ADD_BGM_FINGERPRINT',
      'REMOVE_BGM_FINGERPRINT',
      'MATCH_BGM_FINGERPRINT',
    ]);
    if (!message || !validTypes.has(message.type)) return false;

    (async () => {
      try {
        await ensureOffscreenDocument();
        const result = await browser.runtime.sendMessage({
          ...message,
          target: 'offscreen',
        });
        if (MUTATING_TYPES.has(message.type)) {
          schedulePushToSync();
        }
        sendResponse(result);
      } catch {
        if (message.type === 'EVALUATE_BATCH') {
          sendResponse({
            decisions: message.items.map((item) => ({
              item_id: item.item_id,
              blocked: false,
              layer: 'FAIL_OPEN',
              score: 0,
              reason: 'Offscreen 未就绪，降级放行',
            })),
            degraded: true,
          });
        } else {
          sendResponse({ ok: false });
        }
      }
    })();

    return true;
  });
});
