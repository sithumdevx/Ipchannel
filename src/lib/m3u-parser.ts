import { Channel } from "@/types/iptv";

/**
 * Fallback verified high-uptime legal public HLS channels
 */
export const FALLBACK_CHANNELS: Channel[] = [
  {
    id: "nasa-tv-public",
    name: "NASA TV Public",
    logo: "https://upload.wikimedia.org/wikipedia/commons/e/e5/NASA_logo.svg",
    category: "Science",
    url: "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8",
    country: "US",
    language: "English",
  },
  {
    id: "dw-english",
    name: "DW English HD",
    logo: "https://upload.wikimedia.org/wikipedia/commons/7/75/Deutsche_Welle_symbol_2012.svg",
    category: "News",
    url: "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8",
    country: "DE",
    language: "English",
  },
  {
    id: "france24-en",
    name: "France 24 English",
    logo: "https://upload.wikimedia.org/wikipedia/en/6/65/France_24_logo.svg",
    category: "News",
    url: "https://static.france24.com/live/F24_EN_LO_HLS/live_tv.m3u8",
    country: "FR",
    language: "English",
  },
  {
    id: "al-jazeera-en",
    name: "Al Jazeera English",
    logo: "https://upload.wikimedia.org/wikipedia/en/f/f2/Al_Jazeera_English_logo.svg",
    category: "News",
    url: "https://live-hls-web-aje.getaj.net/AJE/03.m3u8",
    country: "QA",
    language: "English",
  },
  {
    id: "redbull-tv",
    name: "Red Bull TV",
    logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/f5/Red_Bull_TV_logo.svg/320px-Red_Bull_TV_logo.svg.png",
    category: "Sports",
    url: "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8",
    country: "AT",
    language: "English",
  },
  {
    id: "euronews-en",
    name: "Euronews English",
    logo: "https://upload.wikimedia.org/wikipedia/commons/4/47/Euronews_2016_logo.svg",
    category: "News",
    url: "https://euronews-euronews-world-1-au.samsung.wurl.tv/playlist.m3u8",
    country: "FR",
    language: "English",
  },
  {
    id: "bloomberg-tv",
    name: "Bloomberg Television",
    logo: "https://upload.wikimedia.org/wikipedia/commons/5/53/Bloomberg_News_logo.svg",
    category: "Business",
    url: "https://bloomberg.com/media-manifest/streams/us.m3u8",
    country: "US",
    language: "English",
  },
  {
    id: "cbs-news",
    name: "CBS News 24/7",
    logo: "https://upload.wikimedia.org/wikipedia/commons/1/19/CBS_News_24-7_logo.svg",
    category: "News",
    url: "https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f13459e9764f1642436f564/master.m3u8",
    country: "US",
    language: "English",
  },
  {
    id: "rakuten-movies",
    name: "Rakuten TV Action Movies",
    logo: "https://upload.wikimedia.org/wikipedia/commons/0/05/Rakuten_TV_logo.svg",
    category: "Movies",
    url: "https://rakuten-actionmovies-1-eu.rakuten.wurl.tv/playlist.m3u8",
    country: "ES",
    language: "English",
  },
  {
    id: "wild-earth",
    name: "WildEarth TV",
    logo: "https://images.unsplash.com/photo-1534567153574-2b12153a87f0?w=100&h=100&fit=crop",
    category: "Documentary",
    url: "https://wildearth-samsungau.amagi.tv/playlist.m3u8",
    country: "ZA",
    language: "English",
  }
];

/**
 * Standardize category names while preserving original specificity
 */
