import type { ExtensionMessage } from '@/types/messages';

const OFFSCREEN_URL = '/offscreen.html';
let creatingOffscreen: Promise<void> | null = null;

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

export default defineBackground(() => {
  void ensureOffscreenDocument().catch(() => {
    // Will retry lazily on first message.
  });

  browser.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
    const message = rawMessage as (ExtensionMessage & { target?: string }) | undefined;
    // Avoid infinite loop for messages already targeted at the offscreen document.
    if (message?.target === 'offscreen') return false;

    const validTypes = new Set([
      'EVALUATE_BATCH',
      'FEED_ITEM',
      'SPIT_ITEM',
      'UNDO_FEED',
      'GET_STATUS',
      'UPDATE_CONFIG',
    ]);
    if (!message || !validTypes.has(message.type)) return false;

    (async () => {
      try {
        await ensureOffscreenDocument();
        const result = await browser.runtime.sendMessage({
          ...message,
          target: 'offscreen',
        });
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
