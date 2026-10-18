/**
 * Country metadata helpers for StreamPulse's country-wise filtering.
 *
 * Playlists expose the `country` field in wildly different shapes — ISO codes
 * ("US", "GB"), full names ("Sri Lanka", "United States"), or nothing at all.
 * Everything below normalises those variants into a single canonical alpha-2
 * code so filters, flags and labels stay consistent across the app.
 */

export interface CountryInfo {
  /** Canonical ISO 3166-1 alpha-2 code (lowercased for unknown names). */
  code: string;
  /** Human friendly display name. */
  name: string;
  /** Flag emoji rendered from the code. */
  flag: string;
}

/** Alpha-2 code → English name for the countries we expect in live playlists. */
const CODE_NAMES: Record<string, string> = {
  LK: "Sri Lanka",
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  NZ: "New Zealand",
  IE: "Ireland",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  PT: "Portugal",
  NL: "Netherlands",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  IS: "Iceland",
  LU: "Luxembourg",
  MT: "Malta",
  CY: "Cyprus",
  PL: "Poland",
  CZ: "Czechia",
  SK: "Slovakia",
  SI: "Slovenia",
  HU: "Hungary",
  RO: "Romania",
  BG: "Bulgaria",
  RS: "Serbia",
  HR: "Croatia",
  BA: "Bosnia and Herzegovina",
  ME: "Montenegro",
  MK: "North Macedonia",
  AL: "Albania",
  GR: "Greece",
  UA: "Ukraine",
  BY: "Belarus",
  RU: "Russia",
  MD: "Moldova",
  EE: "Estonia",
  LV: "Latvia",
  LT: "Lithuania",
  TR: "Turkey",
  GE: "Georgia",
  AM: "Armenia",
  AZ: "Azerbaijan",
  KZ: "Kazakhstan",
  UZ: "Uzbekistan",
  IL: "Israel",
  SA: "Saudi Arabia",
  AE: "United Arab Emirates",
  QA: "Qatar",
  KW: "Kuwait",
  BH: "Bahrain",
  OM: "Oman",
  JO: "Jordan",
  LB: "Lebanon",
  IQ: "Iraq",
  IR: "Iran",
  SY: "Syria",
  YE: "Yemen",
  PS: "Palestine",
  EG: "Egypt",
  MA: "Morocco",
  DZ: "Algeria",
  TN: "Tunisia",
  LY: "Libya",
  SD: "Sudan",
  ZA: "South Africa",
  NG: "Nigeria",
  KE: "Kenya",
  GH: "Ghana",
  TZ: "Tanzania",
  UG: "Uganda",
  ET: "Ethiopia",
  ZM: "Zambia",
  ZW: "Zimbabwe",
  BW: "Botswana",
  MZ: "Mozambique",
  MU: "Mauritius",
  BR: "Brazil",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  MX: "Mexico",
  PE: "Peru",
  VE: "Venezuela",
  UY: "Uruguay",
  EC: "Ecuador",
  BO: "Bolivia",
  PY: "Paraguay",
  CR: "Costa Rica",
  PA: "Panama",
  GT: "Guatemala",
  DO: "Dominican Republic",
  CU: "Cuba",
  JM: "Jamaica",
  TT: "Trinidad and Tobago",
  PR: "Puerto Rico",
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  TW: "Taiwan",
  HK: "Hong Kong",
  MO: "Macau",
  SG: "Singapore",
  MY: "Malaysia",
  TH: "Thailand",
  VN: "Vietnam",
  ID: "Indonesia",
  PH: "Philippines",
  PK: "Pakistan",
  BD: "Bangladesh",
  NP: "Nepal",
  MV: "Maldives",
  BT: "Bhutan",
  AF: "Afghanistan",
  MM: "Myanmar",
  KH: "Cambodia",
  LA: "Laos",
  MN: "Mongolia",
  PG: "Papua New Guinea",
  FJ: "Fiji",
};

