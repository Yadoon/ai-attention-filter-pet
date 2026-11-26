import { DEFAULT_FILTER_CONFIG } from '@/types/item';
import type { PetStatus } from '@/types/messages';

export interface FloatingPetOptions {
  onThresholdChange: (threshold: number) => void;
  onRequestRefreshStatus: () => void;
}

const HOST_ID = 'afp-floating-pet-host';

const STYLES = `
  :host {
    all: initial;
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 2147483646;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #f1f5f9;
  }

  * {
    box-sizing: border-box;
  }

  .wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
  }

  /* Expandable Drawer */
  .drawer {
    width: 312px;
    border-radius: 16px;
    background: rgba(15, 23, 42, 0.94);
    border: 1px solid rgba(148, 163, 184, 0.2);
    box-shadow: 0 18px 42px rgba(2, 6, 23, 0.55);
    backdrop-filter: blur(14px);
    padding: 14px;
    display: none;
    flex-direction: column;
    gap: 12px;
    transform-origin: bottom right;
    animation: drawerIn 160ms ease-out;
  }

  .drawer.open {
    display: flex;
  }

  @keyframes drawerIn {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .drawer-title {
    font-size: 13px;
    font-weight: 700;
    color: #f8fafc;
  }

  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid rgba(56, 189, 248, 0.35);
    background: rgba(56, 189, 248, 0.12);
    color: #7dd3fc;
  }

  .badge.degraded {
    border-color: rgba(251, 191, 36, 0.4);
    background: rgba(251, 191, 36, 0.12);
    color: #fcd34d;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .stat-card {
    background: rgba(30, 41, 59, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 10px;
    padding: 8px 6px;
    text-align: center;
  }

  .stat-num {
    font-size: 17px;
    font-weight: 700;
    line-height: 1.2;
  }

  .stat-num.sky { color: #38bdf8; }
  .stat-num.rose { color: #fb7185; }
  .stat-num.emerald { color: #34d399; }

  .stat-label {
    font-size: 11px;
    color: #94a3b8;
    margin-top: 2px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
    margin-bottom: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(244, 63, 94, 0.14);
    border: 1px solid rgba(244, 63, 94, 0.28);
    color: #fda4af;
  }

  .empty-hint {
    font-size: 11px;
    color: #64748b;
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 120px;
    overflow-y: auto;
  }

  .recent-item {
    background: rgba(30, 41, 59, 0.6);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 11px;
  }

  .recent-title {
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-reason {
    color: #94a3b8;
    font-size: 10px;
    margin-top: 2px;
  }

  .slider-box {
    background: rgba(30, 41, 59, 0.6);
    border-radius: 10px;
    padding: 8px 10px;
  }

  .slider-box input[type="range"] {
    width: 100%;
    accent-color: #38bdf8;
    cursor: pointer;
  }

  /* Floating Pet Orb */
  .pet-btn {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: 1.5px solid rgba(56, 189, 248, 0.45);
    background: radial-gradient(circle at 30% 25%, #1e293b, #0f172a 75%);
    box-shadow: 0 10px 26px rgba(2, 6, 23, 0.5), 0 0 0 0 rgba(56, 189, 248, 0.35);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: transform 160ms ease, border-color 160ms ease;
    animation: petFloat 3.4s ease-in-out infinite;
  }

  .pet-btn:hover {
    transform: scale(1.07);
    border-color: rgba(125, 211, 252, 0.85);
  }

  .pet-btn.eating {
    animation: petChomp 520ms cubic-bezier(0.34, 1.56, 0.64, 1);
    border-color: #38bdf8;
  }

  .pet-btn.spitting {
    animation: petSpit 420ms ease-in-out;
    border-color: #fbbf24;
  }

  @keyframes petFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  @keyframes petChomp {
    0% { transform: scale(1); }
    28% { transform: scale(1.24, 0.86); }
    55% { transform: scale(0.92, 1.15); }
    78% { transform: scale(1.08, 0.96); }
    100% { transform: scale(1); }
  }

  @keyframes petSpit {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px) rotate(-6deg); }
    65% { transform: translateX(5px) rotate(6deg); }
  }

  .pet-face {
    width: 34px;
    height: 34px;
    pointer-events: none;
  }

  .counter-pill {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 999px;
    background: #0284c7;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  }

  .status-dot {
    position: absolute;
    bottom: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #34d399;
    border: 2px solid #0f172a;
  }

  .status-dot.degraded {
    background: #fbbf24;
  }

  .pop-bubble {
    position: absolute;
    bottom: 64px;
    right: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(14, 165, 233, 0.95);
    color: #082f49;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    pointer-events: none;
    animation: popRise 1100ms ease-out forwards;
  }

  @keyframes popRise {
    0% { opacity: 0; transform: translateY(6px) scale(0.9); }
    18% { opacity: 1; transform: translateY(0) scale(1); }
    80% { opacity: 1; transform: translateY(-10px); }
    100% { opacity: 0; transform: translateY(-18px); }
  }
`;

