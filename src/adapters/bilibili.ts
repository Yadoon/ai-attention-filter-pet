import type { FilterDecision, NormalizedItem } from '@/types/item';
import { openDecisionInspector } from '@/ui/decision-inspector';
import type { AdapterCallbacks, CardBinding, SiteAdapter } from './base';

const CARD_SELECTORS = [
  '.bili-video-card',
  '.feed-card',
  '.video-page-card-small',
].join(',');

const BV_REGEX = /\/video\/(BV[0-9A-Za-z]+)/;
const FEED_BTN_CLASS = 'afp-feed-btn';
const MASK_CLASS = 'afp-card-mask';
const DEBUG_BADGE_CLASS = 'afp-debug-badge';

/**
 * WeakMap guarantees card metadata is garbage-collected automatically when
 * Bilibili's SPA unmounts virtualized cards.
 */
const trackedCards = new WeakMap<HTMLElement, string>();

function parseCompactCount(raw: string | null | undefined): number | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const num = parseFloat(text.replace(/,/g, ''));
  if (!Number.isFinite(num)) return undefined;
  if (text.includes('亿')) return Math.round(num * 100_000_000);
  if (text.includes('万')) return Math.round(num * 10_000);
  return Math.round(num);
}

function parseDurationSeconds(raw: string | null | undefined): number | undefined {
  const text = raw?.trim();
  if (!text || !text.includes(':')) return undefined;
  const parts = text.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

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
    el.querySelector<HTMLElement>('h3[title], a[title][href*="/video/BV"]');
  const authorEl =
    el.querySelector<HTMLElement>('.bili-video-card__info--author') ??
    el.querySelector<HTMLElement>('.upname');
  const authorLink = el.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]');
  const authorIdMatch = authorLink?.getAttribute('href')?.match(/space\.bilibili\.com\/(\d+)/);
  const imgEl = el.querySelector<HTMLImageElement>('img');

  const durationEl =
    el.querySelector<HTMLElement>('.bili-video-card__stats__duration') ??
    el.querySelector<HTMLElement>('.duration');
  const statItems = el.querySelectorAll<HTMLElement>('.bili-video-card__stats--item');
  const views = parseCompactCount(statItems[0]?.textContent);
  const danmaku = parseCompactCount(statItems[1]?.textContent);
  const duration_sec = parseDurationSeconds(durationEl?.textContent);

  // Detect Bilibili's 🚀 rocket-promoted ("创作推广 / 起飞") video cards:
  // They replace the bottom-right MM:SS duration text with an SVG/icon or carry ad/cm links.
  const hasRocketIcon =
    (durationEl !== null &&
      duration_sec === undefined &&
      durationEl.querySelector('svg, img') !== null) ||
    el.querySelector(
      '[class*="rocket"], [class*="promote"], .bili-video-card__stats--ad, a[href*="cm.bilibili.com"], a[href*="ad_extra="]',
    ) !== null;

  const rawTitle =
    titleEl?.getAttribute('title')?.trim() ||
    titleEl?.textContent?.trim() ||
    imgEl?.getAttribute('alt')?.trim() ||
    '';
  // Guard against cover-stats text (e.g. "2048200:18" or "5.1万48104:02") leaking as title.
  const title = /^[\d.,万亿:\s]+$/.test(rawTitle) ? '' : rawTitle;
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
    duration_sec,
    metrics: views !== undefined || danmaku !== undefined ? { views, danmaku } : undefined,
    is_promoted: hasRocketIcon || undefined,
    fetched_at: Math.floor(Date.now() / 1000),
  };
}

export class BilibiliAdapter implements SiteAdapter {
  readonly platform = 'bilibili' as const;

