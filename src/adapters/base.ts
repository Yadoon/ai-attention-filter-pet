import type { FilterDecision, NormalizedItem, Platform } from '@/types/item';

export interface CardBinding {
  element: HTMLElement;
  item: NormalizedItem;
}

export interface AdapterCallbacks {
  onFeed: (item: NormalizedItem, element: HTMLElement) => void;
  onSpit: (item: NormalizedItem, element: HTMLElement, matchedAnchorId?: string) => void;
}

/**
 * Common interface implemented by each platform adapter (Bilibili / Xiaohongshu / Douyin).
 */
export interface SiteAdapter {
  readonly platform: Platform;
  /** Scan current DOM and return newly discovered feed cards paired with normalized metadata. */
  scanCards(apiCache: Map<string, NormalizedItem>): CardBinding[];
  /** Inject lightweight Feed control without mounting a React root per card. */
  attachFeedButton(binding: CardBinding, callbacks: AdapterCallbacks): void;
  /** Apply platform-safe non-destructive mask/overlay when an item is blocked. */
  applyMask(
    binding: CardBinding,
    decision: FilterDecision,
    callbacks: AdapterCallbacks,
  ): void;
  /** Restore a previously masked card (e.g., on Spit or Undo). */
  restoreCard(element: HTMLElement): void;
}