function renderPetSvg(mood: 'idle' | 'eating' | 'spitting'): string {
  if (mood === 'eating') {
    return `
      <svg class="pet-face" viewBox="0 0 40 40" fill="none">
        <path d="M11 16 L16 19 L11 22" stroke="#7dd3fc" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M29 16 L24 19 L29 22" stroke="#7dd3fc" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        <ellipse cx="20" cy="27" rx="6.5" ry="5.5" fill="#fb7185"/>
        <path d="M15 26 Q20 29 25 26" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`;
  }
  if (mood === 'spitting') {
    return `
      <svg class="pet-face" viewBox="0 0 40 40" fill="none">
        <circle cx="14" cy="17" r="2.8" fill="#fcd34d"/>
        <circle cx="26" cy="17" r="2.8" fill="#fcd34d"/>
        <path d="M14 27 Q20 22 26 27" stroke="#fcd34d" stroke-width="2.4" stroke-linecap="round"/>
      </svg>`;
  }
  return `
    <svg class="pet-face" viewBox="0 0 40 40" fill="none">
      <circle cx="14" cy="17" r="3" fill="#7dd3fc"/>
      <circle cx="26" cy="17" r="3" fill="#7dd3fc"/>
      <circle cx="15" cy="16" r="1" fill="#fff"/>
      <circle cx="27" cy="16" r="1" fill="#fff"/>
      <path d="M15 25 Q20 29 25 25" stroke="#7dd3fc" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`;
}

/**
 * Lightweight Shadow DOM companion pet with swallow/spit micro-animations and stats drawer.
 */
export class FloatingPetController {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private drawerEl: HTMLDivElement | null = null;
  private petBtnEl: HTMLButtonElement | null = null;
  private counterEl: HTMLSpanElement | null = null;
  private dotEl: HTMLSpanElement | null = null;
  private badgeEl: HTMLSpanElement | null = null;
  private statEatenEl: HTMLDivElement | null = null;
  private statNegEl: HTMLDivElement | null = null;
  private statPosEl: HTMLDivElement | null = null;
  private cloudEl: HTMLDivElement | null = null;
  private recentEl: HTMLDivElement | null = null;
  private thresholdInput: HTMLInputElement | null = null;
  private thresholdValEl: HTMLSpanElement | null = null;

  private isOpen = false;
  private todayEaten = 0;
  private animTimer: number | null = null;

  constructor(private readonly options: FloatingPetOptions) {}

