import type { FilterDecision, NormalizedItem } from '@/types/item';

const INSPECTOR_HOST_ID = 'afp-decision-inspector-host';

const STYLES = `
  :host {
    all: initial;
    position: fixed;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #f1f5f9;
  }

  * {
    box-sizing: border-box;
  }

  .card {
    width: 340px;
    max-width: calc(100vw - 24px);
    border-radius: 14px;
    background: rgba(15, 23, 42, 0.97);
    border: 1px solid rgba(148, 163, 184, 0.28);
    box-shadow: 0 20px 48px rgba(2, 6, 23, 0.65);
    backdrop-filter: blur(16px);
    padding: 13px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: popIn 130ms ease-out;
  }

  @keyframes popIn {
    from { opacity: 0; transform: translateY(4px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .title-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
    color: #f8fafc;
  }

  .verdict {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
  }

  .verdict.blocked {
    background: rgba(239, 68, 68, 0.18);
    border: 1px solid rgba(248, 113, 113, 0.5);
    color: #fca5a5;
  }

  .verdict.passed {
    background: rgba(52, 211, 153, 0.16);
    border: 1px solid rgba(52, 211, 153, 0.45);
    color: #6ee7b7;
  }

  .close-btn {
    border: none;
    background: transparent;
    color: #94a3b8;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 4px;
  }

  .close-btn:hover {
    color: #fff;
  }

  .video-meta {
    font-size: 11px;
    color: #cbd5e1;
    background: rgba(30, 41, 59, 0.72);
    border-radius: 8px;
    padding: 7px 9px;
    line-height: 1.45;
  }

  .video-title {
    font-weight: 600;
    color: #f1f5f9;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .video-sub {
    margin-top: 3px;
    color: #94a3b8;
    font-size: 10px;
  }

  .step {
    background: rgba(30, 41, 59, 0.55);
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 9px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .step-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 600;
    color: #cbd5e1;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .bar-track {
    width: 100%;
    height: 5px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.8);
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    border-radius: 999px;
  }

  .bar-neg { background: linear-gradient(90deg, #f59e0b, #ef4444); }
  .bar-pos { background: linear-gradient(90deg, #10b981, #34d399); }

  .desc {
    font-size: 11px;
    color: #94a3b8;
    line-height: 1.4;
    word-break: break-word;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .chip {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(51, 65, 85, 0.85);
    color: #e2e8f0;
  }

  .chip.warn {
    background: rgba(244, 63, 94, 0.16);
    border: 1px solid rgba(244, 63, 94, 0.35);
    color: #fda4af;
  }

  .chip.good {
    background: rgba(16, 185, 129, 0.16);
    border: 1px solid rgba(16, 185, 129, 0.35);
    color: #6ee7b7;
  }

  .formula {
    border-radius: 9px;
    padding: 8px 10px;
    background: rgba(2, 6, 23, 0.72);
    border: 1px solid rgba(56, 189, 248, 0.25);
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .formula-eq {
    color: #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .formula-res.blocked { color: #fca5a5; font-weight: 700; }
  .formula-res.passed { color: #6ee7b7; font-weight: 700; }
`;

