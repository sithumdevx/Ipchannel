/**
 * Display-only helpers for channel metadata.
 *
 * Raw playlist titles are often cluttered with machine tags — `[Not 24/7]`,
 * `[1080p]`, `(HD)`, trailing `| 720p` — that make the UI look messy. These
 * helpers clean titles for *display only*: search and identity keep operating
 * on the original name so nothing is ever lost.
 */

/** Bracket tags such as `[Not 24/7]`, `[1080p]`, `[Backup Stream]`. */
const BRACKET_TAGS = /\[[^\]\n]{0,48}\]/g;

/** Parenthesised quality notes such as `(HD)`, `(1080p)`, `(Not 24/7)`. */
const PAREN_NOISE =
  /\((?=[^)]{0,32}(?:\b\d{3,4}[pi]\b|\b[48]k\b|\buhd\b|\bfhd\b|\bhd\b|\bsd\b|\bhq\b|24\s*\/\s*7|backup|low quality|high quality))[^)]{0,48}\)/gi;

/** Bare resolution / quality words left dangling after tag removal. */
const RES_WORDS =
  /\s*\b(?:1440p|1080p|1080i|720p|576p|480p|360p|2160p|[48]k|uhd|fhd|hq|hd|sd)\b/gi;

/** Leading/trailing separators that tags leave behind: `Name |`, `- Name`. */
const DANGLING_EDGES = /^[\s|\-–—:·]+|[\s|\-–—:·]+$/g;

/**
 * Strip messy playlist tags from a channel title for clean display.
 * Falls back to the original string when cleaning would empty it out.
 */
export function cleanChannelTitle(raw: string): string {
  if (!raw) return raw;

  const cleaned = raw
    .replace(BRACKET_TAGS, " ")
    .replace(PAREN_NOISE, " ")
    .replace(RES_WORDS, " ")
    .replace(DANGLING_EDGES, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || raw;
}

/** Deterministic 32-bit hash so derived stats stay stable per channel. */
function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Simulated-but-stable live viewer count for a channel.
 *
 * The baseline is derived from the channel id (so a channel always reads about
 * the same) and gently swings with `tick`, giving the badge an "active" feel
 * as it refreshes every few seconds.
 */
export function viewerCountFor(channelId: string, tick = 0): number {
  const seed = stableHash(channelId);
  const baseline = 320 + (seed % 4600); // 320 – 4,919 viewers
  const swing = (stableHash(`${channelId}:${tick}`) % 140) - 70;
  return Math.max(96, baseline + swing);
}

/** `1240` → `1.2k`, `12400` → `12.4k`, `1240000` → `1.2m`. */
export function formatViewers(count: number): string {
  if (count >= 1_000_000) return `${trimZero(count / 1_000_000)}m`;
  if (count >= 1_000) return `${trimZero(count / 1_000)}k`;
  return String(count);
}

function trimZero(value: number): string {
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/** Stable pseudo-rating between 3.6 and 4.9 for the 5-star display. */
export function ratingFor(channelId: string): number {
  return 3.6 + (stableHash(channelId) % 14) / 10;
}
