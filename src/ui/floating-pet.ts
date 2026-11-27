import { DEFAULT_FILTER_CONFIG, type FilterConfig } from '@/types/item';
import type {
  ExportDataResponse,
  ImportDataResponse,
  PetDataBackup,
  PetStatus,
  SyncNowResponse,
} from '@/types/messages';
import {
  DEFAULT_PET_SKIN_ID,
  PET_SKINS,
  getPetSkin,
  type PetMood,
  type PetSkin,
  type PetSkinId,
} from '@/ui/pet-skins';

export interface FloatingPetOptions {
  onConfigPatch: (patch: Partial<FilterConfig>, rescan?: boolean) => void;
  onSkinChange: (skinId: PetSkinId) => void;
  onSyncNativeDislikeChange: (enabled: boolean) => void;
  onAddRule: (kind: 'keyword' | 'author_block', value: string) => Promise<void>;
  onRemoveRule: (id: number) => Promise<void>;
  onRemoveVector: (id: string) => Promise<void>;
  onRequestRefreshStatus: () => void;
  onExportData: () => Promise<ExportDataResponse>;
  onImportData: (data: PetDataBackup) => Promise<ImportDataResponse>;
  onSyncNow: () => Promise<SyncNowResponse>;
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
    width: 318px;
    max-height: min(76vh, 620px);
    overflow-y: auto;
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

  .skin-picker {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .skin-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(30, 41, 59, 0.65);
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease, transform 120ms ease;
  }

  .skin-btn:hover {
    border-color: rgba(250, 204, 21, 0.55);
    background: rgba(30, 41, 59, 0.95);
  }

  .skin-btn.active {
    border-color: #facc15;
    background: rgba(250, 204, 21, 0.14);
    color: #fef08a;
  }

  .skin-thumb {
    width: 26px;
    height: 26px;
    flex-shrink: 0;
  }

