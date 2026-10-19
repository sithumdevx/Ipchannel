#!/usr/bin/env node
/**
 * Generates `src/data/fallback-channels.ts` — the built-in channel catalogue.
 *
 * Why this exists
 * ---------------
 * `/api/channels` serves the live playlist when it can, but serverless
 * environments often cannot reach the upstream playlist inside their execution
 * budget (Vercel's default function timeout is ~10s). When that happens the app
 * must still show a *real* catalogue, not a handful of placeholder rows.
 *
 * This script pulls the configured playlist, probes every candidate stream and
 * keeps only the ones that actually answered — so the fallback is a large,
 * verified dataset rather than a guess.
 *
 * Usage:
 *   node scripts/generate-fallback-channels.mjs [--limit 150] [--candidates 450]
 *
 * The upstream source is `STREAM_SOURCES` (first entry) or, when unset, the
 * public iptv-org index.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "src", "data", "fallback-channels.ts");

const DEFAULT_SOURCE = "https://iptv-org.github.io/iptv/index.m3u";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? Number.parseInt(args[i + 1], 10) : fallback;
};

const LIMIT = argValue("--limit", 150);
const CANDIDATES = argValue("--candidates", 450);
const PROBE_TIMEOUT_MS = 5_000;
const CONCURRENCY = 14;

/** Prefer an explicit source, then `.env.local`, then the public index. */
function resolveSource() {
  if (process.env.STREAM_SOURCES) return process.env.STREAM_SOURCES.split(",")[0].trim();
  try {
    const env = readFileSync(join(ROOT, ".env.local"), "utf8");
    const match = env.match(/^\s*STREAM_SOURCES\s*=\s*(.+)$/m);
    if (match) return match[1].trim().split(",")[0].trim();
  } catch {
    /* no .env.local */
  }
  return DEFAULT_SOURCE;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

const CATEGORY_RULES = [
  [/news/i, "News"],
  [/sport/i, "Sports"],
  [/movie|cinema|film/i, "Movies"],
  [/music/i, "Music"],
  [/doc/i, "Documentary"],
  [/anim|cartoon|anime/i, "Animation"],
  [/kid|child/i, "Kids"],
  [/entertain/i, "Entertainment"],
  [/science|tech/i, "Science"],
  [/business|finance/i, "Business"],
  [/comedy/i, "Comedy"],
  [/cook|food/i, "Cooking"],
  [/travel|outdoor/i, "Travel"],
  [/religi/i, "Religious"],
  [/series|drama/i, "Series"],
  [/weather/i, "Weather"],
  [/culture/i, "Culture"],
  [/education/i, "Education"],
  [/lifestyle/i, "Lifestyle"],
  [/shop/i, "Shopping"],
];

function normalizeCategory(raw) {
  if (!raw || !raw.trim()) return "General";
  const primary = raw.trim().split(/[;,/]/)[0].trim();
  if (!primary) return "General";
  for (const [re, name] of CATEGORY_RULES) if (re.test(primary)) return name;
  return primary.charAt(0).toUpperCase() + primary.slice(1);
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "channel"
  );
}

/**
 * Ports the app's stream proxy (`src/lib/security/url-guard.ts`) will accept.
 * A fallback entry that the proxy refuses is useless whenever the browser cannot
 * play the origin directly (mixed content, CORS, referer checks), so such URLs
 * are dropped before probing.
 */
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

function isProxyableUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!ALLOWED_PORTS.has(parsed.port)) return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  // Never embed private/loopback addresses in the shipped catalogue.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19))
    ) {
      return false;
    }
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return true;
}

function parseM3U(content) {
  const out = [];
  let current = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const attr = (name) => {
        const m = line.match(new RegExp(`${name}="([^"]*)"`, "i"));
        return m ? m[1].trim() : "";
      };
      const comma = line.lastIndexOf(",");
      current = {
        tvgId: attr("tvg-id"),
        name: attr("tvg-name") || (comma !== -1 ? line.substring(comma + 1).trim() : ""),
        logo: attr("tvg-logo"),
        group: attr("group-title"),
        country: attr("tvg-country"),
        language: attr("tvg-language"),
      };
    } else if (line.startsWith("#")) {
      continue;
    } else if (/^https?:\/\//i.test(line)) {
      if (current) {
        out.push({ ...current, url: line });
        current = null;
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Probing                                                                     */
/* -------------------------------------------------------------------------- */

async function probe(url) {
  const attempt = async (method) => {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: {
          "User-Agent": USER_AGENT,
          ...(method === "GET" ? { Range: "bytes=0-1" } : {}),
        },
      });
      const status = res.status;
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return status;
    } catch {
      return 0;
    }
  };

  const head = await attempt("HEAD");
  if (head >= 200 && head < 300) return true;
  if (head === 404 || head === 410) return false;
  const get = await attempt("GET");
  return get >= 200 && get < 300;
}