  mount(): void {
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLES;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="drawer" role="dialog" aria-label="宠物过滤面板">
        <div class="drawer-header">
          <span class="drawer-title">🐾 注意力守护宠物</span>
          <span class="badge degraded" data-role="badge">轻装规则模式</span>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-num sky" data-role="eaten">0</div>
            <div class="stat-label">今日吃掉</div>
          </div>
          <div class="stat-card">
            <div class="stat-num rose" data-role="neg">0</div>
            <div class="stat-label">负样本库</div>
          </div>
          <div class="stat-card">
            <div class="stat-num emerald" data-role="pos">0</div>
            <div class="stat-label">白库纠偏</div>
          </div>
        </div>

        <div>
          <div class="section-title"><span>被吃掉的垃圾词云</span></div>
          <div class="cloud" data-role="cloud">
            <span class="empty-hint">投喂几条内容后自动生成词云</span>
          </div>
        </div>

        <div>
          <div class="section-title"><span>最近拦截</span></div>
          <div class="recent-list" data-role="recent">
            <span class="empty-hint">暂未拦截内容</span>
          </div>
        </div>

        <div class="slider-box">
          <div class="section-title" style="margin-bottom:4px">
            <span>语义拦截阈值（越低越严格）</span>
            <span data-role="threshold-val" style="color:#38bdf8;font-family:monospace">${DEFAULT_FILTER_CONFIG.l2Threshold.toFixed(2)}</span>
          </div>
          <input type="range" min="0.55" max="0.95" step="0.01" value="${DEFAULT_FILTER_CONFIG.l2Threshold}" data-role="threshold" />
        </div>
      </div>

      <button type="button" class="pet-btn" title="点击展开注意力宠物面板">
        ${renderPetSvg('idle')}
        <span class="counter-pill" data-role="counter">0</span>
        <span class="status-dot degraded" data-role="dot"></span>
      </button>
    `;

    shadow.append(style, wrap);
    document.body.appendChild(host);

    this.host = host;
    this.shadow = shadow;
    this.drawerEl = shadow.querySelector('.drawer');
    this.petBtnEl = shadow.querySelector('.pet-btn');
    this.counterEl = shadow.querySelector('[data-role="counter"]');
    this.dotEl = shadow.querySelector('[data-role="dot"]');
    this.badgeEl = shadow.querySelector('[data-role="badge"]');
    this.statEatenEl = shadow.querySelector('[data-role="eaten"]');
    this.statNegEl = shadow.querySelector('[data-role="neg"]');
    this.statPosEl = shadow.querySelector('[data-role="pos"]');
    this.cloudEl = shadow.querySelector('[data-role="cloud"]');
    this.recentEl = shadow.querySelector('[data-role="recent"]');
    this.thresholdInput = shadow.querySelector('[data-role="threshold"]');
    this.thresholdValEl = shadow.querySelector('[data-role="threshold-val"]');

    this.petBtnEl?.addEventListener('click', () => {
      this.isOpen = !this.isOpen;
      this.drawerEl?.classList.toggle('open', this.isOpen);
      if (this.isOpen) {
        this.options.onRequestRefreshStatus();
      }
    });

    this.thresholdInput?.addEventListener('input', () => {
      if (!this.thresholdInput || !this.thresholdValEl) return;
      const val = Number(this.thresholdInput.value);
      this.thresholdValEl.textContent = val.toFixed(2);
      this.options.onThresholdChange(val);
    });
  }

  syncStatus(status: PetStatus): void {
    this.todayEaten = status.todayEaten;
    if (this.counterEl) this.counterEl.textContent = String(status.todayEaten);
    if (this.statEatenEl) this.statEatenEl.textContent = String(status.todayEaten);
    if (this.statNegEl) this.statNegEl.textContent = String(status.negativeCount);
    if (this.statPosEl) this.statPosEl.textContent = String(status.positiveCount);

    this.setDegraded(!status.modelReady, status.backend, status.modelLoading);

    if (this.thresholdInput && this.thresholdValEl) {
      this.thresholdInput.value = String(status.config.l2Threshold);
      this.thresholdValEl.textContent = status.config.l2Threshold.toFixed(2);
    }

    if (this.cloudEl) {
      this.cloudEl.replaceChildren();
      if (status.topKeywords.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'empty-hint';
        empty.textContent = '投喂几条内容后自动生成词云';
        this.cloudEl.appendChild(empty);
      } else {
        for (const kw of status.topKeywords) {
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.textContent = `${kw.word} ×${kw.count}`;
          this.cloudEl.appendChild(chip);
        }
      }
    }

    if (this.recentEl) {
      this.recentEl.replaceChildren();
      if (status.recentEaten.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'empty-hint';
        empty.textContent = '暂未拦截内容';
        this.recentEl.appendChild(empty);
      } else {
        for (const entry of status.recentEaten) {
          const row = document.createElement('div');
          row.className = 'recent-item';

          const title = document.createElement('div');
          title.className = 'recent-title';
          title.textContent = entry.title;

          const reason = document.createElement('div');
          reason.className = 'recent-reason';
          reason.textContent = entry.reason;

          row.append(title, reason);
          this.recentEl.appendChild(row);
        }
      }
    }
  }

  setDegraded(
    degraded: boolean,
    backend?: PetStatus['backend'],
    modelLoading?: boolean,
  ): void {
    this.dotEl?.classList.toggle('degraded', degraded);
    if (!this.badgeEl) return;
    this.badgeEl.classList.toggle('degraded', degraded);
    if (backend === 'webgpu') {
      this.badgeEl.textContent = 'WebGPU 语义加速';
    } else if (backend === 'wasm') {
      this.badgeEl.textContent = 'WASM 语义加速';
    } else if (backend === 'ngram') {
      this.badgeEl.textContent = modelLoading
        ? '词面向量（模型下载中…）'
        : '词面向量模式（离线可用）';
    } else {
      this.badgeEl.textContent = degraded ? '词面向量兜底' : '本地引擎就绪';
    }
  }

  triggerEat(count = 1, label?: string): void {
    if (!this.petBtnEl || !this.shadow) return;
    this.todayEaten += count;
    if (this.counterEl) this.counterEl.textContent = String(this.todayEaten);
    if (this.statEatenEl) this.statEatenEl.textContent = String(this.todayEaten);

    this.playMood('eating');

    const wrap = this.shadow.querySelector('.wrap');
    if (wrap) {
      const bubble = document.createElement('div');
      bubble.className = 'pop-bubble';
      bubble.textContent = label ?? `嚼嚼 +${count}`;
      wrap.appendChild(bubble);
      window.setTimeout(() => bubble.remove(), 1150);
    }
  }

  triggerSpit(): void {
    this.playMood('spitting');
  }

  private playMood(mood: 'eating' | 'spitting'): void {
    if (!this.petBtnEl) return;
    if (this.animTimer !== null) {
      window.clearTimeout(this.animTimer);
    }
    this.petBtnEl.classList.remove('eating', 'spitting');
    // Force reflow so rapid consecutive feeds replay the animation cleanly.
    void this.petBtnEl.offsetWidth;
    this.petBtnEl.classList.add(mood);
    this.replaceSvg(mood);

    this.animTimer = window.setTimeout(() => {
      this.petBtnEl?.classList.remove('eating', 'spitting');
      this.replaceSvg('idle');
      this.animTimer = null;
    }, 600);
  }

  private replaceSvg(mood: 'idle' | 'eating' | 'spitting'): void {
    if (!this.petBtnEl) return;
    const oldSvg = this.petBtnEl.querySelector('svg');
    if (oldSvg) {
      oldSvg.outerHTML = renderPetSvg(mood);
    }
  }

  destroy(): void {
    if (this.animTimer !== null) {
      window.clearTimeout(this.animTimer);
    }
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }
}
