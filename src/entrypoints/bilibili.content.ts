import { BilibiliAdapter } from '@/adapters/bilibili';
import type { AdapterCallbacks, CardBinding } from '@/adapters/base';
import {
  captureVideoAudioSample,
  fetchAndAnalyzeBiliHoverAudio,
  matchOverusedBgmTitle,
} from '@/engine/audio-fingerprint';
import { isClickbaitTitle } from '@/engine/l1-rules';
import type { NormalizedItem } from '@/types/item';
import type {
  EvaluateBatchResponse,
  ExportDataResponse,
  ExtensionMessage,
  FeedItemResponse,
  ImportDataResponse,
  MatchBgmResponse,
  PetDataBackup,
  PetStatus,
  SponsorSegmentsResponse,
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
    let enableSponsorBlock = true;
    let enableAudioStyleGuard = true;
    let enableAudioClap = false;
    let enableHoverAudioPreview = true;
    let clapReady = false;
    let savedBgmCount = 0;
    let lastCheckedBvid = '';
    let lastSponsorBvid = '';
    let sponsorCleanup: (() => void) | null = null;

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
            enableSponsorBlock = status.config.enableSponsorBlock ?? true;
            enableAudioStyleGuard = status.config.enableAudioStyleGuard ?? true;
            enableAudioClap = status.config.enableAudioClap ?? false;
            enableHoverAudioPreview = status.config.enableHoverAudioPreview ?? true;
            clapReady = Boolean(status.clapReady);
            savedBgmCount = status.bgmFingerprints?.length ?? 0;
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
        if (typeof patch.enableSponsorBlock === 'boolean') {
          enableSponsorBlock = patch.enableSponsorBlock;
          if (!enableSponsorBlock && sponsorCleanup) {
            sponsorCleanup();
            sponsorCleanup = null;
          } else if (enableSponsorBlock) {
            lastSponsorBvid = '';
            void attachSponsorBlockMonitor();
          }
        }
        if (typeof patch.enableAudioStyleGuard === 'boolean') {
          enableAudioStyleGuard = patch.enableAudioStyleGuard;
        }
        if (typeof patch.enableAudioClap === 'boolean') {
          enableAudioClap = patch.enableAudioClap;
        }
        if (typeof patch.enableHoverAudioPreview === 'boolean') {
          enableHoverAudioPreview = patch.enableHoverAudioPreview;
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
      onCaptureBgm: async (severity, onProgress) => {
        const video = document.querySelector<HTMLVideoElement>('video');
        if (!video) {
          return { ok: false, message: '未检测到正在播放的视频，请在视频播放页操作' };
        }
        if (video.paused || video.ended) {
          return { ok: false, message: '请先播放视频（需有声音），再点采集' };
        }
        pet.setListening(true);
        const wantPcm = enableAudioClap && clapReady;
        const sample = await captureVideoAudioSample(video, 4000, onProgress, wantPcm).finally(
          () => {
            pet.setListening(false);
          },
        );
        if (!sample) {
          return { ok: false, message: '采集失败：请确保视频正在有声播放' };
        }
        const rawTitle =
          document.querySelector<HTMLElement>('h1.video-title, .video-title')?.textContent?.trim() ??
          document.title.replace(/_哔哩哔哩.*$/, '').trim();
        const label = rawTitle ? rawTitle.slice(0, 14) : '罐头BGM';
        const bvidMatch = window.location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
        const addRes = await sendMessage<{ ok?: boolean; embedder?: 'dsp' | 'clap' }>({
          type: 'ADD_BGM_FINGERPRINT',
          label,
          severity,
          embedding: Array.from(sample.fingerprint),
          pcmInt16: sample.pcmInt16,
          sourceItemId: bvidMatch?.[1],
        });
        pet.triggerBgmDisgust();
        refreshPetStatus();
        const tag = severity === 'penalty' ? '滥用降权' : '硬拉黑';
        const modeTag = addRes?.embedder === 'clap' ? ' (CLAP 语义)' : '';
        return { ok: true, message: `✅ 已收录${tag}音轨「${label}」${modeTag}` };
      },
      onRemoveBgm: async (id) => {
        await sendMessage({ type: 'REMOVE_BGM_FINGERPRINT', id });
        refreshPetStatus();
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

    const attachVideoPageBgmMonitor = () => {
      if (!window.location.pathname.startsWith('/video/')) return;
      const bvidMatch = window.location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
      const bvid = bvidMatch?.[1] ?? '';
      if (!bvid || bvid === lastCheckedBvid) return;

      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      const runCheck = async () => {
        if ((!enableAudioStyleGuard && savedBgmCount === 0) || bvid === lastCheckedBvid) return;
        if (video.paused || video.ended) return;
        lastCheckedBvid = bvid;

        // 1. Passive 0ms check for Bilibili's official BGM tag (e.g. "Sold Out", "The Spectre").
        const bgmTagText = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.bgm-tag, [class*="bgm-link"], .video-tag-container a',
          ),
        )
          .map((el) => el.textContent?.trim() ?? '')
          .join(' ');
        const overusedBgmHit = enableAudioStyleGuard ? matchOverusedBgmTitle(bgmTagText) : null;
        const pageTitle =
          document.querySelector<HTMLElement>('h1.video-title, .video-title')?.textContent?.trim() ??
          document.title.replace(/_哔哩哔哩.*$/, '').trim();

        // 2. Live 4-second audio sampling (fingerprint + Audio L1 physical style + optional CLAP PCM).
        pet.setListening(true);
        const wantPcm = enableAudioClap && clapReady && savedBgmCount > 0;
        const sample = await captureVideoAudioSample(video, 4000, undefined, wantPcm).finally(
          () => {
            pet.setListening(false);
          },
        );
        if (!sample) return;

        // Hard trigger #1: L1 physical style (heavy EDM bass beat or repetitive meme loop).
        if (enableAudioStyleGuard && sample.style.hardDisgust) {
          pet.triggerBgmDisgust();
          return;
        }

        // Hard / soft trigger #2: user's saved BGM fingerprint bank (CLAP 512-dim or DSP 64-dim).
        if (savedBgmCount > 0) {
          const match = await sendMessage<MatchBgmResponse>({
            type: 'MATCH_BGM_FINGERPRINT',
            embedding: Array.from(sample.fingerprint),
            pcmInt16: sample.pcmInt16,
          });
          if (match?.ok && match.matched) {
            if (match.severity !== 'penalty') {
              pet.triggerBgmDisgust();
              return;
            }
            // Soft low-taste penalty BGM (e.g. Sold Out): trigger visual disgust when combined
            // with clickbait title or noticeable beat/loop energy.
            if (
              isClickbaitTitle(pageTitle) ||
              sample.style.bassBeatScore >= 0.45 ||
              sample.style.loopScore >= 0.65
            ) {
              pet.triggerBgmDisgust();
              return;
            }
          }
        }

        // Soft trigger #3: passive overused BGM tag (e.g. Sold Out) + clickbait/beat combo.
        if (
          overusedBgmHit &&
          (isClickbaitTitle(pageTitle) || sample.style.bassBeatScore >= 0.45)
        ) {
          pet.triggerBgmDisgust();
        }
      };

      if (!video.paused) {
        void runCheck();
      } else {
        video.addEventListener('playing', () => void runCheck(), { once: true });
      }
    };

    const attachSponsorBlockMonitor = async () => {
      if (!enableSponsorBlock) return;
      if (!window.location.pathname.startsWith('/video/')) return;
      const bvidMatch = window.location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
      const bvid = bvidMatch?.[1] ?? '';
      if (!bvid || bvid === lastSponsorBvid) return;
      lastSponsorBvid = bvid;

      if (sponsorCleanup) {
        sponsorCleanup();
        sponsorCleanup = null;
      }

      const res = await sendMessage<SponsorSegmentsResponse>({
        type: 'GET_SPONSOR_SEGMENTS',
        bvid,
      }).catch(() => ({ ok: false, segments: [] }));

      if (!res?.ok || !Array.isArray(res.segments) || res.segments.length === 0) return;

      // Full-video sponsor/promo warning -> pure visual Pikachu disgust reaction.
      const hasFullPromo = res.segments.some((s) => s.actionType === 'full');
      if (hasFullPromo) {
        pet.triggerBgmDisgust();
      }

      const skipSegments = res.segments.filter((s) => s.actionType === 'skip');
      if (skipSegments.length === 0) return;

      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      const skippedUuids = new Set<string>();
      const onTimeUpdate = () => {
        if (!enableSponsorBlock) return;
        const t = video.currentTime;
        for (const seg of skipSegments) {
          const [start, end] = seg.segment;
          if (t >= start && t < end - 0.5 && !skippedUuids.has(seg.UUID)) {
            skippedUuids.add(seg.UUID);
            const dur = Math.max(1, Math.round(end - start));
            video.currentTime = end;
            pet.triggerEat(1, `⚡ 吃掉 ${dur}s 恰饭`);
            showUndoToast(`⚡ 已自动跳过 ${dur} 秒恰饭片段`, () => {
              video.currentTime = start;
            });
            const btn = document.querySelector<HTMLButtonElement>('#afp-undo-toast button');
            if (btn) btn.textContent = '跳回';
            break;
          }
        }
      };

      video.addEventListener('timeupdate', onTimeUpdate);
      sponsorCleanup = () => {
        video.removeEventListener('timeupdate', onTimeUpdate);
      };
    };

    // Hover-to-preview silent audio & SponsorBlock pre-check on feed/search cards.
    const hoverCache = new Map<string, 'clean' | 'disgust'>();
    let hoverTimer: number | null = null;
    let hoverAbort: AbortController | null = null;
    let activeHoverCard: HTMLElement | null = null;

    const flashCardDisgustRing = (card: HTMLElement) => {
      const prevOutline = card.style.outline;
      const prevOffset = card.style.outlineOffset;
      card.style.outline = '2px solid rgba(244, 63, 94, 0.85)';
      card.style.outlineOffset = '2px';
      window.setTimeout(() => {
        card.style.outline = prevOutline;
        card.style.outlineOffset = prevOffset;
      }, 2800);
    };

    const runHoverPreviewCheck = async (card: HTMLElement, bvid: string) => {
      const cached = hoverCache.get(bvid);
      if (cached === 'disgust') {
        pet.triggerBgmDisgust();
        flashCardDisgustRing(card);
        return;
      }
      if (cached === 'clean') return;

      if (hoverAbort) hoverAbort.abort();
      const controller = new AbortController();
      hoverAbort = controller;

      const cardTitle =
        card.querySelector<HTMLElement>('.bili-video-card__info--tit, .title')?.textContent?.trim() ??
        '';

      pet.setListening(true);
      try {
        const [sponsorRes, audioRes] = await Promise.all([
          enableSponsorBlock
            ? sendMessage<SponsorSegmentsResponse>({
                type: 'GET_SPONSOR_SEGMENTS',
                bvid,
              }).catch(() => ({ ok: false, segments: [] }))
            : Promise.resolve({ ok: false, segments: [] }),
          fetchAndAnalyzeBiliHoverAudio(
            bvid,
            enableAudioClap && clapReady && savedBgmCount > 0,
            controller.signal,
          ),
        ]);

        if (controller.signal.aborted) return;

        let disgusted = false;

        // 1. SponsorBlock full-video promo check.
        if (sponsorRes?.ok && sponsorRes.segments.some((s) => s.actionType === 'full')) {
          disgusted = true;
        }

        // 2. Audio L1 physical style & BGM fingerprint (CLAP or DSP).
        const sample = audioRes.sample;
        if (!disgusted && sample) {
          if (enableAudioStyleGuard && sample.style.hardDisgust) {
            disgusted = true;
          } else if (savedBgmCount > 0) {
            const match = await sendMessage<MatchBgmResponse>({
              type: 'MATCH_BGM_FINGERPRINT',
              embedding: Array.from(sample.fingerprint),
              pcmInt16: sample.pcmInt16,
            });
            if (match?.ok && match.matched) {
              if (
                match.severity !== 'penalty' ||
                isClickbaitTitle(cardTitle) ||
                sample.style.bassBeatScore >= 0.45 ||
                sample.style.loopScore >= 0.65
              ) {
                disgusted = true;
              }
            }
          }
        }

        hoverCache.set(bvid, disgusted ? 'disgust' : 'clean');
        if (disgusted) {
          pet.triggerBgmDisgust();
          flashCardDisgustRing(card);
        }
      } finally {
        if (hoverAbort === controller) {
          hoverAbort = null;
        }
        pet.setListening(false);
      }
    };

    document.body.addEventListener('mouseover', (event) => {
      if (!enableHoverAudioPreview) return;
      if (!enableAudioStyleGuard && savedBgmCount === 0 && !enableSponsorBlock) return;
      const card = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '.bili-video-card, .video-page-card-small',
      );
      if (!card || card === activeHoverCard) return;
      if (card.closest('#biliMainHeader, .bili-header, header')) return;
      if (card.querySelector('.afp-card-mask')) return;

      const link = card.querySelector<HTMLAnchorElement>('a[href*="/video/BV"]');
      const bvid = link?.getAttribute('href')?.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1];
      if (!bvid) return;

      activeHoverCard = card;
      if (hoverTimer !== null) window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => {
        hoverTimer = null;
        if (activeHoverCard === card) {
          void runHoverPreviewCheck(card, bvid);
        }
      }, 600);
    });

    document.body.addEventListener('mouseout', (event) => {
      if (!activeHoverCard) return;
      const related = event.relatedTarget as Node | null;
      if (related && activeHoverCard.contains(related)) return;
      activeHoverCard = null;
      if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (hoverAbort) {
        hoverAbort.abort();
        hoverAbort = null;
        pet.setListening(false);
      }
    });

    const startScanning = () => {
      // Give Bilibili's Vue 3 SSR hydration time to finish before injecting buttons/masks
      // into SSR-rendered cards, otherwise Vue hydration can mismatch and drop #biliMainHeader.
      const settleMs = window.location.pathname.startsWith('/video/') ? 900 : 350;
      window.setTimeout(() => {
        hydrationReady = true;
        scheduleScan(0);
        attachVideoPageBgmMonitor();
        void attachSponsorBlockMonitor();
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
        if (window.location.pathname.startsWith('/video/')) {
          attachVideoPageBgmMonitor();
          void attachSponsorBlockMonitor();
        }
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