export function normalizeCategory(rawCategory: string | undefined): string {
  if (!rawCategory || !rawCategory.trim()) return "General";
  
  const clean = rawCategory.trim();
  const primary = clean.split(/[;,/]/)[0].trim();
  if (!primary) return "General";

  const lower = primary.toLowerCase();
  if (lower.includes("news")) return "News";
  if (lower.includes("sport")) return "Sports";
  if (lower.includes("movie") || lower.includes("cinema") || lower.includes("film")) return "Movies";
  if (lower.includes("music")) return "Music";
  if (lower.includes("doc")) return "Documentary";
  if (lower.includes("anim") || lower.includes("cartoon") || lower.includes("anime")) return "Animation";
  if (lower.includes("kid") || lower.includes("child")) return "Kids";
  if (lower.includes("entertain")) return "Entertainment";
  if (lower.includes("science") || lower.includes("tech")) return "Science";
  if (lower.includes("business") || lower.includes("finance")) return "Business";
  if (lower.includes("comedy")) return "Comedy";
  if (lower.includes("cook") || lower.includes("food")) return "Cooking";
  if (lower.includes("travel") || lower.includes("outdoor")) return "Travel";
  if (lower.includes("religi")) return "Religious";
  if (lower.includes("series") || lower.includes("drama")) return "Series";
  if (lower.includes("auto") || lower.includes("motor")) return "Automotive";
  if (lower.includes("classic")) return "Classic";
  if (lower.includes("weather")) return "Weather";
  if (lower.includes("culture")) return "Culture";
  if (lower.includes("education")) return "Education";
  if (lower.includes("lifestyle")) return "Lifestyle";
  if (lower.includes("legislative")) return "Legislative";
  if (lower.includes("relax")) return "Relax";
  if (lower.includes("shop")) return "Shopping";

  return primary.charAt(0).toUpperCase() + primary.slice(1);
}

/**
 * Fast, non-destructive parser that extracts ALL channels from raw M3U content
 */
export function parseM3U(m3uContent: string): Channel[] {
  const lines = m3uContent.split(/\r?\n/);
  const channels: Channel[] = [];
  
  let currentInfo: Partial<Channel> | null = null;
  let counter = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      currentInfo = {};
      counter++;

      // Attribute regex extractions
      const idMatch = line.match(/tvg-id="([^"]*)"/i);
      const nameMatch = line.match(/tvg-name="([^"]*)"/i);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const countryMatch = line.match(/tvg-country="([^"]*)"/i);
      const languageMatch = line.match(/tvg-language="([^"]*)"/i);

      // Channel title after last comma
      const lastCommaIndex = line.lastIndexOf(",");
      let title = "";
      if (lastCommaIndex !== -1) {
        title = line.substring(lastCommaIndex + 1).trim();
      }

      const name = title || nameMatch?.[1] || idMatch?.[1] || `Channel ${counter}`;
      const rawCategory = groupMatch?.[1] || "General";
      const category = normalizeCategory(rawCategory);

      const baseId = idMatch?.[1] || name.toLowerCase().replace(/[^a-z0-9]/g, "-");
      const id = `${baseId}-${counter}`;

      currentInfo = {
        id,
        name,
        logo: logoMatch?.[1]?.trim() || "",
        category,
        country: countryMatch?.[1]?.trim() || "",
        language: languageMatch?.[1]?.trim() || "",
      };
    } else if (line.startsWith("#EXTGRP:")) {
      // Group header directive
      if (currentInfo && !currentInfo.category) {
        currentInfo.category = normalizeCategory(line.replace("#EXTGRP:", "").trim());
      }
    } else if (line.startsWith("#")) {
      // Other metadata directives (e.g. #EXTVLCOPT) - do NOT clear currentInfo
      continue;
    } else if (line.startsWith("http://") || line.startsWith("https://")) {
      // Valid stream URL found
      const name = currentInfo?.name || `Stream ${counter + 1}`;
      const id = currentInfo?.id || `stream-${counter + 1}`;

      channels.push({
        id,
        name,
        logo: currentInfo?.logo || "",
        category: currentInfo?.category || "General",
        url: line,
        country: currentInfo?.country || "",
        language: currentInfo?.language || "",
      });

      currentInfo = null;
    }
  }

  return channels;
}

/**
 * Fetches playlist(s) and parses all valid channels.
 *
 * `url` defaults to the first entry of the `STREAM_SOURCES` env var (a
 * comma-separated list of M3U/M3U8 URLs). When no source is configured we
 * fall back to the built-in verified channel set.
 */
export async function fetchAndParseM3U(url?: string): Promise<Channel[]> {
  const source = url ?? process.env.STREAM_SOURCES?.split(",")[0]?.trim();
  if (!source) {
    console.warn("No STREAM_SOURCES configured, using built-in verified channels.");
    return FALLBACK_CHANNELS;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

    const response = await fetch(source, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
      },
      next: { revalidate: 3600 * 6 },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch M3U playlist: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const parsed = parseM3U(text);

    if (parsed.length === 0) {
      return FALLBACK_CHANNELS;
    }

    return parsed;
  } catch (error) {
    console.warn("Failed to fetch the live M3U playlist, using fallback verified channels:", error);
    return FALLBACK_CHANNELS;
  }
}
