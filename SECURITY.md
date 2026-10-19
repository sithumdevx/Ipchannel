# StreamPulse — Security Hardening Notes

Last updated: 2026-10-19 · Scope: production-readiness audit + implementation, plus
role-based console access (`public.profiles.role`) and role-aware post-login routing.

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
| `public.profiles.role` (`user`/`admin`) — the console's whole authorization model; adapts to the pre-existing table (`id`/`email`/`role`/`created_at`), RLS forced, `authenticated` granted **SELECT only** | ✅ `supabase/migrations/20261019000000_profiles_roles.sql` |
| Role changes blocked at the trigger level as well as by privilege | ✅ `guard_role_change()` |
| Every other table in `public` swept to RLS ON + FORCED | ✅ with `NOTICE` list of now-unreachable tables |
| **Applied to your actual database** | ❌ **you must run it** |

### How to apply (2 minutes)

1. Supabase Dashboard → **SQL Editor** → New query.
2. Paste `supabase/migrations/20261018120000_security_hardening.sql` → **Run**.
   (Idempotent — safe to re-run.)
3. Paste `supabase/migrations/20261019000000_profiles_roles.sql` → **Run**. It sets up the
   RBAC `role` column and also adapts to the `profiles` table already in the project; a
   missing row reads as `user`, so the app is never blocked by it. (Also idempotent.)
