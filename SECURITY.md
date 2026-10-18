# StreamPulse — Security Hardening Notes

Last updated: 2026-10-18 · Scope: production-readiness audit + implementation.

This document lists what is enforced in code, **the one step you must run in
Supabase yourself**, and the residual risks you should knowingly accept.

---

## 1. Database / Supabase (⚠ action required)

The browser talks to Supabase directly with the **public anon key**. That key
is *not* a secret — anyone can read it from the network tab. **Row Level
Security is the only access control for user data.**

| Item | Status |
| --- | --- |
| `user_favorites` RLS enabled + forced | ✅ in `supabase/migrations/20261018120000_security_hardening.sql` |
| Strict `auth.uid() = user_id` policies for SELECT / INSERT / UPDATE / DELETE | ✅ in the migration |
| `UPDATE` policy (required for the app's `upsert()`) | ✅ — this was **missing** from the original snippet |
| `anon` role privileges revoked on user data | ✅ in the migration |
| Optional `profiles` table hardened if present | ✅ guarded block |
| Every other table in `public` swept to RLS ON + FORCED | ✅ with `NOTICE` list of now-unreachable tables |
| **Applied to your actual database** | ❌ **you must run it** |

### How to apply (2 minutes)

1. Supabase Dashboard → **SQL Editor** → New query.
2. Paste `supabase/migrations/20261018120000_security_hardening.sql` → **Run**.
   (Idempotent — safe to re-run.)
3. Verify with `supabase/audit_rls.sql` (read-only). Expected output:
   - every `public` table: `rls_enabled = t`, `rls_forced = t`, `policy_count ≥ 4`
   - final `DO` block prints `OK: all public tables have RLS enabled.`
   - zero `SECURITY DEFINER` functions in `public`

> I cannot execute this from the app: DDL needs the SQL editor / service role,
> which isn't available to the codebase (and no service-role key exists in
> `.env.local` — by design).

---

## 2. API & source protection

- **All stream access is server-routed.** The browser never talks to upstream
  stream CDNs for manifests/keys — it goes through `GET /api/proxy`.
  Channel metadata goes through `GET /api/channels`. The only `NEXT_PUBLIC_*`
  env values are Supabase's URL + anon key; **no server-only secrets exist in
  the client bundle** (verified: no `service_role` / `sk-` / private keys
  anywhere in `src/`).
- **SSRF protection** on `/api/proxy` (`src/lib/security/url-guard.ts`):
  - `http(s)` only — blocks `file:`, `gopher:`, `javascript:`, etc.
  - no embedded credentials, port allow-list (`80/443/8080/8443`)
  - private/loopback/link-local/CGNAT/multicast IPv4 **and** IPv6
    (incl. IPv4-mapped) literals rejected — e.g. `127.0.0.1`,
    `169.254.169.254` (cloud metadata), `10.x`, `192.168.x`
  - `localhost` / `*.local` / `*.internal` / `metadata.google.internal`… rejected
  - hostnames are **DNS-resolved** and every answer must be public
    (5-minute cache mitigates DNS rebinding for the TTL)
  - proxying back into this deployment is rejected (no request loops)
- **Open relay closed.** `Access-Control-Allow-Origin: *` on `/api/proxy` was
  removed; CORS is echoed only to same-origin callers (`Vary: Origin`),
  preflights from other origins get `403`.
- **Upstream hardening on the proxy:** 20 s timeout, 4 MB playlist cap,
  64 MB segment cap, upstream error bodies are never echoed back, logs record
  the redacted URL only (query strings can carry signed tokens), partial (`206`)
  bodies are never written to the segment cache (cache poisoning).
- **Response-shape hardening on `/api/channels`:** `page`/`limit` clamped
  (≤ 100 000 / ≤ 500), filter strings truncated, `?refresh=true` throttled to
  once per minute and concurrent refreshes collapse into a single upstream
  fetch (no stampede against the upstream playlist).

## 3. HTTP / middleware hardening

Next.js 16 renamed `middleware.ts` → **`proxy.ts`**, so the edge gate lives in
`src/proxy.ts` and runs before every `/api/*` route:

1. **Cross-site requests blocked**: `Origin` must match the request host and
   `Sec-Fetch-Site` must be `same-origin`/`none`. Other websites can no longer
   drive the API from a visitor's browser; dumb scrapers that forward browser
   fetch metadata are rejected.
2. **Per-IP rate limiting** (`src/lib/security/rate-limit.ts`):

   | Endpoint | Default | Env override |
   | --- | --- | --- |
   | `/api/proxy` | 600 / min | `RATE_LIMIT_PROXY_PER_MIN` |
   | `/api/channels` | 60 / min | `RATE_LIMIT_CHANNELS_PER_MIN` |
   | everything else `/api/*` | 120 / min | `RATE_LIMIT_API_PER_MIN` |

   Violations return `429` + `Retry-After` + `X-RateLimit-*`.
3. `X-Robots-Tag: noindex, nofollow, noarchive` on all API responses.

Static security headers are applied by `next.config.ts` to every response:

```
Content-Security-Policy (see below)
X-Frame-Options: DENY                    (+ CSP frame-ancestors 'none')
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin   (no-referrer on /api)
Permissions-Policy: camera/mic/geolocation/payment/usb/sensors = ()
Strict-Transport-Security: max-age=63072000; includeSubDomains  (production)
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Permitted-Cross-Domain-Policies: none
X-Powered-By: removed (poweredByHeader: false)
```

