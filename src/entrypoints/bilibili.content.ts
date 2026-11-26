import { BilibiliAdapter } from '@/adapters/bilibili';
import type { AdapterCallbacks, CardBinding } from '@/adapters/base';
import type { NormalizedItem } from '@/types/item';
import type {
  EvaluateBatchResponse,
  ExportDataResponse,
  ExtensionMessage,
  FeedItemResponse,
  ImportDataResponse,
  PetDataBackup,
  PetStatus,
  SyncNowResponse,
} from '@/types/messages';
import { FloatingPetController } from '@/ui/floating-pet';

const HOOK_SOURCE = 'afp-bilibili-hook';
const UNDO_TOAST_MS = 4000;

function sendMessage<T>(msg: ExtensionMessage): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

function showUndoToast(
  message: string,
  onUndo: () => void,
  extraAction?: { label: string; onClick: () => void },
): void {
  const existing = document.getElementById('afp-undo-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'afp-undo-toast';
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    borderRadius: '10px',
    background: 'rgba(18, 20, 28, 0.94)',
    color: '#f3f4f6',
    fontSize: '13px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    border: '1px solid rgba(255,255,255,0.12)',
  });

  const text = document.createElement('span');
  text.textContent = message;

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.textContent = '撤销';
  Object.assign(undoBtn.style, {
    padding: '3px 8px',
    borderRadius: '6px',
    border: 'none',
    background: '#38bdf8',
    color: '#0f172a',
    fontWeight: '600',
    cursor: 'pointer',
  });
  undoBtn.addEventListener('click', () => {
    toast.remove();
    onUndo();
  });

  toast.append(text, undoBtn);

  if (extraAction) {
    const extraBtn = document.createElement('button');
    extraBtn.type = 'button';
    extraBtn.textContent = extraAction.label;
    Object.assign(extraBtn.style, {
      padding: '3px 8px',
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(239, 68, 68, 0.2)',
      color: '#fca5a5',
      cursor: 'pointer',
    });
    extraBtn.addEventListener('click', () => {
      toast.remove();
      extraAction.onClick();
    });
    toast.append(extraBtn);
  }

  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), UNDO_TOAST_MS);
}