  .backup-row {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .backup-btn {
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    background: rgba(30, 41, 59, 0.72);
    color: #e2e8f0;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease;
  }

  .backup-btn:hover {
    border-color: rgba(56, 189, 248, 0.65);
    background: rgba(30, 41, 59, 0.96);
  }

  .backup-msg {
    font-size: 11px;
    color: #34d399;
    margin-top: 5px;
    min-height: 15px;
  }

  .backup-msg.error {
    color: #fb7185;
  }

  .rule-form {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }

  .rule-input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.85);
    color: #f1f5f9;
    font-size: 11px;
    outline: none;
  }

  .rule-input:focus {
    border-color: #38bdf8;
  }

  .rule-add-btn {
    padding: 5px 10px;
    border-radius: 8px;
    border: 1px solid rgba(56, 189, 248, 0.45);
    background: rgba(56, 189, 248, 0.16);
    color: #bae6fd;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  .rule-add-btn:hover {
    background: rgba(56, 189, 248, 0.28);
  }

  .rule-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(251, 146, 60, 0.14);
    border: 1px solid rgba(251, 146, 60, 0.32);
    color: #fdba74;
  }

  .pos-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(52, 211, 153, 0.14);
    border: 1px solid rgba(52, 211, 153, 0.32);
    color: #6ee7b7;
    max-width: 100%;
  }

  .pos-chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rule-del {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0 2px;
    font-size: 12px;
    line-height: 1;
    opacity: 0.8;
  }

  .rule-del:hover {
    opacity: 1;
    color: #fff;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: rgba(30, 41, 59, 0.6);
    border-radius: 10px;
    padding: 7px 10px;
    font-size: 11px;
    color: #cbd5e1;
    cursor: pointer;
  }

  .toggle-row input[type="checkbox"] {
    accent-color: #38bdf8;
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  /* Floating Pet Button (Orb or Free-standing Mascot) */
  .pet-btn {
    position: relative;
    width: 58px;
    height: 58px;
    border-radius: 50%;
    border: 1.5px solid var(--orb-border, rgba(56, 189, 248, 0.45));
    background: var(--orb-bg, radial-gradient(circle at 30% 25%, #1e293b, #0f172a 75%));
    box-shadow: var(--orb-shadow, 0 10px 26px rgba(2, 6, 23, 0.5));
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    user-select: none;
    touch-action: none;
    transition: transform 160ms ease, border-color 160ms ease, background 200ms ease;
    animation: petFloat 3.4s ease-in-out infinite;
  }

  .pet-btn.dragging {
    cursor: grabbing;
    animation: none;
  }

  .pet-btn:hover {
    transform: scale(1.07);
    border-color: var(--orb-hover-border, rgba(125, 211, 252, 0.85));
  }

  .pet-btn.layout-mascot {
    width: 96px;
    height: 100px;
    border-radius: 0;
    border: none;
    background: transparent;
    box-shadow: none;
    overflow: visible;
    animation: mascotIdle 3.2s ease-in-out infinite;
    filter: drop-shadow(0 6px 10px rgba(15, 23, 42, 0.35));
  }

  .pet-btn.layout-mascot:hover {
    transform: translateY(-3px) scale(1.06);
  }

  .pet-btn.eating {
    animation: petChomp 520ms cubic-bezier(0.34, 1.56, 0.64, 1);
    border-color: var(--orb-eat-border, #38bdf8);
  }

  .pet-btn.layout-mascot.eating {
    animation: mascotHop 560ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .pet-btn.spitting {
    animation: petSpit 420ms ease-in-out;
    border-color: #fbbf24;
  }

  @keyframes petFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  @keyframes mascotIdle {
    0%, 100% { transform: translateY(0) scale(1, 1); }
    50% { transform: translateY(-3px) scale(1.02, 0.985); }
  }

  @keyframes mascotHop {
    0% { transform: translateY(0) scale(1, 1); }
    24% { transform: translateY(3px) scale(1.12, 0.88); }
    52% { transform: translateY(-14px) scale(0.95, 1.08); }
    78% { transform: translateY(1px) scale(1.05, 0.96); }
    100% { transform: translateY(0) scale(1, 1); }
  }

  @keyframes pikaTailWag {
    0%, 100% { transform: rotate(0deg); }
    35% { transform: rotate(9deg); }
    70% { transform: rotate(-6deg); }
  }

  @keyframes pikaEarTwitch {
    0%, 86%, 100% { transform: rotate(0deg); }
    91% { transform: rotate(-7deg); }
    95% { transform: rotate(4deg); }
  }

  .pika-tail {
    transform-origin: 70px 86px;
    animation: pikaTailWag 2.1s ease-in-out infinite;
  }

  .pika-ear-l {
    transform-origin: 34px 33px;
    animation: pikaEarTwitch 5.2s ease-in-out infinite;
  }

  .pika-ear-r {
    transform-origin: 62px 33px;
    animation: pikaEarTwitch 5.2s ease-in-out 0.35s infinite;
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

  .pet-visual {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .pet-sprite,
  .pet-svg {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
  }

  .mood-fx {
    position: absolute;
    font-size: 18px;
    line-height: 1;
    pointer-events: none;
    animation: fxPop 550ms ease-out forwards;
  }

  .mood-fx-spark {
    top: 4px;
    left: -4px;
  }

  .mood-fx-sweat {
    top: 6px;
    right: 6px;
  }

  @keyframes fxPop {
    0% { opacity: 0; transform: scale(0.5) translateY(4px); }
    35% { opacity: 1; transform: scale(1.2) translateY(-3px); }
    100% { opacity: 0; transform: scale(0.95) translateY(-10px); }
  }

  .pet-face {
    width: 36px;
    height: 36px;
    pointer-events: none;
  }

  .pet-btn.layout-mascot .pet-face {
    width: 96px;
    height: 98px;
  }

  .counter-pill {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--counter-bg, #0284c7);
    color: var(--counter-color, #fff);
    font-size: 11px;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  }

  .pet-btn.layout-mascot .counter-pill {
    top: 2px;
    right: 4px;
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

  .pet-btn.layout-mascot .status-dot {
    bottom: 6px;
    left: 10px;
  }

  .status-dot.degraded {
    background: #fbbf24;
  }

  .pop-bubble {
    position: absolute;
    bottom: 102px;
    right: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--bubble-bg, rgba(14, 165, 233, 0.95));
    color: var(--bubble-color, #082f49);
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

/**
 * Lightweight Shadow DOM companion pet with swallow/spit micro-animations, skin switcher, and stats drawer.
 */
export class FloatingPetController {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private wrapEl: HTMLDivElement | null = null;
  private drawerEl: HTMLDivElement | null = null;
  private drawerTitleEl: HTMLSpanElement | null = null;
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
  private alphaInput: HTMLInputElement | null = null;
  private alphaValEl: HTMLSpanElement | null = null;
  private posMinSimInput: HTMLInputElement | null = null;
  private posMinSimValEl: HTMLSpanElement | null = null;
  private skinPickerEl: HTMLDivElement | null = null;
  private rulesListEl: HTMLDivElement | null = null;
  private posSectionEl: HTMLDivElement | null = null;
  private posListEl: HTMLDivElement | null = null;
  private ruleInputEl: HTMLInputElement | null = null;
  private syncDislikeInput: HTMLInputElement | null = null;
  private hideAdsInput: HTMLInputElement | null = null;
  private hideFloorInput: HTMLInputElement | null = null;
  private signalFusionInput: HTMLInputElement | null = null;
  private debugModeInput: HTMLInputElement | null = null;
  private backupMsgEl: HTMLDivElement | null = null;
  private importInputEl: HTMLInputElement | null = null;

  private activeSkin: PetSkin = getPetSkin(DEFAULT_PET_SKIN_ID);
  private currentMood: PetMood = 'idle';
  private isOpen = false;
  private todayEaten = 0;
  private animTimer: number | null = null;
  private suppressNextClick = false;

  constructor(private readonly options: FloatingPetOptions) {}

  mount(): void {
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLES;

    const skinButtonsHtml = PET_SKINS.map(
      (skin) => `
        <button type="button" class="skin-btn ${skin.id === this.activeSkin.id ? 'active' : ''}" data-skin="${skin.id}">
          ${skin.renderVisual('idle', 'skin-thumb')}
          <span>${skin.name}</span>
        </button>`,
    ).join('');

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="drawer" role="dialog" aria-label="宠物过滤面板">
        <div class="drawer-header">
          <span class="drawer-title" data-role="title">${this.activeSkin.badgeIcon} 注意力守护宠物</span>
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
          <div class="section-title"><span>宠物形象</span></div>
          <div class="skin-picker" data-role="skin-picker">
            ${skinButtonsHtml}
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

          <div class="section-title" style="margin-top:8px;margin-bottom:4px">
            <span>白库排斥系数 α（越小保护越柔和）</span>
            <span data-role="alpha-val" style="color:#34d399;font-family:monospace">${DEFAULT_FILTER_CONFIG.positiveAlpha.toFixed(2)}</span>
          </div>
          <input type="range" min="0" max="0.50" step="0.01" value="${DEFAULT_FILTER_CONFIG.positiveAlpha}" data-role="alpha" />

          <div class="section-title" style="margin-top:8px;margin-bottom:4px">
            <span>白库触发门槛（高于此相似度才保护）</span>
            <span data-role="pos-min-val" style="color:#34d399;font-family:monospace">${DEFAULT_FILTER_CONFIG.positiveMinSim.toFixed(2)}</span>
          </div>
          <input type="range" min="0.50" max="0.95" step="0.01" value="${DEFAULT_FILTER_CONFIG.positiveMinSim}" data-role="pos-min" />
        </div>

        <label class="toggle-row">
          <span>投喂时同步点 B 站「不感兴趣」</span>
          <input type="checkbox" ${DEFAULT_FILTER_CONFIG.syncNativeDislike ? 'checked' : ''} data-role="sync-dislike" />
        </label>

        <label class="toggle-row">
          <span>🛡️ 直接吃掉并隐藏「广告」卡片</span>
          <input type="checkbox" ${DEFAULT_FILTER_CONFIG.hideAds ? 'checked' : ''} data-role="hide-ads" />
        </label>

        <label class="toggle-row">
          <span>📺 隐藏直播 / 番剧 / 漫画等非视频推广</span>
          <input type="checkbox" ${DEFAULT_FILTER_CONFIG.hideFloorCards ? 'checked' : ''} data-role="hide-floor" />
        </label>

        <label class="toggle-row">
          <span>📊 外显参数融合（点赞率/弹幕/时长/已关注）</span>
          <input type="checkbox" ${DEFAULT_FILTER_CONFIG.enableSignalFusion ? 'checked' : ''} data-role="signal-fusion" />
        </label>

        <label class="toggle-row">
          <span>🔍 调试模式（卡片左上角显示打分）</span>
          <input type="checkbox" ${DEFAULT_FILTER_CONFIG.debugMode ? 'checked' : ''} data-role="debug-mode" />
        </label>

        <div>
          <div class="section-title"><span>关键词 / UP 主黑名单（L1 秒拦）</span></div>
          <form class="rule-form" data-role="rule-form">
            <input type="text" class="rule-input" placeholder="屏蔽词（逗号分隔，如 保姆级,王炸）" data-role="rule-input" />
            <button type="submit" class="rule-add-btn">添加</button>
          </form>
          <div class="cloud" data-role="rules-list">
            <span class="empty-hint">暂无自定义屏蔽词</span>
          </div>
        </div>

        <div data-role="pos-section" style="display:none">
          <div class="section-title"><span>白库纠偏保护（点 × 取消保护）</span></div>
          <div class="cloud" data-role="pos-list"></div>
        </div>

        <div>
          <div class="section-title"><span>云同步与备份</span></div>
          <div class="backup-row" style="margin-bottom:6px">
            <button type="button" class="backup-btn" data-role="sync-now-btn" style="grid-column:span 2;border-color:rgba(56,189,248,0.45);color:#bae6fd">☁️ 立即云同步（Chrome 账号自动漫游）</button>
          </div>
          <div class="backup-row">
            <button type="button" class="backup-btn" data-role="export-btn">导出 JSON</button>
            <button type="button" class="backup-btn" data-role="import-btn">导入 JSON</button>
          </div>
          <input type="file" accept="application/json,.json" data-role="import-file" style="display:none" />
          <div class="backup-msg" data-role="backup-msg"></div>
        </div>
      </div>

      <button type="button" class="pet-btn" title="点击展开面板，按住可拖动桌宠">
        ${this.activeSkin.renderVisual('idle')}
        <span class="counter-pill" data-role="counter">0</span>
        <span class="status-dot degraded" data-role="dot"></span>
      </button>
    `;

    shadow.append(style, wrap);
    document.body.appendChild(host);

    this.host = host;
    this.shadow = shadow;
    this.wrapEl = wrap;
    this.drawerEl = shadow.querySelector('.drawer');
    this.drawerTitleEl = shadow.querySelector('[data-role="title"]');
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
    this.alphaInput = shadow.querySelector('[data-role="alpha"]');
    this.alphaValEl = shadow.querySelector('[data-role="alpha-val"]');
    this.posMinSimInput = shadow.querySelector('[data-role="pos-min"]');
    this.posMinSimValEl = shadow.querySelector('[data-role="pos-min-val"]');
    this.skinPickerEl = shadow.querySelector('[data-role="skin-picker"]');
    this.rulesListEl = shadow.querySelector('[data-role="rules-list"]');
    this.posSectionEl = shadow.querySelector('[data-role="pos-section"]');
    this.posListEl = shadow.querySelector('[data-role="pos-list"]');
    this.ruleInputEl = shadow.querySelector('[data-role="rule-input"]');
    this.syncDislikeInput = shadow.querySelector('[data-role="sync-dislike"]');
    this.hideAdsInput = shadow.querySelector('[data-role="hide-ads"]');
    this.hideFloorInput = shadow.querySelector('[data-role="hide-floor"]');
    this.signalFusionInput = shadow.querySelector('[data-role="signal-fusion"]');
    this.debugModeInput = shadow.querySelector('[data-role="debug-mode"]');
    this.backupMsgEl = shadow.querySelector('[data-role="backup-msg"]');
    this.importInputEl = shadow.querySelector('[data-role="import-file"]');

    this.applySkin(this.activeSkin.id);
    this.setupDrag();

    const ruleForm = shadow.querySelector<HTMLFormElement>('[data-role="rule-form"]');
    ruleForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = this.ruleInputEl?.value.trim() ?? '';
      if (!val) return;
      if (this.ruleInputEl) this.ruleInputEl.value = '';
      void this.options.onAddRule('keyword', val);
    });

    this.rulesListEl?.addEventListener('click', (event) => {
      const delBtn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-del-rule]');
      const id = Number(delBtn?.dataset.delRule);
      if (!Number.isFinite(id)) return;
      void this.options.onRemoveRule(id);
    });

    this.posListEl?.addEventListener('click', (event) => {
      const delBtn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-del-vec]');
      const id = delBtn?.dataset.delVec;
      if (!id) return;
      void this.options.onRemoveVector(id);
    });

    this.syncDislikeInput?.addEventListener('change', () => {
      if (!this.syncDislikeInput) return;
      this.options.onSyncNativeDislikeChange(this.syncDislikeInput.checked);
    });

    this.hideAdsInput?.addEventListener('change', () => {
      if (!this.hideAdsInput) return;
      this.options.onConfigPatch({ hideAds: this.hideAdsInput.checked }, true);
    });

    this.hideFloorInput?.addEventListener('change', () => {
      if (!this.hideFloorInput) return;
      this.options.onConfigPatch({ hideFloorCards: this.hideFloorInput.checked }, true);
    });

    this.signalFusionInput?.addEventListener('change', () => {
      if (!this.signalFusionInput) return;
      this.options.onConfigPatch({ enableSignalFusion: this.signalFusionInput.checked }, true);
    });

    this.debugModeInput?.addEventListener('change', () => {
      if (!this.debugModeInput) return;
      this.options.onConfigPatch({ debugMode: this.debugModeInput.checked }, true);
    });

    this.petBtnEl?.addEventListener('click', () => {
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        return;
      }
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
      this.options.onConfigPatch({ l2Threshold: val }, true);
    });

    this.alphaInput?.addEventListener('input', () => {
      if (!this.alphaInput || !this.alphaValEl) return;
      const val = Number(this.alphaInput.value);
      this.alphaValEl.textContent = val.toFixed(2);
      this.options.onConfigPatch({ positiveAlpha: val }, true);
    });

    this.posMinSimInput?.addEventListener('input', () => {
      if (!this.posMinSimInput || !this.posMinSimValEl) return;
      const val = Number(this.posMinSimInput.value);
      this.posMinSimValEl.textContent = val.toFixed(2);
      this.options.onConfigPatch({ positiveMinSim: val }, true);
    });

    this.skinPickerEl?.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-skin]');
      const skinId = btn?.dataset.skin as PetSkinId | undefined;
      if (!skinId || skinId === this.activeSkin.id) return;
      this.applySkin(skinId);
      this.options.onSkinChange(skinId);
    });

    const syncNowBtn = shadow.querySelector<HTMLButtonElement>('[data-role="sync-now-btn"]');
    const exportBtn = shadow.querySelector<HTMLButtonElement>('[data-role="export-btn"]');
    const importBtn = shadow.querySelector<HTMLButtonElement>('[data-role="import-btn"]');

    syncNowBtn?.addEventListener('click', () => {
      void this.handleSyncNow();
    });

    exportBtn?.addEventListener('click', () => {
      void this.handleExport();
    });

    importBtn?.addEventListener('click', () => {
      this.importInputEl?.click();
    });

    this.importInputEl?.addEventListener('change', () => {
      const file = this.importInputEl?.files?.[0];
      if (!file) return;
      void this.handleImport(file).finally(() => {
        if (this.importInputEl) this.importInputEl.value = '';
      });
    });
  }

  private setupDrag(): void {
    const btn = this.petBtnEl;
    const host = this.host;
    if (!btn || !host) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startRight = 24;
    let startBottom = 24;
    let dragged = false;

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      const rect = host.getBoundingClientRect();
      startRight = Math.max(8, window.innerWidth - rect.right);
      startBottom = Math.max(8, window.innerHeight - rect.bottom);
      dragged = false;
      btn.setPointerCapture(pointerId);
    });

    btn.addEventListener('pointermove', (e) => {
      if (pointerId !== e.pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) > 5) {
        dragged = true;
        btn.classList.add('dragging');
      }
      if (!dragged) return;
      const maxRight = Math.max(8, window.innerWidth - 110);
      const maxBottom = Math.max(8, window.innerHeight - 110);
      const nextRight = Math.min(maxRight, Math.max(8, startRight - dx));
      const nextBottom = Math.min(maxBottom, Math.max(8, startBottom - dy));
      host.style.right = `${Math.round(nextRight)}px`;
      host.style.bottom = `${Math.round(nextBottom)}px`;
    });

    const finishDrag = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      if (btn.hasPointerCapture(pointerId)) {
        btn.releasePointerCapture(pointerId);
      }
      pointerId = null;
      btn.classList.remove('dragging');
      if (dragged) {
        this.suppressNextClick = true;
      }
    };

    btn.addEventListener('pointerup', finishDrag);
    btn.addEventListener('pointercancel', finishDrag);
  }

  private setBackupMessage(text: string, isError = false): void {
    if (!this.backupMsgEl) return;
    this.backupMsgEl.textContent = text;
    this.backupMsgEl.classList.toggle('error', isError);
  }

  private async handleSyncNow(): Promise<void> {
    this.setBackupMessage('正在同步到 Chrome 账号…');
    try {
      const res = await this.options.onSyncNow();
      if (!res?.ok) {
        this.setBackupMessage(res?.error ?? '云同步失败，请检查 Chrome 登录状态', true);
        return;
      }
      const pullText = res.pulledVectors > 0 ? `，拉取 ${res.pulledVectors} 条` : '';
      this.setBackupMessage(`☁️ 已同步 ${res.syncedVectors} 条样本至 Chrome 账号${pullText}`);
      this.options.onRequestRefreshStatus();
    } catch {
      this.setBackupMessage('云同步失败，请稍后重试', true);
    }
  }

  private async handleExport(): Promise<void> {
    try {
      const res = await this.options.onExportData();
      if (!res?.ok || !res.data) {
        this.setBackupMessage('导出失败，请稍后重试', true);
        return;
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attention-filter-pet-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.setBackupMessage(`已导出 ${res.data.vectors.length} 条样本`);
    } catch {
      this.setBackupMessage('导出失败，请检查权限', true);
    }
  }

  private async handleImport(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PetDataBackup;
      const res = await this.options.onImportData(parsed);
      if (!res?.ok) {
        this.setBackupMessage(res?.error ?? '导入失败：文件格式无效', true);
        return;
      }
      this.setBackupMessage(
        `已导入 ${res.importedVectors} 条样本、${res.importedRules} 条规则`,
      );
      this.options.onRequestRefreshStatus();
    } catch {
      this.setBackupMessage('导入失败：无法解析 JSON 文件', true);
    }
  }

  applySkin(skinId?: PetSkinId): void {
    const skin = getPetSkin(skinId);
    this.activeSkin = skin;

    if (this.wrapEl) {
      this.wrapEl.style.setProperty('--orb-bg', skin.theme.orbBackground);
      this.wrapEl.style.setProperty('--orb-border', skin.theme.orbBorder);
      this.wrapEl.style.setProperty('--orb-hover-border', skin.theme.orbHoverBorder);
      this.wrapEl.style.setProperty('--orb-eat-border', skin.theme.orbEatBorder);
      this.wrapEl.style.setProperty('--orb-shadow', skin.theme.orbShadow);
      this.wrapEl.style.setProperty('--counter-bg', skin.theme.counterBg);
      this.wrapEl.style.setProperty('--counter-color', skin.theme.counterColor);
      this.wrapEl.style.setProperty('--bubble-bg', skin.theme.bubbleBg);
      this.wrapEl.style.setProperty('--bubble-color', skin.theme.bubbleColor);
    }

    if (this.petBtnEl) {
      this.petBtnEl.classList.toggle('layout-mascot', skin.layout === 'mascot');
      for (const s of PET_SKINS) {
        this.petBtnEl.classList.toggle(`skin-${s.id}`, s.id === skin.id);
      }
    }

    if (this.drawerTitleEl) {
      this.drawerTitleEl.textContent = `${skin.badgeIcon} 注意力守护宠物`;
    }

    if (this.skinPickerEl) {
      const buttons = this.skinPickerEl.querySelectorAll<HTMLButtonElement>('[data-skin]');
      for (const btn of buttons) {
        btn.classList.toggle('active', btn.dataset.skin === skin.id);
      }
    }

    this.replaceSvg(this.currentMood);
  }

  syncStatus(status: PetStatus): void {
    if (!status || typeof status.todayEaten !== 'number' || !status.config) {
      this.setDegraded(true);
      return;
    }
    this.todayEaten = status.todayEaten;
    if (this.counterEl) this.counterEl.textContent = String(status.todayEaten);
    if (this.statEatenEl) this.statEatenEl.textContent = String(status.todayEaten);
    if (this.statNegEl) this.statNegEl.textContent = String(status.negativeCount ?? 0);
    if (this.statPosEl) this.statPosEl.textContent = String(status.positiveCount ?? 0);

    this.setDegraded(!status.modelReady, status.backend, status.modelLoading);

    if (this.thresholdInput && this.thresholdValEl) {
      this.thresholdInput.value = String(status.config.l2Threshold);
      this.thresholdValEl.textContent = status.config.l2Threshold.toFixed(2);
    }

    if (this.alphaInput && this.alphaValEl) {
      const alpha = status.config.positiveAlpha ?? DEFAULT_FILTER_CONFIG.positiveAlpha;
      this.alphaInput.value = String(alpha);
      this.alphaValEl.textContent = alpha.toFixed(2);
    }

    if (this.posMinSimInput && this.posMinSimValEl) {
      const minSim = status.config.positiveMinSim ?? DEFAULT_FILTER_CONFIG.positiveMinSim;
      this.posMinSimInput.value = String(minSim);
      this.posMinSimValEl.textContent = minSim.toFixed(2);
    }

    if (status.config.petSkin && status.config.petSkin !== this.activeSkin.id) {
      this.applySkin(status.config.petSkin);
    }

    if (this.syncDislikeInput) {
      this.syncDislikeInput.checked =
        status.config.syncNativeDislike ?? DEFAULT_FILTER_CONFIG.syncNativeDislike;
    }

    if (this.hideAdsInput) {
      this.hideAdsInput.checked = status.config.hideAds ?? DEFAULT_FILTER_CONFIG.hideAds;
    }

    if (this.hideFloorInput) {
      this.hideFloorInput.checked =
        status.config.hideFloorCards ?? DEFAULT_FILTER_CONFIG.hideFloorCards;
    }

    if (this.signalFusionInput) {
      this.signalFusionInput.checked =
        status.config.enableSignalFusion ?? DEFAULT_FILTER_CONFIG.enableSignalFusion;
    }

    if (this.debugModeInput) {
      this.debugModeInput.checked =
        status.config.debugMode ?? DEFAULT_FILTER_CONFIG.debugMode;
    }

    if (this.rulesListEl) {
      this.rulesListEl.replaceChildren();
      const rules = status.rules ?? [];
      if (rules.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'empty-hint';
        empty.textContent = '暂无自定义屏蔽词';
        this.rulesListEl.appendChild(empty);
      } else {
        for (const r of rules) {
          const chip = document.createElement('span');
          chip.className = 'rule-chip';
          const prefix = r.kind === 'author_block' ? '👤 UP:' : '🚫 ';
          const text = document.createElement('span');
          text.textContent = `${prefix}${r.value}`;
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'rule-del';
          del.dataset.delRule = String(r.id);
          del.title = '移除规则';
          del.textContent = '×';
          chip.append(text, del);
          this.rulesListEl.appendChild(chip);
        }
      }
    }

    if (this.posSectionEl && this.posListEl) {
      const pos = status.positiveAnchors ?? [];
      this.posSectionEl.style.display = pos.length > 0 ? '' : 'none';
      this.posListEl.replaceChildren();
      for (const anchor of pos) {
        const chip = document.createElement('span');
        chip.className = 'pos-chip';
        const text = document.createElement('span');
        text.textContent = `🛡 ${anchor.title}`;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'rule-del';
        del.dataset.delVec = anchor.id;
        del.title = '移除该白库保护';
        del.textContent = '×';
        chip.append(text, del);
        this.posListEl.appendChild(chip);
      }
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
      bubble.textContent = label ?? `${this.activeSkin.eatPrefix} +${count}`;
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
    this.currentMood = mood;
    this.petBtnEl.classList.remove('eating', 'spitting');
    // Force reflow so rapid consecutive feeds replay the animation cleanly.
    void this.petBtnEl.offsetWidth;
    this.petBtnEl.classList.add(mood);
    this.replaceSvg(mood);

    this.animTimer = window.setTimeout(() => {
      this.currentMood = 'idle';
      this.petBtnEl?.classList.remove('eating', 'spitting');
      this.replaceSvg('idle');
      this.animTimer = null;
    }, 600);
  }

  private replaceSvg(mood: PetMood): void {
    if (!this.petBtnEl) return;
    const oldVisual = this.petBtnEl.querySelector('.pet-visual');
    if (oldVisual) {
      oldVisual.outerHTML = this.activeSkin.renderVisual(mood);
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
