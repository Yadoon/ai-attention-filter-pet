import { BilibiliAdapter } from '@/adapters/bilibili';
import type { AdapterCallbacks, CardBinding } from '@/adapters/base';
import type { NormalizedItem } from '@/types/item';
import type {
  EvaluateBatchResponse,
  ExtensionMessage,
  FeedItemResponse,
  PetStatus,
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
    let rafPending = false;

    const refreshPetStatus = () => {
      void sendMessage<PetStatus>({ type: 'GET_STATUS' })
        .then((status) => {
          if (status) pet.syncStatus(status);
        })
        .catch(() => {
          pet.setDegraded(true);
        });
    };

    const pet = new FloatingPetController({
      onThresholdChange: (value) => {
        void sendMessage({ type: 'UPDATE_CONFIG', patch: { l2Threshold: value } });
      },
      onRequestRefreshStatus: refreshPetStatus,
    });
    pet.mount();
    refreshPetStatus();

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; items?: NormalizedItem[] } | null;
      if (data?.source !== HOOK_SOURCE || !Array.isArray(data.items)) return;
      for (const item of data.items) {
        apiCache.set(item.item_id, item);
      }
      scheduleScan();
    });

    const callbacks: AdapterCallbacks = {
      onFeed: async (item, element) => {
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
        pet.triggerEat(1, '嚼嚼 +1');

        try {
          const res = await sendMessage<FeedItemResponse>({
            type: 'FEED_ITEM',
            item,
          });
          refreshPetStatus();
          showUndoToast(
            `🐾 宠物吃掉了《${item.title.slice(0, 18)}…》`,
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
        pet.setDegraded(Boolean(response?.degraded));
        const decisionById = new Map(
          (response?.decisions ?? []).map((d) => [d.item_id, d]),
        );
        let autoBlocked = 0;
        for (const binding of bindings) {
          const decision = decisionById.get(binding.item.item_id);
          if (decision?.blocked) {
            adapter.applyMask(binding, decision, callbacks);
            autoBlocked += 1;
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

    function scheduleScan(): void {
      if (rafPending) return;
      rafPending = true;
      window.requestAnimationFrame(() => {
        rafPending = false;
        const bindings = adapter.scanCards(apiCache);
        void processBindings(bindings);
      });
    }

    const observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleScan();
  },
});