export default defineContentScript({
  matches: ['*://*.bilibili.com/*'],
  runAt: 'document_idle',
  main() {
    const adapter = new BilibiliAdapter();
    const apiCache = new Map<string, NormalizedItem>();
    let rescanTimer: number | null = null;
    let syncNativeDislike = true;
    let debugMode = false;
    let hideAds = true;
    let hideFloorCards = true;

    const syncProxyFlags = () => {
      document.documentElement.dataset.afpHideAds = hideAds ? '1' : '0';
      document.documentElement.dataset.afpHideFloor = hideFloorCards ? '1' : '0';
    };
    syncProxyFlags();

    const scheduleRescanVisible = (delayMs = 150) => {
      if (rescanTimer !== null) {
        window.clearTimeout(rescanTimer);
      }
      rescanTimer = window.setTimeout(() => {
        rescanTimer = null;
        const bindings = adapter.scanCards(apiCache, true);
        void processBindings(bindings);
      }, delayMs);
    };

    const refreshPetStatus = () => {
      void sendMessage<PetStatus>({ type: 'GET_STATUS' })
        .then((status) => {
          if (status && typeof status.todayEaten === 'number') {
            syncNativeDislike = status.config.syncNativeDislike ?? true;
            debugMode = status.config.debugMode ?? false;
            hideAds = status.config.hideAds ?? true;
            hideFloorCards = status.config.hideFloorCards ?? true;
            syncProxyFlags();
            pet.syncStatus(status);
          } else {
            pet.setDegraded(true);
          }
        })
        .catch(() => {
          pet.setDegraded(true);
        });
    };

    const pet = new FloatingPetController({
      onConfigPatch: (patch, rescan) => {
        if (typeof patch.debugMode === 'boolean') {
          debugMode = patch.debugMode;
          if (!debugMode) {
            adapter.clearAllDebugBadges();
          }
        }
        if (typeof patch.hideAds === 'boolean' || typeof patch.hideFloorCards === 'boolean') {
          if (typeof patch.hideAds === 'boolean') hideAds = patch.hideAds;
          if (typeof patch.hideFloorCards === 'boolean') hideFloorCards = patch.hideFloorCards;
          syncProxyFlags();
          const eatenPromos = adapter.eatAdCards(hideAds, hideFloorCards);
          if (eatenPromos > 0) {
            pet.triggerEat(eatenPromos, `⚡ 清理推广 +${eatenPromos}`);
          }
        }
        void sendMessage({ type: 'UPDATE_CONFIG', patch }).then(() => {
          if (rescan) scheduleRescanVisible(patch.debugMode !== undefined ? 60 : 260);
        });
      },
      onSkinChange: (skinId) => {
        void sendMessage({ type: 'UPDATE_CONFIG', patch: { petSkin: skinId } });
      },
      onSyncNativeDislikeChange: (enabled) => {
        syncNativeDislike = enabled;
        void sendMessage({ type: 'UPDATE_CONFIG', patch: { syncNativeDislike: enabled } });
      },
      onAddRule: async (kind, value) => {
        await sendMessage({ type: 'ADD_RULE', kind, value });
        refreshPetStatus();
        scheduleRescanVisible(100);
      },
      onRemoveRule: async (id) => {
        await sendMessage({ type: 'REMOVE_RULE', id });
        refreshPetStatus();
      },
      onRemoveVector: async (id) => {
        await sendMessage({ type: 'REMOVE_VECTOR', id });
        refreshPetStatus();
        scheduleRescanVisible(100);
      },
      onRequestRefreshStatus: refreshPetStatus,
      onExportData: () => sendMessage<ExportDataResponse>({ type: 'EXPORT_DATA' }),
      onImportData: async (data: PetDataBackup) => {
        const res = await sendMessage<ImportDataResponse>({
          type: 'IMPORT_DATA',
          data,
          mode: 'merge',
        });
        if (res?.ok) {
          scheduleRescanVisible(150);
        }
        return res;
      },
      onSyncNow: async () => {
        const res = await sendMessage<SyncNowResponse>({ type: 'SYNC_NOW' });
        if (res?.ok && res.pulledVectors > 0) {
          scheduleRescanVisible(150);
        }
        return res;
      },
    });
    pet.mount();
    refreshPetStatus();

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        items?: NormalizedItem[];
        removed?: number;
      } | null;
      if (data?.source === 'afp-rcmd-filtered' && typeof data.removed === 'number' && data.removed > 0) {
        pet.triggerEat(data.removed, `⚡ 接口拦截推广 +${data.removed}`);
        return;
      }
      if (data?.source !== HOOK_SOURCE || !Array.isArray(data.items)) return;
      for (const item of data.items) {
        apiCache.set(item.item_id, item);
      }
      scheduleScan();
    });

    const callbacks: AdapterCallbacks = {
      onFeed: async (item, element) => {
        const nativeDislikePromise = syncNativeDislike
          ? adapter.triggerNativeNotInterested(element)
          : Promise.resolve(false);

        adapter.applyMask(
          { element, item },
          {
            item_id: item.item_id,
            blocked: true,
            layer: 'L1',
            score: 100,
            reason: '你手动投喂给了宠物',
          },
          callbacks,
        );
        pet.triggerEat(1);

        try {
          const [res, syncedNative] = await Promise.all([
            sendMessage<FeedItemResponse>({
              type: 'FEED_ITEM',
              item,
            }),
            nativeDislikePromise,
          ]);
          refreshPetStatus();
          scheduleRescanVisible(200);
          const syncSuffix = syncedNative ? '（已同步 B 站不感兴趣）' : '';
          showUndoToast(
            `🐾 宠物吃掉了《${item.title.slice(0, 16)}…》${syncSuffix}`,
            () => {
              adapter.restoreCard(element);
              pet.triggerSpit();
              void sendMessage({ type: 'UNDO_FEED', itemId: item.item_id }).then(
                refreshPetStatus,
              );
            },
            res?.suggestBlockAuthor && item.author_id
              ? {
                  label: `拉黑 ${item.author_name || '该UP主'}`,
                  onClick: () => {
                    void sendMessage({
                      type: 'FEED_ITEM',
                      item,
                      blockAuthor: true,
                    }).then(refreshPetStatus);
                  },
                }
              : undefined,
          );
        } catch {
          // Fail gracefully if background is reloading.
        }
      },
      onSpit: async (item, _element, matchedAnchorId) => {
        pet.triggerSpit();
        try {
          await sendMessage({ type: 'SPIT_ITEM', item, matchedAnchorId });
          refreshPetStatus();
        } catch {
          // Ignore RPC error on unload.
        }
      },
    };

    async function processBindings(bindings: CardBinding[]): Promise<void> {
      if (bindings.length === 0) return;

      for (const binding of bindings) {
        adapter.attachFeedButton(binding, callbacks);
      }

      try {
        const response = await sendMessage<EvaluateBatchResponse>({
          type: 'EVALUATE_BATCH',
          items: bindings.map((b) => b.item),
        });
        if (response?.degraded) {
          pet.setDegraded(true);
        }
        const decisionById = new Map(
          (response?.decisions ?? []).map((d) => [d.item_id, d]),
        );
        let autoBlocked = 0;
        for (const binding of bindings) {
          const decision = decisionById.get(binding.item.item_id);
          if (decision) {
            adapter.applyDebugBadge(binding, decision, debugMode);
            if (decision.blocked) {
              adapter.applyMask(binding, decision, callbacks);
              autoBlocked += 1;
            }
          }
        }
        if (autoBlocked > 0) {
          pet.triggerEat(autoBlocked, `自动吃掉 +${autoBlocked}`);
          refreshPetStatus();
        }
      } catch {
        // Fail-Open: keep original cards visible if SW or Offscreen is unavailable.
        pet.setDegraded(true);
      }
    }

    let scanTimer: number | null = null;
    let hydrationReady = false;

    function scheduleScan(delayMs = 180): void {
      if (!hydrationReady) return;
      if (scanTimer !== null) return;
      scanTimer = window.setTimeout(() => {
        scanTimer = null;
        const eatenPromos = adapter.eatAdCards(hideAds, hideFloorCards);
        if (eatenPromos > 0) {
          pet.triggerEat(eatenPromos, `⚡ 清理推广 +${eatenPromos}`);
        }
        const bindings = adapter.scanCards(apiCache);
        void processBindings(bindings);
      }, delayMs);
    }

    const startScanning = () => {
      // Give Bilibili's Vue 3 SSR hydration time to finish before injecting buttons/masks
      // into SSR-rendered cards, otherwise Vue hydration can mismatch and drop #biliMainHeader.
      const settleMs = window.location.pathname.startsWith('/video/') ? 900 : 350;
      window.setTimeout(() => {
        hydrationReady = true;
        scheduleScan(0);
      }, settleMs);
    };

    const observer = new MutationObserver((mutations) => {
      if (!hydrationReady) return;
      const hasExternalChange = mutations.some((m) => {
        const target = m.target as HTMLElement | null;
        if (!target) return false;
        if (
          target.id === 'afp-floating-pet-host' ||
          target.id === 'afp-undo-toast' ||
          target.classList?.contains('afp-card-mask')
        ) {
          return false;
        }
        return true;
      });
      if (hasExternalChange) {
        scheduleScan(180);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    if (document.readyState === 'complete') {
      startScanning();
    } else {
      window.addEventListener('load', startScanning, { once: true });
    }
  },
});