async function pooled(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

const source = resolveSource();
console.log(`Fallback generator: source = ${source}`);

const response = await fetch(source, { headers: { "User-Agent": USER_AGENT } });
if (!response.ok) throw new Error(`Playlist fetch failed: ${response.status} ${response.statusText}`);
const text = await response.text();
const parsed = parseM3U(text);
console.log(`Parsed ${parsed.length} entries.`);

// De-duplicate by URL and by normalised name, and drop entries without a name.
const seenUrls = new Set();
const seenNames = new Set();
const unique = [];
for (const entry of parsed) {
  if (!entry.url || seenUrls.has(entry.url)) continue;
  if (!isProxyableUrl(entry.url)) continue;
  const key = (entry.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key || seenNames.has(key)) continue;
  seenUrls.add(entry.url);
  seenNames.add(key);
  unique.push(entry);
}
console.log(`${unique.length} unique candidates after de-duplication + URL sanity filter.`);

// Spread candidates across categories so one genre cannot dominate the sample.
const byCategory = new Map();
for (const entry of unique) {
  const category = normalizeCategory(entry.group);
  if (!byCategory.has(category)) byCategory.set(category, []);
  byCategory.get(category).push({ ...entry, category });
}

const categories = Array.from(byCategory.keys());

/**
 * How many candidates each category contributes in the *first* round.
 *
 * The app's home rails are News / Sports / Entertainment / Movies, so those
 * genres get a deeper slice — otherwise a flat round-robin would leave each of
 * the ~29 categories with an equal handful and the headline rails looking thin.
 */
const CATEGORY_WEIGHT = new Map([
  ["News", 5],
  ["Sports", 4],
  ["Movies", 4],
  ["Entertainment", 4],
  ["Kids", 3],
  ["Documentary", 3],
  ["Series", 3],
  ["Music", 2],
  ["Comedy", 2],
  ["General", 2],
  ["Classic", 2],
  ["Relax", 2],
  ["Cooking", 2],
  ["Travel", 2],
]);
const weightOf = (category) => CATEGORY_WEIGHT.get(category) ?? 1;

const cursor = new Map(categories.map((category) => [category, 0]));
const candidates = [];
for (let round = 0; candidates.length < CANDIDATES; round++) {
  let added = false;
  for (const category of categories) {
    const bucket = byCategory.get(category);
    const take = round === 0 ? weightOf(category) : 1;
    for (let i = 0; i < take && candidates.length < CANDIDATES; i++) {
      const index = cursor.get(category);
      if (index >= bucket.length) break;
      candidates.push(bucket[index]);
      cursor.set(category, index + 1);
      added = true;
    }
  }
  if (!added) break;
}
console.log(`Probing ${candidates.length} candidates (concurrency ${CONCURRENCY})...`);

const alive = [];
let done = 0;
await pooled(candidates, CONCURRENCY, async (entry) => {
  const ok = await probe(entry.url);
  done++;
  if (done % 50 === 0) console.log(`  ${done}/${candidates.length} probed, ${alive.length} alive`);
  if (ok) alive.push({ ...entry, category: entry.category });
});

console.log(`\n${alive.length} of ${candidates.length} streams answered.`);

// Pick in *candidate* order, not probe-completion order: `candidates` is built
// round-robin across categories, so walking it preserves a balanced genre mix
// (probe completion order is racy and skews towards whichever hosts are fastest).
const aliveUrls = new Set(alive.map((entry) => entry.url));
const reachable = candidates.filter((entry) => aliveUrls.has(entry.url));

// Prefer https so the browser can play a fallback entry directly as well as
// through the proxy. A stable partition keeps the category spread intact.
const selected = [
  ...reachable.filter((entry) => entry.url.startsWith("https://")),
  ...reachable.filter((entry) => !entry.url.startsWith("https://")),
].slice(0, LIMIT);

if (selected.length < 100) {
  console.warn(
    `WARNING: only ${selected.length} verified channels. Re-run with more --candidates for a fuller catalogue.`
  );
}

// Stable, unique ids.
const usedIds = new Set();
const channels = selected.map((entry) => {
  const base = slugify(entry.tvgId || entry.name);
  let id = base;
  let n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);

  return {
    id,
    name: entry.name,
    logo: entry.logo && /^https?:\/\//i.test(entry.logo) ? entry.logo : "",
    category: entry.category,
    url: entry.url,
    country: entry.country ? entry.country.split(/[;,]/)[0].trim().toUpperCase().slice(0, 2) : "",
    language: entry.language ? entry.language.split(/[;,]/)[0].trim() : "",
  };
});

const categoryCounts = channels.reduce((acc, c) => {
  acc[c.category] = (acc[c.category] || 0) + 1;
  return acc;
}, {});

const header = `/**
 * Built-in fallback channel catalogue — GENERATED FILE, do not edit by hand.
 *
 * Regenerate with:
 *   node scripts/generate-fallback-channels.mjs
 *
 * Every URL below was probed at generation time, so this dataset is a real
 * catalogue (${channels.length} channels) rather than a placeholder. It is what
 * \`/api/channels\` serves when the upstream playlist cannot be reached inside a
 * serverless execution budget.
 *
 * Generated: ${new Date().toISOString()}
 * Source: ${source}
 * Categories: ${Object.entries(categoryCounts).map(([c, n]) => `${c} (${n})`).join(", ")}
 */
import type { Channel } from "@/types/iptv";

export const FALLBACK_CHANNELS: Channel[] = `;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, `${header}${JSON.stringify(channels, null, 2)};\n`);

console.log(`Wrote ${channels.length} channels to src/data/fallback-channels.ts`);
console.log("Category spread:", JSON.stringify(categoryCounts, null, 2));