  scanCards(apiCache: Map<string, NormalizedItem>, forceRescan = false): CardBinding[] {
    const nodes = document.querySelectorAll<HTMLElement>(CARD_SELECTORS);
    const bindings: CardBinding[] = [];

    for (const el of nodes) {
      // Never touch elements inside Bilibili's top navigation header.
      if (el.closest('#biliMainHeader, .bili-header, header')) continue;
      // Avoid double-masking nested cards (Bilibili homepage wraps .bili-video-card inside .feed-card).
      if (el.classList.contains('feed-card') && el.querySelector('.bili-video-card')) continue;

      const item = extractItemFromDom(el, apiCache);
      if (!item) continue;

      if (forceRescan) {
        // Skip cards that are already masked so we don't double-count them.
        if (el.querySelector(`.${MASK_CLASS}`)) continue;
      } else if (trackedCards.get(el) === item.item_id) {
        continue;
      }
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
      zIndex: '5',
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
    const isCompact = element.offsetHeight > 0 && element.offsetHeight < 130;

    // Preserve card outer box dimensions so Bilibili's grid layout never jumps.
    const mask = document.createElement('div');
    mask.className = MASK_CLASS;
    Object.assign(mask.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '8',
      boxSizing: 'border-box',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: isCompact ? '3px' : '8px',
      padding: isCompact ? '6px 8px' : '12px',
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
      fontSize: isCompact ? '11px' : '12px',
    });

    const label = document.createElement('div');
    label.textContent = isAutoBlocked
      ? '✨ 宠物自动帮你吃掉了这条内容'
      : '🐾 已手动投喂给宠物';
    label.style.fontWeight = '600';
    label.style.color = isAutoBlocked ? '#7dd3fc' : '#f1f5f9';
    if (isCompact) {
      label.style.display = 'none';
    }

    // Show the blocked item's own title so the user can verify without peeking or polluting whitelist.
    const itemPreview = document.createElement('div');
    const authorSuffix = !isCompact && item.author_name ? ` · ${item.author_name}` : '';
    itemPreview.textContent = isCompact
      ? `${isAutoBlocked ? '✨' : '🐾'} ${item.title}`
      : `原视频：${item.title}${authorSuffix}`;
    Object.assign(itemPreview.style, {
      color: isCompact ? '#e2e8f0' : '#cbd5e1',
      fontSize: isCompact ? '11px' : '11px',
      fontWeight: isCompact ? '600' : '400',
      lineHeight: '1.35',
      maxWidth: '100%',
      display: '-webkit-box',
      webkitLineClamp: isCompact ? '1' : '2',
      webkitBoxOrient: 'vertical',
      overflow: 'hidden',
      background: isCompact ? 'transparent' : 'rgba(255, 255, 255, 0.06)',
      padding: isCompact ? '0' : '4px 8px',
      borderRadius: '6px',
    });

    const reason = document.createElement('div');
    reason.textContent = decision.reason ?? '命中过滤规则';
    reason.title = '点击查看皮卡丘决策账单';
    Object.assign(reason.style, {
      color: '#94a3b8',
      fontSize: isCompact ? '10px' : '11px',
      maxWidth: '100%',
      whiteSpace: isCompact ? 'nowrap' : 'normal',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      cursor: 'pointer',
      textDecoration: 'underline dotted rgba(148, 163, 184, 0.55)',
    });
    reason.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDecisionInspector(reason, item, decision);
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      marginTop: isCompact ? '1px' : '2px',
    });

    const peekBtn = document.createElement('button');
    peekBtn.type = 'button';
    peekBtn.textContent = '👁 偷看原卡';
    Object.assign(peekBtn.style, {
      padding: isCompact ? '2px 7px' : '4px 9px',
      borderRadius: '6px',
      border: '1px solid rgba(148, 163, 184, 0.35)',
      background: 'rgba(15, 23, 42, 0.7)',
      color: '#e2e8f0',
      fontSize: isCompact ? '10px' : '11px',
      cursor: 'pointer',
    });

    const spitBtn = document.createElement('button');
    spitBtn.type = 'button';
    spitBtn.textContent = '误杀纠偏';
    spitBtn.title = '确认误杀：恢复显示并加入白库，避免同类再被拦截';
    Object.assign(spitBtn.style, {
      padding: isCompact ? '2px 7px' : '4px 9px',
      borderRadius: '6px',
      border: '1px solid rgba(56, 189, 248, 0.45)',
      background: 'rgba(56, 189, 248, 0.16)',
      color: '#bae6fd',
      fontSize: isCompact ? '10px' : '11px',
      cursor: 'pointer',
    });

    let peeking = false;
    const applyPeekState = () => {
      if (peeking) {
        label.style.display = 'none';
        itemPreview.style.display = 'none';
        reason.style.display = 'none';
        Object.assign(mask.style, {
          background: 'transparent',
          backdropFilter: 'none',
          border: '1.5px dashed rgba(250, 204, 21, 0.75)',
          justifyContent: 'flex-end',
          alignItems: 'flex-end',
          padding: '6px',
          pointerEvents: 'none',
        });
        actions.style.pointerEvents = 'auto';
        peekBtn.textContent = '🙈 重新盖上';
        peekBtn.style.background = 'rgba(15, 23, 42, 0.92)';
        spitBtn.style.background = 'rgba(14, 116, 144, 0.92)';
      } else {
        label.style.display = isCompact ? 'none' : '';
        itemPreview.style.display = '-webkit-box';
        reason.style.display = '';
        Object.assign(mask.style, {
          background: isAutoBlocked
            ? 'rgba(12, 22, 38, 0.90)'
            : 'rgba(20, 22, 30, 0.86)',
          backdropFilter: 'blur(10px)',
          border: isAutoBlocked
            ? '1.5px solid rgba(56, 189, 248, 0.65)'
            : '1px solid rgba(148, 163, 184, 0.25)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: isCompact ? '6px 8px' : '12px',
          pointerEvents: 'auto',
        });
        peekBtn.textContent = '👁 偷看原卡';
        peekBtn.style.background = 'rgba(15, 23, 42, 0.7)';
        spitBtn.style.background = 'rgba(56, 189, 248, 0.16)';
      }
    };

    peekBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      peeking = !peeking;
      applyPeekState();
    });

    spitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.restoreCard(element);
      callbacks.onSpit(item, element, decision.matchedAnchorId);
    });

    actions.append(peekBtn, spitBtn);
    mask.append(label, itemPreview, reason, actions);
    element.appendChild(mask);
  }

  restoreCard(element: HTMLElement): void {
    const existing = element.querySelector(`.${MASK_CLASS}`);
    if (existing) existing.remove();
  }

  /**
   * Render a lightweight top-left scoring badge on every evaluated card when debugMode is enabled
   * so users can see exact negative/positive similarity scores and why a card passed or got blocked.
   */
  applyDebugBadge(binding: CardBinding, decision: FilterDecision, enabled: boolean): void {
    const { element } = binding;
    const existing = element.querySelector(`.${DEBUG_BADGE_CLASS}`);
    if (!enabled) {
      if (existing) existing.remove();
      return;
    }

    const computed = window.getComputedStyle(element);
    if (computed.position === 'static') {
      element.style.position = 'relative';
    }

    const badge = (existing as HTMLDivElement | null) ?? document.createElement('div');
    badge.className = DEBUG_BADGE_CLASS;

    const d = decision.debug;
    if (decision.layer === 'L1') {
      badge.textContent = decision.blocked ? `🔴 L1拦截` : `🟢 L1放行`;
      badge.title = decision.reason ?? 'L1 规则命中';
    } else if (d) {
      const icon = decision.blocked ? '🔴' : '🟢';
      const posPart = d.effectivePos > 0 ? ` 白${d.maxPos.toFixed(2)}` : '';
      const sigDelta = d.signalDelta ?? 0;
      const sigPart =
        sigDelta !== 0 ? ` ${sigDelta > 0 ? '+' : ''}${sigDelta.toFixed(2)}` : '';
      badge.textContent = `${icon} ${decision.score.toFixed(2)} (负${d.maxNeg.toFixed(2)}${posPart}${sigPart})`;
      const negLine = d.matchedNegTitle
        ? `最像负样本：${d.matchedNegTitle} (${d.maxNeg.toFixed(3)})`
        : `负样本最高分：${d.maxNeg.toFixed(3)}`;
      const posLine = d.matchedPosTitle
        ? `最像白库：${d.matchedPosTitle} (${d.maxPos.toFixed(3)}${d.effectivePos > 0 ? ' · 已生效' : ' · 未达门槛'})`
        : `白库最高分：${d.maxPos.toFixed(3)}`;
      const sigLine =
        d.signalNotes && d.signalNotes.length > 0
          ? `\n外显修正：${d.signalNotes.join(' · ')}`
          : '';
      badge.title = `${negLine}\n${posLine}${sigLine}\n最终分 ${decision.score.toFixed(3)} vs 阈值 ${d.threshold.toFixed(2)}`;
    } else {
      badge.textContent = decision.blocked ? '🔴 拦截' : '⚪ 未评分';
      badge.title = decision.reason ?? '无负样本或降级放行';
    }

    Object.assign(badge.style, {
      position: 'absolute',
      top: '6px',
      left: '6px',
      zIndex: '9',
      padding: '2px 6px',
      borderRadius: '6px',
      background: decision.blocked ? 'rgba(127, 29, 29, 0.88)' : 'rgba(15, 23, 42, 0.82)',
      border: decision.blocked
        ? '1px solid rgba(248, 113, 113, 0.65)'
        : '1px solid rgba(148, 163, 184, 0.4)',
      color: '#f8fafc',
      fontSize: '10px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      lineHeight: '1.3',
      pointerEvents: 'auto',
      cursor: 'pointer',
      backdropFilter: 'blur(4px)',
    });

    badge.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDecisionInspector(badge, binding.item, decision);
    };

    if (!existing) {
      element.appendChild(badge);
    }
  }

  clearAllDebugBadges(): void {
    document.querySelectorAll(`.${DEBUG_BADGE_CLASS}`).forEach((el) => el.remove());
  }

  /**
   * Detect and hide sidebar ad containers (e.g. on /video/ pages) and standalone floor promo cards.
   * Homepage feed items (`ad`, `live`, `ogv`, `manga`, etc.) are filtered cleanly at the API layer
   * in `bilibili-feed-proxy.content.ts` so homepage grid layout and skeleton loading stay intact.
   */
  eatAdCards(hideAds: boolean, hideFloorCards = true): number {
    if (!hideAds) {
      document.querySelectorAll<HTMLElement>('[data-afp-hidden-kind="ad"]').forEach((el) => {
        el.style.display = '';
        delete el.dataset.afpHiddenKind;
      });
    }
    if (!hideFloorCards) {
      document.querySelectorAll<HTMLElement>('[data-afp-hidden-kind="floor"]').forEach((el) => {
        el.style.display = '';
        delete el.dataset.afpHiddenKind;
      });
    }
    if (!hideAds && !hideFloorCards) return 0;

    let hiddenNow = 0;

    // On /video/ pages, hide explicit sidebar ad cards safely.
    if (hideAds) {
      const sidebarAds = document.querySelectorAll<HTMLElement>(
        '.video-card-ad-small, .ad-report, .slide-ad-exp, .ad-floor-exp',
      );
      for (const el of sidebarAds) {
        if (el.closest('#biliMainHeader, .bili-header, header')) continue;
        if (el.dataset.afpHiddenKind) continue;
        el.dataset.afpHiddenKind = 'ad';
        el.style.display = 'none';
        hiddenNow += 1;
      }

      // Catch homepage feed ad cards injected via SSR or /x/web-show/res/locs
      // (no /video/BV link, carrying "广告" badge, "人感兴趣", or cm.bilibili.com).
      // Mask in-place so Bilibili's CSS grid & skeleton loader never break.
      const feedCards = document.querySelectorAll<HTMLElement>('.bili-video-card');
      for (const card of feedCards) {
        if (card.closest('#biliMainHeader, .bili-header, header')) continue;
        if (card.querySelector(`.${MASK_CLASS}`)) continue;
        if (card.querySelector('a[href*="/video/BV"]')) continue;

        const hasAdMarker =
          card.querySelector(
            'a[href*="cm.bilibili.com"], a[href*="ad_extra="], .bili-video-card__info--ad, .ad-tag, .bili-video-card__stats--ad',
          ) !== null;

        let hasAdText = false;
        if (!hasAdMarker) {
          const text = card.textContent ?? '';
          if (text.includes('人感兴趣')) {
            hasAdText = true;
          } else {
            const leaves = card.querySelectorAll<HTMLElement>('span, div, em, i, a');
            for (const node of leaves) {
              if (node.children.length > 0) continue;
              const t = node.textContent?.trim();
              if (t === '广告' || t === '创作推广') {
                hasAdText = true;
                break;
              }
            }
          }
        }

        if (!hasAdMarker && !hasAdText) continue;

        const computed = window.getComputedStyle(card);
        if (computed.position === 'static') {
          card.style.position = 'relative';
        }
        const adTitle =
          card.querySelector<HTMLElement>('.bili-video-card__info--tit')?.textContent?.trim() ??
          '商业推广广告';
        const mask = document.createElement('div');
        mask.className = MASK_CLASS;
        mask.dataset.afpAdMask = '1';
        Object.assign(mask.style, {
          position: 'absolute',
          inset: '0',
          zIndex: '8',
          boxSizing: 'border-box',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '12px',
          textAlign: 'center',
          borderRadius: '8px',
          background: 'rgba(15, 23, 42, 0.92)',
          border: '1px solid rgba(250, 204, 21, 0.45)',
          backdropFilter: 'blur(10px)',
          color: '#fde68a',
          fontSize: '12px',
          fontWeight: '600',
        });
        const heading = document.createElement('div');
        heading.textContent = '🛡️ 皮卡丘已吃掉这条广告';
        const sub = document.createElement('div');
        sub.textContent = adTitle.slice(0, 28);
        Object.assign(sub.style, {
          color: '#94a3b8',
          fontSize: '11px',
          fontWeight: '400',
        });
        mask.append(heading, sub);
        card.appendChild(mask);
        hiddenNow += 1;
      }
    } else {
      document.querySelectorAll<HTMLElement>('[data-afp-ad-mask="1"]').forEach((m) => m.remove());
    }

    // Hide standalone non-video floor cards (.floor-single-card) if any were SSR-rendered.
    if (hideFloorCards) {
      const floorCards = document.querySelectorAll<HTMLElement>('.floor-single-card');
      for (const el of floorCards) {
        if (el.closest('#biliMainHeader, .bili-header, header')) continue;
        if (el.dataset.afpHiddenKind) continue;
        el.dataset.afpHiddenKind = 'floor';
        el.style.display = 'none';
        hiddenNow += 1;
      }
    }

    return hiddenNow;
  }

  /**
   * Best-effort trigger for Bilibili's native "不感兴趣" button on homepage feed cards
   * so Bilibili's own recommendation algorithm also learns to stop pushing similar videos.
   */
  async triggerNativeNotInterested(element: HTMLElement): Promise<boolean> {
    try {
      const triggerSelectors = [
        '.bili-video-card__info--no-interest',
        '[class*="no-interest"]',
        '[title*="不感兴趣"]',
        '[aria-label*="不感兴趣"]',
        '.bili-video-card__info--menu',
      ];
      let trigger: HTMLElement | null = null;
      for (const sel of triggerSelectors) {
        const candidate = element.querySelector<HTMLElement>(sel);
        if (
          candidate &&
          !candidate.classList.contains(FEED_BTN_CLASS) &&
          !candidate.closest(`.${MASK_CLASS}`)
        ) {
          trigger = candidate;
          break;
        }
      }
      if (!trigger) return false;

      const directHit =
        trigger.className.includes('no-interest') ||
        (trigger.title ?? '').includes('不感兴趣') ||
        (trigger.getAttribute('aria-label') ?? '').includes('不感兴趣');

      trigger.click();

      // Wait briefly for Bilibili's dislike popover menu to render, then pick "不感兴趣".
      await new Promise((resolve) => window.setTimeout(resolve, 90));

      const menuCandidates = document.querySelectorAll<HTMLElement>(
        '.bili-video-card__info--no-interest--panel *, .bili-popover *, [class*="dislike"] *, [class*="no-interest"] *',
      );
      for (const node of menuCandidates) {
        if (node.children.length > 0) continue;
        const txt = node.textContent?.trim() ?? '';
        if (txt.includes('不感兴趣') && !txt.includes('UP主') && !txt.includes('up主')) {
          node.click();
          return true;
        }
      }

      return directHit;
    } catch {
      return false;
    }
  }
}