4. Promote your first administrator — see
   [Roles & Access Control](./README.md#-roles--access-control-rbac).
5. Verify: run `supabase/audit_rls.sql` (read-only). Expected output:
   - every `public` table: `rls_enabled = t`, `rls_forced = t`, `policy_count ≥ 4`
   - final `DO` block prints `OK: all public tables have RLS enabled.`
   - no `SECURITY DEFINER` functions in `public` **except** `handle_new_user()`, which is one on
     purpose: it is the `auth.users` insert trigger that writes the `profiles` row, and it
     swallows its own failures so bookkeeping can never block a sign-up.

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
   | `/api/ping` | 1200 / min | `PING_RATE_LIMIT_PER_MIN` |
   | everything else `/api/*` | 120 / min | `RATE_LIMIT_API_PER_MIN` |

   `/api/ping` is deliberately generous: it is the player's latency probe
   (`src/app/api/ping/route.ts`), and South Asian mobile carriers put thousands
   of subscribers behind a single CGNAT address, so a modest per-viewer cadence
   still aggregates into a high per-IP rate. The endpoint returns an empty body
   and does no work, and a spurious `429` would be indistinguishable from a
   network fault — it would push the diagnostics badge onto a weaker signal.

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
- **Console authorization is a database role, not an allowlist.** `/admin` and
  every `/api/admin/*` route call `requireAdmin()`, which validates the session
  token against Supabase and then reads `role` from `public.profiles` **with the
  caller's own credentials**. RLS narrows that read to the caller's own row, and
  `authenticated` holds no `INSERT`/`UPDATE`/`DELETE` privilege on the table, so
  a member can neither read anyone else's role nor grant themselves `admin`.
  A `before update` trigger (`guard_role_change`) refuses any `role` change that
  does not come from the service role, covering the case where a future grant
  widens write access. Everything fails closed: a missing row, a missing table,
  or an unreachable project all resolve to "not an administrator".
- **Post-login redirection is role-driven and shared.** The OAuth callback and
  the in-tab sign-in handler both resolve `/watch` (a generic target) to
  `landingPathForRole(role)` — `/admin` for administrators, `/watch` otherwise —
  so the two paths cannot diverge. An explicit deep link (e.g.
  `/watch?channel=42`) is still honoured after sanitization.
- **The `/admin` refusal is a page, not a redirect.** A 403 screen explains which
  account is signed in and offers sign-in / switch-account / back-to-player, and
  surfaces setup errors (missing migration, unconfigured Supabase) to the
  operator. The edge proxy deliberately does **not** gate `/admin`: it could only
  prove that *a* cookie exists, which is not the question, and a redirect would
  hide the real reason.

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
- Diagnostics probe (`/api/ping`, added with the network-friendly diagnostics
  card): same-origin `GET` → `200` with `Cache-Control: no-store` and a 0-byte
  body, `X-RateLimit-Limit: 1200`; cross-site (`Sec-Fetch-Site: cross-site`
  with a foreign `Origin`) → **403**; five sequential probes measured 19–35 ms,
  i.e. real round trips rather than a cached ~0 ms.
- Regression checks around that work: `/watch` anonymous → `307 /?login=true`;
  `/api/health` → `200` with `X-RateLimit-Limit: 120` (unchanged); `/api/proxy`
  with no `url` → `400` (not throttled, not origin-blocked).
- Diagnostics logic exercised straight from source with
  `node --experimental-strip-types`: 64 assertions over `classifyConnection` /
  `medianOf` / the formatters / the SSR guards, and 36 over the telemetry
  store's reference-stability and change-detection contract.
- `npx next build` → clean, with `/api/ping` reported as a static route.
- Role-based access control (`public.profiles.role`):
  - `npx tsc --noEmit` → clean; `npx eslint src` → unchanged at the pre-existing
    4 errors / 14 warnings, none in a touched file
  - `npx next build` → clean; `/admin` reported as `ƒ (Dynamic)`, `/watch` still `○ (Static)`
  - anonymous `GET /admin` → **200** with the dark 403 screen (`Error 403` /
    `Access Denied` / `Sign in with Google`), no operator-notes block, and no
    redirect
  - anonymous `GET /api/admin/me` → `{"admin":false,"email":null}` (200);
    `GET /api/admin/users` and `/api/admin/stats` → **401**
    `{"error":"Authentication required."}`
  - a forged `sb-…-auth-token` cookie → `/admin` still **200 + 403** (fail
    closed: `auth.getUser()` rejects it) and `/watch` still **200**, while
    anonymous `/watch` still **307**s to `/?login=true`

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
| `supabase/migrations/20261019000000_profiles_roles.sql` | `public.profiles` + `role`, RLS, SELECT-only grants, role guard trigger (**run this**) |
| `src/lib/user-role.ts` | the role contract: `UserRole`, `normalizeRole` (fail-closed), `landingPathForRole` |
| `src/lib/admin.ts` | server-side `resolveAdminAccess()` / `requireAdmin()` — session validation + own-row role read |
| `src/lib/admin-supabase.ts` | service-role directory, moderation, and `setUserRole()` (promote/demote) |
| `src/app/admin/AccessDenied.tsx` | dark-themed 403 screen (sign in / switch account / back to player) |
| `supabase/audit_rls.sql` | read-only audit: RLS status, policies, grants, SECURITY DEFINER fns, view invoker |
| `src/proxy.ts` | pre-API gate: cross-site blocking, per-IP rate limits, robots headers |
| `src/lib/security/rate-limit.ts` | fixed-window in-memory limiter (drop-in replaceable) |
| `src/lib/security/origin-guard.ts` | same-origin / `Sec-Fetch-*` checks + client IP |
| `src/lib/security/url-guard.ts` | SSRF guard (schemes, ports, private IPs, DNS) |
| `next.config.ts` | security headers + CSP + `poweredByHeader: false` |
| `src/app/api/proxy/route.ts` | SSRF-checked, same-origin-only, capped, timeout-bounded stream proxy |
| `src/app/api/channels/route.ts` | clamped inputs, refresh throttle, fetch stampede collapse |
| `src/app/api/ping/route.ts` | uncached, zero-body latency probe (CGNAT-aware rate limit) |
| `src/app/auth/callback/route.ts` | `next` sanitization, `no-store`, hardened cookie flags |
| `src/lib/supabase.ts` | hardened session cookie options on the browser client |
