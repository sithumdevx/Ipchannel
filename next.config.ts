import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 *
 * Deliberately expressed with `'self' + 'unsafe-inline'` for scripts rather
 * than a per-request nonce: every StreamPulse page is statically prerendered
 * (cacheComponents), and nonces require dynamic rendering — a static page
 * shipped with a build-time nonce would block its own scripts.
 * This policy still blocks the dominant XSS gadget classes (loading scripts,
 * frames, objects or forms from arbitrary origins).
 *
 * Migration path to a strict nonce CSP:
 *   https://nextjs.org/docs/app/guides/content-security-policy
 *
 * `https:` / `blob:` sources are required because channel logos, HLS
 * manifests/segments and MSE buffers come from arbitrary public CDNs.
 */
function buildCsp(): string {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(isProduction ? [] : ["'unsafe-eval'"]),
    "https://va.vercel-scripts.com",
    "blob:",
  ].join(" ");

  const connectSrc = [
    "'self'",
    "https:",
    "wss:",
    "https://vitals.vercel-insights.com",
    ...(isProduction ? [] : ["ws:"]),
  ].join(" ");

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob: https: data:",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}

const contentSecurityPolicy = buildCsp();

const securityHeaders: { key: string; value: string }[] = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Clickjacking
  { key: "X-Frame-Options", value: "DENY" },
  // MIME-sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Referrer leakage
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Browser feature lockdown
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()",
  },
  // Legacy Flash/PDF cross-domain policy
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  // Cross-origin isolation (no window.opener hijack, no hotlinking)
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-XSS-Protection", value: "0" }, // modern CSP supersedes the legacy auditor
];

if (isProduction) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  });
}

const nextConfig: NextConfig = {
  // Do not advertise the framework version in the X-Powered-By header.
  poweredByHeader: false,
  reactStrictMode: true,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // API responses must never be indexed or cached as HTML by intermediaries.
        source: "/api/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