**CSP trade-off (deliberate):** `script-src` uses `'self' 'unsafe-inline'`
rather than a per-request nonce, because every page is statically prerendered
(`cacheComponents: true`) and nonces require dynamic rendering — a static page
shipped with a build-time nonce would block its own scripts. The policy still
blocks the dominant XSS gadget classes (loading scripts/frames/objects/forms
from arbitrary origins). `https:`/`blob:` remain open for `img`/`media`/
`connect` because channel logos and HLS traffic come from arbitrary CDNs.
Migration path to a strict nonce CSP: make the shell dynamic and follow
<https://nextjs.org/docs/app/guides/content-security-policy>.

## 4. Authentication hardening

- **PKCE flow is enforced** — `@supabase/ssr` hard-codes `flowType: "pkce"`
  for both browser and server clients (verified in the package source), so
  authorization codes can't be replayed without the code verifier.
- **Open-redirect fix in `src/app/auth/callback/route.ts`:** the `next`
  query param used to be concatenated straight into the redirect target. It is
  now sanitized — must be a relative single-slash path, no `//`, no `/\`, no
  `..`, no control characters, decoded once and re-checked; anything else falls
  back to `/watch`.
- **Session cookies hardened:** `SameSite=Lax`, `Secure` on HTTPS (and
  loopback), explicit `Path=/`, 30-day `Max-Age` (matching Supabase's refresh
  token lifetime) — set both in `createBrowserClient` (`src/lib/supabase.ts`)
  and in the `setAll` of the OAuth callback.
- **Auth responses are never cached:** `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, `X-Robots-Tag` on the callback; failed code
  exchanges log the reason server-side instead of echoing it.
- `httpOnly` is intentionally **not** set on the session cookie: `@supabase/ssr`
  stores the session where client JS must read it. The real boundary is RLS +
  the 30-day lifetime — do not store anything sensitive in `user_metadata`.

## 5. Verification performed

- `npx tsc --noEmit` → clean
- `npx eslint` on every touched file → 0 errors (pre-existing lint debt in
  `watch/page.tsx`, `AuthModal.tsx`, `VideoPlayer.tsx`, `ProfileContext.tsx`
  untouched)
- Live tests against the dev server:
  - `/api/channels` → 200 with all security headers + `X-RateLimit-*`
  - `?url=http://127.0.0.1:3000/` → **403** · `169.254.169.254` → **403**
  - `file:///etc/passwd` → **400** · missing `url` → **400**
  - `Origin: https://evil.example` → **403** · `Sec-Fetch-Site: cross-site` → **403**
  - same-origin `Origin`+`Sec-Fetch-Site` → **200**
  - upstream M3U playlist through the proxy → **200** (rewritten)
  - 70 rapid `/api/channels` calls → 429 after the 60th, `Retry-After: 46`

## 6. Residual risks — accepted, not solved

1. **Rate limits are per-instance.** The counter lives in module memory, so
   serverless/edge instances each keep their own buckets (soft limit) and a
   determined attacker can rotate IPs. For a hard global limit, swap the
   implementation of `src/lib/security/rate-limit.ts` for Upstash Redis —
   the exported API was designed for that drop-in.
2. **Source URLs are public by design.** `/api/channels` returns real stream
   URLs because the player needs them, and `.ts` segments bypass the proxy for
   throughput. This is public free-to-air IPTV data, so there is nothing secret
   to leak — but anyone can also scrape the same public sources directly, so
   proxying every segment would only add cost. Set
   `proxySegments=true` (already supported by the player) if you want all
   segment traffic server-side.
3. **Header-based origin checks are spoofable** by non-browser clients —
   they are scrape friction, not authentication. RLS + rate limits are the
   real controls.
4. **CSP without nonces** (see §3) — meaningful XSS mitigation, not a guarantee.
5. **HSTS includes `includeSubDomains`** — remove it if you ever serve an
   HTTP subdomain of the same registrable domain.
6. **No WAF / bot management / geo blocking** — handled at the platform layer
   (Vercel, Cloudflare) if needed.

## 7. File map

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261018120000_security_hardening.sql` | RLS enable + strict policies + least-privilege grants (**run this**) |
| `supabase/audit_rls.sql` | read-only audit: RLS status, policies, grants, SECURITY DEFINER fns, view invoker |
| `src/proxy.ts` | pre-API gate: cross-site blocking, per-IP rate limits, robots headers |
| `src/lib/security/rate-limit.ts` | fixed-window in-memory limiter (drop-in replaceable) |
| `src/lib/security/origin-guard.ts` | same-origin / `Sec-Fetch-*` checks + client IP |
| `src/lib/security/url-guard.ts` | SSRF guard (schemes, ports, private IPs, DNS) |
| `next.config.ts` | security headers + CSP + `poweredByHeader: false` |
| `src/app/api/proxy/route.ts` | SSRF-checked, same-origin-only, capped, timeout-bounded stream proxy |
| `src/app/api/channels/route.ts` | clamped inputs, refresh throttle, fetch stampede collapse |
| `src/app/auth/callback/route.ts` | `next` sanitization, `no-store`, hardened cookie flags |
| `src/lib/supabase.ts` | hardened session cookie options on the browser client |
