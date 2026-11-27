export interface SponsorSegment {
  UUID: string;
  category: string;
  actionType: string;
  segment: [number, number];
}

interface SponsorVideoEntry {
  videoID?: string;
  segments?: Array<{
    UUID?: string;
    category?: string;
    actionType?: string;
    segment?: number[];
  }>;
}

const BSBSB_API_BASE = 'https://bsbsb.top/api/skipSegments';
const CATEGORIES_PARAM = encodeURIComponent(
  JSON.stringify(['sponsor', 'selfpromo', 'exclusive_access']),
);
const CACHE_TTL_MS = 10 * 60 * 1000;

const prefixCache = new Map<string, { expiresAt: number; entries: SponsorVideoEntry[] }>();

/**
 * Compute K-anonymity SHA-256 hex prefix (default 4 chars = 65,536 buckets)
 * so the SponsorBlock server never sees which exact BV video the user is watching.
 */
export async function sha256Prefix(input: string, length = 4): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, length);
}

/**
 * Filter a raw prefix-bucket response down to valid segments matching `bvid`.
 */
export function extractMatchingSegments(
  entries: SponsorVideoEntry[],
  bvid: string,
): SponsorSegment[] {
  const out: SponsorSegment[] = [];
  for (const entry of entries) {
    if (entry?.videoID !== bvid || !Array.isArray(entry.segments)) continue;
    for (const seg of entry.segments) {
      if (
        !seg ||
        typeof seg.UUID !== 'string' ||
        typeof seg.category !== 'string' ||
        typeof seg.actionType !== 'string' ||
        !Array.isArray(seg.segment) ||
        seg.segment.length < 2
      ) {
        continue;
      }
      const start = Number(seg.segment[0]);
      const end = Number(seg.segment[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (seg.actionType === 'skip' && end - start < 1) continue;
      out.push({
        UUID: seg.UUID,
        category: seg.category,
        actionType: seg.actionType,
        segment: [start, end],
      });
    }
  }
  return out;
}

/**
 * Fetch crowdsourced Bilibili SponsorBlock segments for a single BV video.
 * Strictly Fail-Open: returns [] on timeout, 404, or network failure.
 */
export async function fetchSponsorSegments(
  bvid: string,
  timeoutMs = 2500,
): Promise<SponsorSegment[]> {
  if (!bvid || !bvid.startsWith('BV')) return [];
  try {
    const prefix = await sha256Prefix(bvid, 4);
    const now = Date.now();
    const cached = prefixCache.get(prefix);
    if (cached && cached.expiresAt > now) {
      return extractMatchingSegments(cached.entries, bvid);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${BSBSB_API_BASE}/${prefix}?categories=${CATEGORIES_PARAM}`;
      const res = await fetch(url, { signal: controller.signal });
      if (res.status === 404) {
        prefixCache.set(prefix, { expiresAt: now + CACHE_TTL_MS, entries: [] });
        return [];
      }
      if (!res.ok) return [];
      const entries = (await res.json()) as SponsorVideoEntry[];
      if (!Array.isArray(entries)) return [];
      prefixCache.set(prefix, { expiresAt: now + CACHE_TTL_MS, entries });
      return extractMatchingSegments(entries, bvid);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}
