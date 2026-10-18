import { lookup } from "node:dns/promises";

/**
 * SSRF protection for the stream proxy (`/api/proxy`).
 *
 * The proxy accepts a caller-supplied URL and fetches it from the server, so
 * it must never be usable to reach private/internal infrastructure
 * (localhost, RFC1918 ranges, link-local metadata endpoints, ...).
 *
 * Checks performed:
 *   1. scheme must be http(s), no embedded credentials
 *   2. port must be on the allow-list
 *   3. literal IPs are classified (IPv4 + IPv6 + IPv4-mapped)
 *   4. hostnames are resolved and every resolved address must be public
 *      (mitigates DNS-rebinding style tricks for the TTL of the cache)
 */

export interface UrlVerdict {
  ok: boolean;
  reason?: string;
}

/** Ports commonly used by public HLS/HTTP stream origins. */
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

/** Hostnames that always describe the local machine / internal services. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "metadata.goog",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

/** Hostname suffixes that are internal by convention. */
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".localdomain",
  ".localdomain",
];

const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const DNS_CACHE_MAX = 2_000;
const dnsCache = new Map<string, { ok: boolean; until: number }>();

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/** Returns true when the IPv4 address is private, loopback, link-local, etc. */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;

  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarks
  if (a === 198 && b === 51) return true; // 198.51.100.0/24 documentation
  if (a === 203 && b === 0) return true; // 203.0.113.0/24 documentation
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Returns true when the IPv6 address is private, loopback, link-local, etc. */
export function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (addr === "::" || addr === "::1") return true;
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA fc00::/7
  if (/^fe[89ab]/.test(addr)) return true; // link-local fe80::/10
  if (addr.startsWith("ff")) return true; // multicast
  if (addr.includes("%")) return true; // zone id (fe80::1%eth0)
  if (addr.startsWith("::ffff:")) {
    const mapped = addr.slice("::ffff:".length);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(mapped)) return isPrivateIpv4(mapped);
    return isPrivateIpv6(mapped);
  }
  return false;
}

/** Classify any literal IP (v4 or v6) — used for hostnames AND DNS answers. */
function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) return isPrivateIpv6(address);
  return isPrivateIpv4(address);
}

function cacheSet(hostname: string, ok: boolean): void {
  if (dnsCache.size >= DNS_CACHE_MAX) {
    const now = Date.now();
    for (const [key, entry] of dnsCache) {
      if (entry.until <= now) dnsCache.delete(key);
    }
    if (dnsCache.size >= DNS_CACHE_MAX) {
      const firstKey = dnsCache.keys().next().value;
      if (firstKey) dnsCache.delete(firstKey);
    }
  }
  dnsCache.set(hostname, { ok, until: Date.now() + DNS_CACHE_TTL_MS });
}

async function resolveIsPublic(hostname: string): Promise<UrlVerdict> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.until > Date.now()) {
    return cached.ok
      ? { ok: true }
      : { ok: false, reason: "resolved-to-non-public-address" };
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses || addresses.length === 0) {
      cacheSet(hostname, false);
      return { ok: false, reason: "dns-lookup-failed" };
    }

    for (const entry of addresses) {
      if (isPrivateAddress(entry.address)) {
        cacheSet(hostname, false);
        return { ok: false, reason: "resolved-to-non-public-address" };
      }
    }

    cacheSet(hostname, true);
    return { ok: true };
  } catch {
    cacheSet(hostname, false);
    return { ok: false, reason: "dns-lookup-failed" };
  }
}

/**
 * Validate a caller-supplied URL before the server fetches it.
 * Always returns `{ ok: false, reason }` instead of throwing.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<UrlVerdict> {
  if (!rawUrl || rawUrl.length > 4096) {
    return { ok: false, reason: "invalid-length" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "malformed-url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "scheme-not-allowed" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "credentials-not-allowed" };
  }

  const port = parsed.port;
  if (!ALLOWED_PORTS.has(port)) {
    return { ok: false, reason: "port-not-allowed" };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) return { ok: false, reason: "missing-host" };

  // Literal IPv4 / IPv6 host (URL keeps v6 inside brackets).
  const bare = hostname.replace(/^\[|\]$/g, "");
  const isLiteralIp =
    /^\d+\.\d+\.\d+\.\d+$/.test(bare) || bare.includes(":");
  if (isLiteralIp) {
    if (isPrivateAddress(bare)) {
      return { ok: false, reason: "private-address" };
    }
    return { ok: true };
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: "blocked-hostname" };
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { ok: false, reason: "blocked-hostname-suffix" };
    }
  }

  return resolveIsPublic(hostname);
}