/** Playlist spellings that don't match the canonical name verbatim. */
const ALIASES: Record<string, string> = {
  usa: "US",
  "u.s.a.": "US",
  "united states of america": "US",
  "america": "US",
  uk: "GB",
  "u.k.": "GB",
  "great britain": "GB",
  "britain": "GB",
  "england": "GB",
  "south korea": "KR",
  "korea": "KR",
  "republic of korea": "KR",
  "russia": "RU",
  "czech republic": "CZ",
  "türkiye": "TR",
  "viet nam": "VN",
  "côte d'ivoire": "CI",
  "ivory coast": "CI",
  "holland": "NL",
  "uae": "AE",
  "palestine": "PS",
  "taiwan, province of china": "TW",
};

/** Canonical preset pills shown first in the country filter bar. */
export const PRESET_COUNTRIES: CountryInfo[] = [
  { code: "LK", name: "Sri Lanka", flag: flagFromCode("LK") },
  { code: "IN", name: "India", flag: flagFromCode("IN") },
  { code: "US", name: "United States", flag: flagFromCode("US") },
  { code: "GB", name: "United Kingdom", flag: flagFromCode("GB") },
];

/** Maximum number of secondary country pills rendered (the row scrolls). */
const MAX_EXTRA_PILLS = 60;

/** Build the 🇱🇰-style emoji from an ISO alpha-2 code. */
export function flagFromCode(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "🌐";
  return String.fromCodePoint(
    0x1f1e6 + (upper.charCodeAt(0) - 65),
    0x1f1e6 + (upper.charCodeAt(1) - 65)
  );
}

/** Name lookup derived from the table above (kept lowercase for matching). */
const NAME_TO_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [code, name] of Object.entries(CODE_NAMES)) {
    map[name.toLowerCase()] = code;
  }
  for (const [alias, code] of Object.entries(ALIASES)) {
    map[alias] = code;
  }
  return map;
})();

/**
 * Resolve any playlist `country` variant into a canonical {@link CountryInfo}.
 * Returns `null` for empty values.
 */
export function resolveCountry(raw: string | null | undefined): CountryInfo | null {
  const value = raw?.trim();
  if (!value) return null;

  // Two-letter codes (playlist values are usually already ISO alpha-2).
  if (/^[A-Za-z]{2}$/.test(value)) {
    const code = value.toUpperCase();
    return { code, name: CODE_NAMES[code] ?? value.toUpperCase(), flag: flagFromCode(code) };
  }

  const lower = value.toLowerCase();
  const code = NAME_TO_CODE[lower];
  if (code) {
    return { code, name: CODE_NAMES[code] ?? value, flag: flagFromCode(code) };
  }

  // Unknown free-form name — still show a globe so the pill reads cleanly.
  return { code: lower, name: value, flag: "🌐" };
}

/** Normalised comparison key for a country value (code, alias, or raw name). */
export function countryCode(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) return "";
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  const lower = value.toLowerCase();
  return NAME_TO_CODE[lower] ?? lower;
}

/** Flag emoji for any country variant. */
export function countryFlag(raw: string | null | undefined): string {
  return resolveCountry(raw)?.flag ?? "🌐";
}

/** Human friendly label for any country variant. */
export function countryLabel(raw: string | null | undefined): string {
  return resolveCountry(raw)?.name ?? (raw?.trim() || "Global");
}

/**
 * Does a channel's `country` metadata match the active filter pill?
 *
 * `selected === "All"` matches everything; every other value is compared on
 * the normalised code so "US", "us" and "United States" are all equivalent.
 */
export function matchesCountry(
  channelCountry: string | null | undefined,
  selected: string | null | undefined
): boolean {
  if (!selected || selected === "All") return true;
  if (!channelCountry) return false;
  return countryCode(channelCountry) === countryCode(selected);
}

/**
 * The full pill list for the country filter bar: the curated presets first,
 * then every other country found in the playlist, alphabetically.
 */
export function buildCountryOptions(countries: string[]): CountryInfo[] {
  const presetCodes = new Set(PRESET_COUNTRIES.map((c) => c.code));
  const seen = new Set<string>(presetCodes);
  const extras: CountryInfo[] = [];

  for (const raw of countries) {
    const info = resolveCountry(raw);
    if (!info || seen.has(info.code)) continue;
    seen.add(info.code);
    extras.push(info);
  }

  extras.sort((a, b) => a.name.localeCompare(b.name));
  return [...PRESET_COUNTRIES, ...extras.slice(0, MAX_EXTRA_PILLS)];
}
