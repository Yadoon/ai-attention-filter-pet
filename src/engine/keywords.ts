import type { KeywordCount } from '@/types/messages';

const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '什么', '怎么', '为什么', '真的', '还是', '可以', '这个',
  '视频', '合集', '最新', '今天', '大家', '知道', '如何', '其实', '竟然', '居然',
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'about',
]);

/**
 * Lightweight zero-dependency tokenizer for building the local "eaten junk" word cloud.
 * Uses Intl.Segmenter('zh-CN') when available and falls back to regex chunks.
 */
function tokenize(text: string): string[] {
  const cleaned = text.replace(/[|【】\[\]()（）《》「」『』.,!?;:，。！？；：、#@~—…\-"']/g, ' ');
  const tokens: string[] = [];

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    for (const seg of segmenter.segment(cleaned)) {
      if (!seg.isWordLike) continue;
      const word = seg.segment.trim().toLowerCase();
      if (word.length >= 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)) {
        tokens.push(word);
      }
    }
    return tokens;
  }

  const matches = cleaned.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,}/g) ?? [];
  for (const raw of matches) {
    const word = raw.toLowerCase();
    if (!STOP_WORDS.has(word)) tokens.push(word);
  }
  return tokens;
}

export function extractTopKeywords(texts: string[], limit = 12): KeywordCount[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    // Deduplicate tokens per item so one repetitive title doesn't dominate the cloud.
    const unique = new Set(tokenize(text));
    for (const word of unique) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}
