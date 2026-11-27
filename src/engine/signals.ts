import type { NormalizedItem } from '@/types/item';

export interface SignalContext {
  authorFeedCount: number;
  authorPositiveCount: number;
}

export interface SignalAdjustment {
  /** If true (e.g., followed creator), bypass L2 blocking completely. */
  bypass: boolean;
  /** Additive score delta clamped to [-0.16, +0.20]. Positive = more likely spam, negative = quality protection. */
  delta: number;
  /** Human-readable breakdown for Debug Mode tooltip. */
  notes: string[];
}

const MIN_DELTA = -0.16;
const MAX_DELTA = 0.2;

/**
 * Compute observable-signal score refinement from video metadata (like rate, danmaku rate,
 * duration, followed status, and per-author feed/whitelist history).
 */
export function computeSignalAdjustment(
  item: NormalizedItem,
  ctx: SignalContext,
): SignalAdjustment {
  if (item.is_followed) {
    return {
      bypass: true,
      delta: -0.3,
      notes: ['已关注UP主豁免'],
    };
  }

  let delta = 0;
  const notes: string[] = [];

  // 1. Per-author local history (strongest personal signal).
  if (ctx.authorFeedCount > 0) {
    const boost = Math.min(0.16, ctx.authorFeedCount * 0.08);
    delta += boost;
    notes.push(`同UP曾投喂${ctx.authorFeedCount}次(+${boost.toFixed(2)})`);
  }
  if (ctx.authorPositiveCount > 0) {
    delta -= 0.1;
    notes.push('白库UP保护(-0.10)');
  }

  // 2. Like rate (views >= 1000; available via homepage rcmd API).
  const views = item.metrics?.views;
  const likes = item.metrics?.likes;
  const danmaku = item.metrics?.danmaku;

  if (typeof views === 'number' && views > 0 && typeof likes === 'number') {
    const likeRate = likes / views;
    const pct = (likeRate * 100).toFixed(1);
    if (views >= 5000 && likeRate < 0.012) {
      delta += 0.06;
      notes.push(`低赞率${pct}%(+0.06)`);
    } else if (views >= 1000 && likeRate > 0.05) {
      delta -= 0.06;
      notes.push(`高赞保护${pct}%(-0.06)`);
    }
  }

  // 3. Danmaku engagement rate.
  if (typeof views === 'number' && views > 0 && typeof danmaku === 'number') {
    const dmRate = danmaku / views;
    if (views >= 3000 && (danmaku === 0 || dmRate < 0.0005)) {
      delta += 0.04;
      notes.push(danmaku === 0 ? '零弹幕(+0.04)' : '极低弹幕(+0.04)');
    } else if (views >= 1000 && dmRate > 0.004) {
      delta -= 0.04;
      notes.push('高弹幕保护(-0.04)');
    }
  }

  // 4. Duration heuristic (short clickbait clips vs deep long-form videos).
  if (typeof item.duration_sec === 'number' && item.duration_sec > 0) {
    if (item.duration_sec < 90) {
      delta += 0.03;
      notes.push('超短视频(+0.03)');
    } else if (item.duration_sec >= 900) {
      delta -= 0.04;
      notes.push('深度长视频(-0.04)');
    }
  }

  const clamped = Math.max(MIN_DELTA, Math.min(MAX_DELTA, delta));
  return {
    bypass: false,
    delta: Number(clamped.toFixed(3)),
    notes,
  };
}
