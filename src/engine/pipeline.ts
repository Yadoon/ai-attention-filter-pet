import type { FilterConfig, FilterDecision, NormalizedItem } from '@/types/item';
import { evaluateL1, type L1RuleSet } from './l1-rules';
import {
  buildEmbeddingText,
  scoreAgainstAnchors,
  type AnchorVector,
  type InferenceProvider,
} from './l2-vector';

export interface PipelineContext {
  rules: L1RuleSet;
  anchors: AnchorVector[];
  config: FilterConfig;
  provider: InferenceProvider | null;
}

export interface BatchEvaluationResult {
  decisions: FilterDecision[];
  degraded: boolean;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`L2 inference timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Evaluate a batch of feed items through L1 -> L2 with strict Fail-Open degradation.
 */
export async function evaluateBatch(
  items: NormalizedItem[],
  ctx: PipelineContext,
): Promise<BatchEvaluationResult> {
  const decisionMap = new Map<string, FilterDecision>();
  const pendingForL2: NormalizedItem[] = [];

  for (const item of items) {
    const { decision } = evaluateL1(item, ctx.rules);
    if (decision) {
      decisionMap.set(item.item_id, decision);
    } else {
      pendingForL2.push(item);
    }
  }

  let degraded = false;
  const hasNegativeAnchors = ctx.anchors.some((a) => a.polarity === 'negative');

  if (
    pendingForL2.length > 0 &&
    ctx.config.enableL2 &&
    hasNegativeAnchors &&
    ctx.provider?.isReady()
  ) {
    try {
      const texts = pendingForL2.map(buildEmbeddingText);
      const embeddings = await withTimeout(
        ctx.provider.embedTexts(texts),
        ctx.config.inferenceTimeoutMs,
      );
      for (let i = 0; i < pendingForL2.length; i++) {
        const item = pendingForL2[i];
        const decision = scoreAgainstAnchors(
          item.item_id,
          embeddings[i],
          ctx.anchors,
          ctx.config,
        );
        decisionMap.set(item.item_id, decision);
      }
    } catch {
      // Fail-Open: never block feed rendering when local inference fails or times out.
      degraded = true;
      for (const item of pendingForL2) {
        decisionMap.set(item.item_id, {
          item_id: item.item_id,
          blocked: false,
          layer: 'FAIL_OPEN',
          score: 0,
          reason: '本地推理降级放行',
        });
      }
    }
  } else {
    if (pendingForL2.length > 0 && ctx.config.enableL2 && !ctx.provider?.isReady()) {
      degraded = true;
    }
    for (const item of pendingForL2) {
      decisionMap.set(item.item_id, {
        item_id: item.item_id,
        blocked: false,
        layer: degraded ? 'FAIL_OPEN' : 'L1',
        score: 0,
      });
    }
  }

  return {
    decisions: items.map((item) => decisionMap.get(item.item_id)!),
    degraded,
  };
}
