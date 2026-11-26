import type { FilterDecision, NormalizedItem } from '@/types/item';
import type { AdapterCallbacks, CardBinding, SiteAdapter } from './base';

const CARD_SELECTORS = [
  '.bili-video-card',
  '.feed-card',
  '.video-page-card-small',
].join(',');

const BV_REGEX = /\/video\/(BV[0-9A-Za-z]+)/;
const FEED_BTN_CLASS = 'afp-feed-btn';
const MASK_CLASS = 'afp-card-mask';

/**
 * WeakMap guarantees card metadata is garbage-collected automatically when
 * Bilibili's SPA unmounts virtualized cards.
 */
const trackedCards = new WeakMap<HTMLElement, string>();

function extractItemFromDom(el: HTMLElement, apiCache: Map<string, NormalizedItem>): NormalizedItem | null {
  const link = el.querySelector<HTMLAnchorElement>('a[href*="/video/BV"]');
  const match = link?.getAttribute('href')?.match(BV_REGEX);
  const bvid = match?.[1];
  if (!bvid) return null;

  // Prefer richer metadata captured passively from Bilibili's native feed API.
  const cached = apiCache.get(bvid);
  if (cached) return cached;

  const titleEl =
    el.querySelector<HTMLElement>('.bili-video-card__info--tit') ??
    el.querySelector<HTMLElement>('.title') ??
    link;
  const authorEl =
    el.querySelector<HTMLElement>('.bili-video-card__info--author') ??
    el.querySelector<HTMLElement>('.upname');
  const authorLink = el.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]');
  const authorIdMatch = authorLink?.getAttribute('href')?.match(/space\.bilibili\.com\/(\d+)/);
  const imgEl = el.querySelector<HTMLImageElement>('img');

  const title = titleEl?.textContent?.trim() ?? '';
  if (!title) return null;

  return {
    platform: 'bilibili',
    item_id: bvid,
    media_type: 'video',
    author_id: authorIdMatch?.[1] ?? '',
    author_name: authorEl?.textContent?.trim() ?? '',
    title,
    tags: [],
    cover_url: imgEl?.src || undefined,
    fetched_at: Math.floor(Date.now() / 1000),
  };
}

export class BilibiliAdapter implements SiteAdapter {
  readonly platform = 'bilibili' as const;

  scanCards(apiCache: Map<string, NormalizedItem>): CardBinding[] {
    const nodes = document.querySelectorAll<HTMLElement>(CARD_SELECTORS);
    const bindings: CardBinding[] = [];

    for (const el of nodes) {
      const item = extractItemFromDom(el, apiCache);
      if (!item) continue;

      if (trackedCards.get(el) === item.item_id) continue;
      trackedCards.set(el, item.item_id);
      bindings.push({ element: el, item });
    }

    return bindings;
  }

  attachFeedButton(binding: CardBinding, callbacks: AdapterCallbacks): void {
    const { element, item } = binding;
    if (element.querySelector(`.${FEED_BTN_CLASS}`)) return;

    const computed = window.getComputedStyle(element);
    if (computed.position === 'static') {
      element.style.position = 'relative';
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = FEED_BTN_CLASS;
    btn.textContent = '🐾 投喂';
    btn.title = '投喂给宠物（吃掉这类内容）';
    Object.assign(btn.style, {
      position: 'absolute',
      top: '6px',
      right: '6px',
      zIndex: '20',
      padding: '2px 8px',
      fontSize: '12px',
      lineHeight: '18px',
      borderRadius: '999px',
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'rgba(18, 18, 24, 0.72)',
      color: '#fff',
      cursor: 'pointer',
      backdropFilter: 'blur(6px)',
      opacity: '0.85',
      transition: 'opacity 120ms ease, transform 120ms ease',
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onFeed(item, element);
    });

    element.appendChild(btn);
  }

  applyMask(
    binding: CardBinding,
    decision: FilterDecision,
    callbacks: AdapterCallbacks,
  ): void {
    const { element, item } = binding;
    this.restoreCard(element);

    const computed = window.getComputedStyle(element);
    if (computed.position === 'static') {
      element.style.position = 'relative';
    }

    const isAutoBlocked = decision.layer === 'L2' || decision.reason !== '你手动投喂给了宠物';

    // Preserve card outer box dimensions so Bilibili's grid layout never jumps.
    const mask = document.createElement('div');
    mask.className = MASK_CLASS;
    Object.assign(mask.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '30',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      padding: '12px',
      textAlign: 'center',
      borderRadius: '8px',
      background: isAutoBlocked
        ? 'rgba(12, 22, 38, 0.90)'
        : 'rgba(20, 22, 30, 0.86)',
      border: isAutoBlocked
        ? '1.5px solid rgba(56, 189, 248, 0.65)'
        : '1px solid rgba(148, 163, 184, 0.25)',
      backdropFilter: 'blur(10px)',
      color: '#e5e7eb',
      fontSize: '12px',
    });

    const label = document.createElement('div');
    label.textContent = isAutoBlocked
      ? '✨ 宠物自动帮你吃掉了这条内容'
      : '🐾 已手动投喂给宠物';
    label.style.fontWeight = '600';
    label.style.color = isAutoBlocked ? '#7dd3fc' : '#f1f5f9';

    const reason = document.createElement('div');
    reason.textContent = decision.reason ?? '命中过滤规则';
    reason.style.color = '#9ca3af';
    reason.style.fontSize = '11px';

    const spitBtn = document.createElement('button');
    spitBtn.type = 'button';
    spitBtn.textContent = '吐出查看（纠偏）';
    Object.assign(spitBtn.style, {
      padding: '4px 10px',
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(255,255,255,0.1)',
      color: '#fff',
      fontSize: '12px',
      cursor: 'pointer',
    });

    spitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.restoreCard(element);
      callbacks.onSpit(item, element, decision.matchedAnchorId);
    });

    mask.append(label, reason, spitBtn);
    element.appendChild(mask);
  }

  restoreCard(element: HTMLElement): void {
    const existing = element.querySelector(`.${MASK_CLASS}`);
    if (existing) existing.remove();
  }
}
