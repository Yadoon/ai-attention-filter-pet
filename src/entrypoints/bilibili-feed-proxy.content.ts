/**
 * Homepage-only MAIN-world API proxy that filters Bilibili's recommendation feed JSON
 * (`/top/feed/rcmd`) before Vue renders it — eliminating ads and non-video promo cards
 * cleanly at the data layer with zero white holes or grid layout breakage.
 *
 * Scoped strictly to `https://www.bilibili.com/` so `/video/` pages and `#biliMainHeader`
 * are completely untouched.
 */

interface RcmdItem {
  goto?: string;
  bvid?: string;
  uri?: string;
  is_ad?: boolean;
  business_info?: unknown;
  ad_info?: unknown;
}

interface RcmdPayload {
  code?: number;
  data?: {
    item?: RcmdItem[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const RCMD_API_HINT = '/top/feed/rcmd';

function isAdItem(item: RcmdItem): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.goto === 'ad' || item.is_ad === true) return true;
  if (item.business_info || item.ad_info) return true;
  if (!item.bvid && typeof item.uri === 'string' && item.uri.includes('cm.bilibili.com')) {
    return true;
  }
  return false;
}

function isNonVideoPromoItem(item: RcmdItem): boolean {
  if (!item || typeof item !== 'object') return false;
  // Standard user videos always have goto === 'av' and a valid bvid.
  if (item.goto && item.goto !== 'av') return true;
  if (!item.bvid) return true;
  return false;
}

function getFilterFlags(): { hideAds: boolean; hideFloor: boolean } {
  const ds = document.documentElement?.dataset;
  return {
    hideAds: ds?.afpHideAds !== '0',
    hideFloor: ds?.afpHideFloor !== '0',
  };
}

function filterRcmdPayload(payload: RcmdPayload): { changed: boolean; removed: number } {
  const list = payload?.data?.item;
  if (!Array.isArray(list)) return { changed: false, removed: 0 };

  const { hideAds, hideFloor } = getFilterFlags();
  if (!hideAds && !hideFloor) return { changed: false, removed: 0 };

  const filtered = list.filter((item) => {
    if (hideAds && isAdItem(item)) return false;
    if (hideFloor && isNonVideoPromoItem(item)) return false;
    return true;
  });

  const removed = list.length - filtered.length;
  if (removed === 0) return { changed: false, removed: 0 };

  payload.data!.item = filtered;
  return { changed: true, removed };
}

export default defineContentScript({
  matches: ['https://www.bilibili.com/', 'https://www.bilibili.com/?*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    // 1. Proxy window.fetch ONLY for /top/feed/rcmd
    const nativeFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
      const response = await nativeFetch.apply(this, args);
      try {
        const url =
          typeof args[0] === 'string'
            ? args[0]
            : args[0] instanceof Request
              ? args[0].url
              : String(args[0] ?? '');

        if (!url.includes(RCMD_API_HINT)) {
          return response;
        }

        const cloned = response.clone();
        const payload = (await cloned.json()) as RcmdPayload;
        const { changed, removed } = filterRcmdPayload(payload);
        if (!changed) return response;

        window.postMessage(
          { source: 'afp-rcmd-filtered', removed },
          window.location.origin,
        );

        const headers = new Headers(response.headers);
        headers.delete('content-length');
        return new Response(JSON.stringify(payload), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch {
        return response;
      }
    };

    // 2. Proxy XMLHttpRequest ONLY for /top/feed/rcmd (in case Bilibili uses axios/XHR)
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const xhrUrlMap = new WeakMap<XMLHttpRequest, string>();

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      xhrUrlMap.set(this, String(url));
      return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const url = xhrUrlMap.get(this) ?? '';
      if (url.includes(RCMD_API_HINT)) {
        this.addEventListener('readystatechange', () => {
          if (this.readyState !== 4 || this.status !== 200) return;
          try {
            const rawText = this.responseText;
            if (!rawText) return;
            const payload = JSON.parse(rawText) as RcmdPayload;
            const { changed, removed } = filterRcmdPayload(payload);
            if (!changed) return;

            const nextText = JSON.stringify(payload);
            Object.defineProperty(this, 'responseText', {
              configurable: true,
              value: nextText,
            });
            Object.defineProperty(this, 'response', {
              configurable: true,
              value: this.responseType === 'json' ? payload : nextText,
            });
            window.postMessage(
              { source: 'afp-rcmd-filtered', removed },
              window.location.origin,
            );
          } catch {
            // Never break XHR on parse errors.
          }
        });
      }
      return origSend.call(this, body);
    };
  },
});