function formatCount(n?: number): string {
  if (typeof n !== 'number') return '未知';
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

function formatDuration(sec?: number): string {
  if (typeof sec !== 'number' || sec <= 0) return '未知';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let activeCleanup: (() => void) | null = null;

export function closeDecisionInspector(): void {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  document.getElementById(INSPECTOR_HOST_ID)?.remove();
}

/**
 * Show a human-readable 4-step AI decision breakdown card anchored near the clicked element.
 */
export function openDecisionInspector(
  anchorEl: HTMLElement,
  item: NormalizedItem,
  decision: FilterDecision,
): void {
  closeDecisionInspector();

  const host = document.createElement('div');
  host.id = INSPECTOR_HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;

  const d = decision.debug;
  const views = item.metrics?.views;
  const likes = item.metrics?.likes;
  const danmaku = item.metrics?.danmaku;
  const likeRateText =
    typeof views === 'number' && views > 0 && typeof likes === 'number'
      ? `${((likes / views) * 100).toFixed(1)}%`
      : '无接口点赞';

  const rawMetricChips = [
    `播放 ${formatCount(views)}`,
    `点赞 ${formatCount(likes)} (${likeRateText})`,
    `弹幕 ${formatCount(danmaku)}`,
    `时长 ${formatDuration(item.duration_sec)}`,
    item.is_followed ? '已关注 UP' : '未关注',
  ];

  const sigNotes = d?.signalNotes ?? [];
  const sigDelta = d?.signalDelta ?? 0;
  const negPct = d ? Math.min(100, Math.max(0, Math.round(d.maxNeg * 100))) : 0;
  const posPct = d ? Math.min(100, Math.max(0, Math.round(d.maxPos * 100))) : 0;
  const posPenalty = d && d.effectivePos > 0 ? Number((d.maxNeg + sigDelta - decision.score).toFixed(2)) : 0;

  const verdictLabel = decision.blocked
    ? '🔴 已吃掉'
    : decision.reason === '已关注UP主豁免'
      ? '🛡 已关注豁免'
      : '🟢 放行';

  const stepsHtml =
    decision.layer === 'L1'
      ? `
        <div class="step">
          <div class="step-head"><span>① L1 硬规则判定</span><span class="mono">${decision.blocked ? '命中拦截' : '白名单放行'}</span></div>
          <div class="desc">${escapeHtml(decision.reason ?? '命中关键词或 UP 主规则')}</div>
        </div>`
      : d
        ? `
        <div class="step">
          <div class="step-head">
            <span>① 语义对比（负样本库）</span>
            <span class="mono" style="color:#fda4af">${d.maxNeg.toFixed(3)}</span>
          </div>
          <div class="bar-track"><div class="bar-fill bar-neg" style="width:${negPct}%"></div></div>
          <div class="desc">${
            d.matchedNegTitle
              ? `最像历史投喂：《${escapeHtml(d.matchedNegTitle)}》`
              : '负样本库暂无可比样本'
          }</div>
        </div>

        <div class="step">
          <div class="step-head">
            <span>② 白库保护（正样本库）</span>
            <span class="mono" style="color:#6ee7b7">${
              d.effectivePos > 0 ? `-${posPenalty.toFixed(2)} (已生效)` : `${d.maxPos.toFixed(3)} (未达门槛)`
            }</span>
          </div>
          <div class="bar-track"><div class="bar-fill bar-pos" style="width:${posPct}%"></div></div>
          <div class="desc">${
            d.matchedPosTitle
              ? `最像白库：《${escapeHtml(d.matchedPosTitle)}》`
              : '尚未建立白库保护样本'
          }</div>
        </div>

        <div class="step">
          <div class="step-head">
            <span>③ 外显体检（接口 + DOM 信号）</span>
            <span class="mono" style="color:${sigDelta > 0 ? '#fda4af' : sigDelta < 0 ? '#6ee7b7' : '#94a3b8'}">${
              sigDelta > 0 ? `+${sigDelta.toFixed(2)}` : sigDelta.toFixed(2)
            }</span>
          </div>
          <div class="chips">
            ${rawMetricChips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('')}
          </div>
          <div class="chips">
            ${
              sigNotes.length > 0
                ? sigNotes
                    .map((n) => {
                      const cls = n.includes('+') ? 'warn' : 'good';
                      return `<span class="chip ${cls}">${escapeHtml(n)}</span>`;
                    })
                    .join('')
                : '<span class="desc">各项外显指标正常，无额外加减分</span>'
            }
          </div>
        </div>

        <div class="formula">
          <span class="formula-eq">${d.maxNeg.toFixed(2)} ${
            posPenalty > 0 ? `- ${posPenalty.toFixed(2)}` : '- 0.00'
          } ${sigDelta >= 0 ? `+ ${sigDelta.toFixed(2)}` : `- ${Math.abs(sigDelta).toFixed(2)}`} = ${decision.score.toFixed(2)}</span>
          <span class="formula-res ${decision.blocked ? 'blocked' : 'passed'}">${
            decision.blocked ? `> ${d.threshold.toFixed(2)} 拦截` : `≤ ${d.threshold.toFixed(2)} 放行`
          }</span>
        </div>`
        : `
        <div class="step">
          <div class="step-head"><span>判定详情</span><span class="mono">${decision.layer}</span></div>
          <div class="desc">${escapeHtml(decision.reason ?? '暂无详细评分数据')}</div>
        </div>`;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="header">
      <div class="title-wrap">
        <span>⚡ 皮卡丘决策账单</span>
        <span class="verdict ${decision.blocked ? 'blocked' : 'passed'}">${verdictLabel}</span>
      </div>
      <button type="button" class="close-btn" data-role="close" title="关闭">×</button>
    </div>

    <div class="video-meta">
      <div class="video-title">${escapeHtml(item.title)}</div>
      <div class="video-sub">UP主：${escapeHtml(item.author_name || '未知')} · ${escapeHtml(item.item_id)}</div>
    </div>

    ${stepsHtml}
  `;

  shadow.append(style, card);
  document.body.appendChild(host);

  // Position smartly near anchorEl while staying inside the viewport.
  const rect = anchorEl.getBoundingClientRect();
  const cardW = 340;
  const cardH = Math.min(460, card.offsetHeight || 380);
  const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - cardW - 12));
  const preferBelow = rect.bottom + 8 + cardH <= window.innerHeight - 12;
  const top = preferBelow
    ? rect.bottom + 8
    : Math.max(12, rect.top - cardH - 8);
  host.style.left = `${Math.round(left)}px`;
  host.style.top = `${Math.round(top)}px`;

  shadow.querySelector('[data-role="close"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeDecisionInspector();
  });

  const onDocClick = (e: MouseEvent) => {
    if (e.target === host || host.contains(e.target as Node)) return;
    closeDecisionInspector();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeDecisionInspector();
  };

  // Defer attaching outside-click listener so the opening click doesn't immediately close it.
  const timer = window.setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeyDown);
  }, 0);

  activeCleanup = () => {
    window.clearTimeout(timer);
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKeyDown);
  };
}
