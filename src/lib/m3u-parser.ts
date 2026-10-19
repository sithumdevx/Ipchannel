// The built-in catalogue is generated (see scripts/generate-fallback-channels.mjs)
// and lives in its own module so it can be regenerated without touching the parser.
import type { Channel } from "@/types/iptv";

export { FALLBACK_CHANNELS } from "@/data/fallback-channels";

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

