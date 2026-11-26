import type { NormalizedItem } from '@/types/item';

const FEED_API_HINTS = [
  '/x/web-interface/wbi/index/top/feed/rcmd',
  '/x/web-interface/index/top/feed/rcmd',
  '/x/web-interface/archive/related',
];

const MESSAGE_SOURCE = 'afp-bilibili-hook';

interface BiliRawVideo {
  bvid?: string;
  title?: string;
  pic?: string;
  duration?: number;
  owner?: { mid?: number; name?: string };
  stat?: { view?: number; like?: number; danmaku?: number };
  rcmd_reason?: { content?: string };
}

function normalizeBiliItem(raw: BiliRawVideo): NormalizedItem | null {
  if (!raw?.bvid || !raw?.title) return null;
  return {
    platform: 'bilibili',
    item_id: raw.bvid,
    media_type: 'video',
    author_id: raw.owner?.mid ? String(raw.owner.mid) : '',
    author_name: raw.owner?.name ?? '',
    title: raw.title,
    snippet: raw.rcmd_reason?.content,
    tags: [],
    cover_url: raw.pic,
    duration_sec: raw.duration,
    metrics: raw.stat
      ? {
          views: raw.stat.view,
          likes: raw.stat.like,
          danmaku: raw.stat.danmaku,
        }
      : undefined,
    fetched_at: Math.floor(Date.now() / 1000),
  };
}

function extractItemsFromPayload(payload: unknown): NormalizedItem[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: { item?: BiliRawVideo[] } | BiliRawVideo[] }).data;
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.item)
      ? data.item
      : [];
  const items: NormalizedItem[] = [];
  for (const raw of list) {
    const normalized = normalizeBiliItem(raw);
    if (normalized) items.push(normalized);
  }
  return items;
}

/**
 * Lightweight main-world fetch hook that passively reads Bilibili's own feed API
 * responses without making any additional network requests.
 */
export default defineContentScript({
  matches: ['*://*.bilibili.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      try {
        const url =
          typeof args[0] === 'string'
            ? args[0]
            : args[0] instanceof Request
              ? args[0].url
              : args[0]?.toString() ?? '';
        if (FEED_API_HINTS.some((hint) => url.includes(hint))) {
          response
            .clone()
            .json()
            .then((json) => {
              const items = extractItemsFromPayload(json);
              if (items.length > 0) {
                window.postMessage({ source: MESSAGE_SOURCE, items }, window.location.origin);
              }
            })
            .catch(() => {
              // Ignore non-JSON or aborted responses.
            });
        }
      } catch {
        // Never interfere with host page requests.
      }
      return response;
    };
  },
});
