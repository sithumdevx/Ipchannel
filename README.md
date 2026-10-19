<div align="center">

# StreamPulse

### Next-Gen Cinematic IPTV & Live Stream Aggregator

**A production-grade, account-only live TV platform — 30,000+ free-to-air channels,
verified every 5 minutes, streamed in adaptive HLS straight from your browser.**

<br/>

[![Next.js](https://img.shields.io/badge/Next.js-16%20(App%20Router)-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-Auth_%2B_RLS-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com)

<br/>

**Developed by [Sithum Thilina](https://github.com/sithumdevx)** · *Full-Stack Developer & Interface Engineer*

[Key Features](#-key-features) · [Tech Stack](#-tech-stack) · [Getting Started](#-getting-started) · [Security](#-security) · [Credits](#license--credits)

</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Roles & Access Control (RBAC)](#-roles--access-control-rbac)
- [Stream Health Checker](#-5-minute-automated-stream-health-checker)
- [Security](#-security)
- [Scripts](#-scripts)
- [Deployment](#-deployment-on-vercel)
- [License & Credits](#-license--credits)

---

## 🎬 Overview

StreamPulse is a cinematic IPTV aggregator built with the Next.js App Router. It ingests
public M3U/M3U8 playlists, indexes them into a searchable channel directory, verifies stream
health on a five-minute cycle, and serves only **live, reachable broadcasts** behind a
mandatory authentication wall — with cloud-synced favorites, watch history, country-wise
filtering, a glassmorphism dark/light UI and a role-gated **admin console** for operators.

| Route | Purpose |
| :-- | :-- |
| `/` | Cinematic landing page — hero spotlight, category rails, quick-browse grid |
| `/watch` | Protected player view — video player, Now Playing panel, filters, infinite grid |
| `/admin` | Role-gated console — overview metrics, streams, users, broadcast, system; dark **403** screen for anyone else |
| `/dashboard` | Permanent redirect to `/admin` (legacy bookmarks) |
| `/developer` | Custom developer profile — author details, tech stack, engineering highlights |
| `/categories` | Category browse — every channel group, tap through to the player |
| `/about` · `/tv` | Redirects to `/developer` and `/watch` respectively |
| `/auth/callback` | OAuth / email-confirmation exchange → redirects by role (`/admin` or `/watch`) |
| `/api/channels` | Parsed, health-filtered channel catalogue with search/category/country filters |
| `/api/proxy` | Hardened CORS-bypass proxy for M3U8 manifests |
| `/api/health` | Stream-health sweep (cron) + on-demand probe + aggregate counters |
| `/api/ping` | Empty, uncached latency probe that powers the connection-quality badge |
| `/api/presence` | Active-viewer heartbeats behind the counter in the UI |
| `/api/announcement` | Public read of the active broadcast banner |
| `/api/admin/*` | Console APIs — `stats`, `streams`, `users`, `announcement`, `actions`; every handler gated by `requireAdmin()` |

---

## ✨ Key Features

### 🔐 Mandatory Authentication
Secure, **account-only** access powered by Supabase Auth — **Google Sign-In** (OAuth) and
**Email / Username registration** with email confirmation. **No guest mode:** unauthenticated
visitors are bounced by the edge proxy to the sign-in wall before ever reaching the player.

### ⚡ Role-Aware Post-Login Navigation
Fresh sign-ins land on the page their account's role owns: **administrators** are routed to the
admin console (`/admin`), **everyone else** to the player (`/watch`). The role lives in
`public.profiles` and is read server-side by the OAuth callback
(`/auth/callback?next=/watch`) and by the profile sync layer for in-tab email/password sign-ins —
one shared rule, so the two paths cannot disagree.

### 👥 Admin Console & Role-Based Access
A five-tab console at `/admin` — **Overview** (live metrics, traffic and sign-up chart,
system health rate), **Streams** (per-channel health, preview modal, deep scan), **Users**
(directory, moderation, roles), **Broadcast** (the site-wide banner) and **System** (caches,
manual sweeps).

Access is `role = 'admin'` in `public.profiles`, resolved **server-side on every request
using the caller's own credentials** — so row-level security, not the UI, is what enforces
it. Anyone else gets a dark-themed **403 Access Denied** screen (Google sign-in, switch
account, operator runbook) rather than a redirect, and every `/api/admin/*` handler repeats
the same `requireAdmin()` check, so the API is safe even if the page is bypassed.

From the **Users** tab an administrator can:

- **Promote** an account to `admin` or **Demote** it back to `user` — one click each, with a
  two-step confirm. The write goes through the service role, and it applies on the account's
  next page load (no re-login needed).
- **Suspend** (ban + sign out everywhere) or **Restore**, and **Revoke** every session without
  banning — the right tool for a leaked token.
- Never act on their **own** account: the row is disabled, so a mis-click cannot lock the
  operator out and there is always at least one administrator left.

### 🩺 5-Minute Automated Stream Health Checker
A background verifier probes streams on a rolling 5-minute TTL (driven by an in-process
sweeper **and** a Vercel cron hitting `/api/health?sweep=1`). Confirmed-dead streams are
filtered out of every response, and only reachable channels render a **glowing `• LIVE`
badge** in the grid and player.

### 🎬 Modern Cinematic UI/UX
Dark & light theme toggle with smooth token transitions, animated aurora hero, glassmorphism
panels, **active viewer counters**, **5-star ratings**, clean gradient action cards, and a
redesigned Now Playing panel (live status bar, category pill, full-width glowing
`Favorite / Favorited` button, Previous/Next channel navigation).

### 🌍 Country-Wise & Category Filtering
Sleek scrolling pill bars with flags — **All 🌐 · Sri Lanka 🇱🇰 · India 🇮🇳 · United States 🇺🇸 ·
United Kingdom 🇬🇧** plus every other country discovered in the playlist — alongside category
chips. Filtering is instant across the channel grid **and** search results, backed by
normalised metadata matching (`US` ≡ `United States`) on both client and server.

### 🛡️ Enterprise-Grade Security
Row Level Security (RLS) enforced per user, origin/URL guards, per-IP rate limiting with
`X-RateLimit-*` headers, security headers (`Referrer-Policy`, `X-Content-Type-Options`,
`X-Robots-Tag`), input capping, and a hardened CORS-bypass proxy. See
[`SECURITY.md`](./SECURITY.md) for the full audit.

### 👨‍💻 Custom Developer Profile
A dedicated [`/developer`](./src/app/developer/page.tsx) page showcasing the author —
**Sithum Thilina** — with role, social links, tech stack and engineering highlights.

### 📺 Player Capabilities
HLS.js adaptive playback (auto bitrate + quality settings), Picture-in-Picture, fullscreen
modes, keyboard controls, chunked infinite-scroll catalogue (72 cards per chunk), cloud-synced
favorites & watch history, and CORS-proxy failover with automatic direct-play retry.

### 🇱🇰 Network-Friendly Diagnostics
A live diagnostics card in the watch page's **Now Playing** panel, built for the unstable
4G/LTE links this audience actually watches on:

- **Connection quality** — `Excellent (Stable)` / `Good` / `Fair` / `Poor Connection` /
  `Offline`, derived from the Network Information API *and* a real round trip to
  `GET /api/ping`. Every signal is scored and the **worst one decides**, so the badge
  under-promises rather than claiming a healthy link through a stall.
- **Stream health** — `Stream Stable` / `Buffering` / `Stream Offline` (plus a neutral
  `Paused`), read live from `hls.js` and the `<video>` element, so "your network is bad"
  is never confused with "this channel is down".
- **Adaptive-bitrate tuning** — lower starting bandwidth estimate, headroom-gated level
  switching, a 30s / 30 MB buffer ceiling and extra fragment retries, so quality steps
  down (1080p → 720p → 480p) instead of stalling when bandwidth collapses.
- **Friendly toast** — a non-blocking notice below the header when hls.js downscales by
  itself: *"Connection slow — adjusting playback quality for smooth streaming"*.

---

## 🧰 Tech Stack

| Layer | Technology |
| :-- | :-- |
| **Framework** | Next.js 16 — App Router, Route Handlers, Edge Proxy, Turbopack |
| **Language** | TypeScript (strict), React 19 |
| **Styling** | Tailwind CSS 4 (design tokens), Lucide Icons, glassmorphism UI, custom keyframe animations |
| **Player** | HLS.js with adaptive bitrate, buffer tuning, PiP, quality switching |
| **Backend & Auth** | Supabase — Auth (Google OAuth + email), PostgreSQL, Row Level Security |
| **Authorization** | Role-based (`public.profiles.role`) — re-checked server-side on every page and API call, backed by forced RLS and a role-guard trigger |
| **Streaming** | Server-side M3U parser, CORS-bypass proxy, 5-minute health verifier |
| **Analytics** | Vercel Analytics |
| **Deployment** | Vercel (Edge/Node functions, cron jobs, global CDN) |

---

## 🗂 Project Structure

```
ipchannel/
├── src/
│   ├── app/
│   │   ├── page.tsx               # Cinematic landing page
│   │   ├── watch/page.tsx         # Protected player view + filters
│   │   ├── admin/                 # Console page + Users / Streams / Broadcast panels + 403 screen
│   │   ├── developer/page.tsx     # Developer profile
│   │   ├── api/admin/             # stats · streams · users · announcement · actions (requireAdmin)
│   │   ├── api/channels/          # Catalogue + search/category/country filters
│   │   ├── api/proxy/             # CORS-bypass M3U8 proxy
│   │   ├── api/health/            # Stream-health cron & probes
│   │   ├── api/announcement/      # Public read of the active banner
│   │   ├── api/presence/          # Active-viewer counter
│   │   ├── api/ping/              # Latency probe for the diagnostics badge
│   │   └── auth/callback/         # OAuth/email confirmation → role landing page
│   ├── components/                # VideoPlayer, ChannelCard, CountryFilter, AuthModal …
│   ├── context/                   # ProfileContext (favorites/history), ThemeContext
│   ├── hooks/                     # useConnectionQuality (probe + Network Information API)
│   ├── lib/
│   │   ├── user-role.ts           # Role contract: UserRole, normalizeRole, landingPathForRole
│   │   ├── admin.ts               # resolveAdminAccess() / requireAdmin() — session + role
│   │   ├── admin-supabase.ts      # Service-role directory, moderation, setUserRole()
│   │   ├── admin-stats.ts         # Aggregated console metrics
│   │   ├── stream-health.ts       # 5-minute health verifier
│   │   └── security/              # origin-guard, url-guard, rate-limit
│   ├── proxy.ts                   # Edge middleware: auth gate, rate limits, headers
│   └── types/                     # iptv.ts (channels), admin.ts (console shapes)
├── supabase/
│   ├── migrations/
│   │   ├── 20261018120000_security_hardening.sql   # RLS, policies, least-privilege grants
│   │   └── 20261019000000_profiles_roles.sql       # profiles.role, triggers, RLS
│   └── audit_rls.sql              # Read-only RLS verification
├── SECURITY.md                    # Security audit & hardening notes
└── vercel.json                    # 5-minute health cron
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 20.9+** (Node 22 LTS recommended)
- **npm** (or pnpm / yarn / bun)
- A free **[Supabase](https://supabase.com)** project (Auth + Postgres)
- Optional: one or more public **M3U / M3U8 playlist URLs**

### 1 · Clone & install

```bash
git clone https://github.com/sithumdevx/Ipchannel.git
cd Ipchannel
npm install
```

### 2 · Configure environment variables

Create a `.env.local` file in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"

# Optional — comma-separated playlists; falls back to the built-in verified channel set
STREAM_SOURCES="https://example.com/playlist.m3u"

# Optional — protects the /api/health cron sweep
HEALTH_CRON_SECRET="generate-a-long-random-string"
```

See [Environment Variables](#-environment-variables) for the full reference.

### 3 · Initialize the database (RLS + roles)

In the Supabase Dashboard → **SQL Editor**, run both migrations, then verify:

```bash
# 1. Paste & Run:  supabase/migrations/20261018120000_security_hardening.sql
# 2. Paste & Run:  supabase/migrations/20261019000000_profiles_roles.sql
# 3. Verify (read-only): supabase/audit_rls.sql
```

Expected: every `public` table reports `rls_enabled = t`, `rls_forced = t`, and the audit
prints `OK: all public tables have RLS enabled.` — details in [`SECURITY.md`](./SECURITY.md).

The second migration is the RBAC one. It **adapts to the `profiles` table your project
already has** (keyed by `id`, with `email` / `role` / `created_at`): it adds only the columns
that are missing, rewrites any legacy `role` value to `user` unless it is exactly `admin`
(a change that can only *narrow* access), then adds the constraints, the sign-up trigger, the
role-guard trigger, forced RLS and the `select`-only grant. It is idempotent — re-running it is
safe, and it never has to be run before the app works, because a missing `profiles` row simply
reads as `user`.

That `role` column (`user` / `admin`) is the **entire** authorization model: `admin` may open
`/admin`, everyone else gets the 403 screen. Every account defaults to `user`. Promote yourself
to bootstrap the first administrator, then sign out and back in:

```sql
insert into public.profiles (id, role)
select id, 'admin' from auth.users where email = 'you@example.com'
on conflict (id) do update set role = excluded.role;
```

After that, use the console's **Users** tab to promote or demote anyone else.

### 4 · Run the development server

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** and create an account (Google or email):
a normal account is redirected into the player at **`/watch`**, while an account whose
`profiles.role` is `admin` lands on the console at **`/admin`**.

---

## 🔐 Environment Variables

### Required

| Variable | Description |
| :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon key (client-safe; RLS is the access control) |

### Optional

| Variable | Default | Description |
| :-- | :-- | :-- |
| `STREAM_SOURCES` | — | Comma-separated M3U/M3U8 playlist URLs. Unset → built-in verified channels |
| `HEALTH_CRON_SECRET` | — | Bearer secret protecting `/api/health?sweep=1` (set `CRON_SECRET` to the same value on Vercel) |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only. Enables the console's user directory and **promote/demote** (both bypass RLS by design). Never expose it with a `NEXT_PUBLIC_` prefix |
| `RATE_LIMIT_PROXY_PER_MIN` | `600` | Per-IP proxy requests / minute |
| `RATE_LIMIT_CHANNELS_PER_MIN` | `60` | Per-IP catalogue requests / minute |
| `RATE_LIMIT_API_PER_MIN` | `120` | Per-IP generic API requests / minute |
| `PING_RATE_LIMIT_PER_MIN` | `1200` | Per-IP `/api/ping` latency probes / minute (generous: mobile CGNAT shares one IP) |

---

## 🩺 5-Minute Automated Stream Health Checker

```
Playlist → parse → schedule probe (bounded slice)
                → probeStream()  ──► recordHealth()  (TTL 5 min)
                                          │
   cron /api/health?sweep=1 (every 5 min) ─┤
   in-process sweeper (long-lived dev)  ───┘
                                          ▼
                        filterLive() → channels[] with isLive
                                          ▼
                          glowing • LIVE badge / dead streams dropped
```

- **TTL:** `HEALTH_TTL_MS = 5 min` — stale results are treated as unverified, never as live.
- **Cadence:** Vercel cron (`vercel.json`, `*/5 * * * *`) plus an in-process sweeper for
  self-hosted/dev servers where timers persist.
- **Client:** the player re-fetches the feed every 5 minutes so badges stay current and
  confirmed-dead channels drop out of the list automatically.

---

## 🔑 Roles & Access Control (RBAC)

Every account carries exactly one role, stored as `role` in `public.profiles`
(`user` | `admin`). It is the **whole** authorization model — there is no allow-list
env var and no client-side flag.

| Role | Lands on | Console |
| :-- | :-- | :-- |
| `user` *(default for every new sign-up)* | `/watch` | ❌ — dark **403 Access Denied** screen |
| `admin` | `/admin` | ✅ — full console, including the Users tab |

### Where the decision is made

| Point | File | Behaviour |
| :-- | :-- | :-- |
| Google OAuth & email confirmation | `src/app/auth/callback/route.ts` | reads the role with the freshly-established session, then redirects. `/`, `/watch` and `/auth/callback` are "generic" targets and are replaced by the role's landing page; an explicit deep link (`/watch?channel=42`) is honoured |
| In-tab email / password sign-in | `src/context/ProfileContext.tsx` | the same rule via the shared `landingPathForRole()`, so the two paths cannot disagree. It never overrides a deep link and never loops on `/admin` |
| Console page | `src/app/admin/page.tsx` (`src/lib/admin.ts`) | server-renders the console or the 403 screen — it never redirects, so the *reason* is always visible |
| Console APIs | `src/lib/admin.ts` → `requireAdmin()` | validates the Supabase access token (`auth.getUser()`, verified — not merely decoded) and re-reads the role with the caller's own credentials |

Everything **fails closed**: a missing row, a missing table, an unreachable project or a
missing key all resolve to "not an administrator". A missing `profiles` row reads as
`user`, so nothing depends on the sign-up trigger having succeeded.

### The three locks on `role`

1. **Least privilege** — `authenticated` holds `select` and nothing else on
   `public.profiles`, so a member cannot promote themselves.
2. **Row Level Security** — enabled *and forced*, with a single policy
   (`profiles_select_own`, `id = auth.uid()`) that limits the read to the caller's own row.
3. **A trigger** — `guard_role_change()` (a `before update` guard) rejects any `role`
   change whose request is not the service role, so the lock still holds even if a later
   migration widens write access.

Roles are written only by the service role: the console's Promote/Demote, and the
bootstrap statement below.

### Bootstrapping the first administrator

```sql
insert into public.profiles (id, role)
select id, 'admin' from auth.users where email = 'you@example.com'
on conflict (id) do update set role = excluded.role;
```

Then sign out and back in (the role is re-read per request, so after that no further
re-login is needed). Everyone else is promoted or demoted from the console's **Users** tab.

---

## 🛡️ Security

| Control | Implementation |
| :-- | :-- |
| Row Level Security | `supabase/migrations/20261018120000_security_hardening.sql` — strict `auth.uid() = user_id` policies, `anon` privileges revoked |
| Console authorization | `supabase/migrations/20261019000000_profiles_roles.sql` — `public.profiles.role`; `requireAdmin()` re-checks it server-side on every `/admin` render and every `/api/admin/*` request |
| Role integrity | `profiles` is RLS-enabled *and forced* with `select`-only for `authenticated`, plus a `before update` trigger (`guard_role_change`) that rejects any `role` change that is not the service role |
| Auth gate | Edge proxy (`src/proxy.ts`) + `AuthGate` — no guest access to `/watch` |
| Rate limiting | Per-IP, per-endpoint buckets → `429` + `Retry-After` + `X-RateLimit-*` |
| Security headers | `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex` |
| Origin & URL guards | Allow-listed origins, SSRF-safe URL validation on proxied streams |
| Input hardening | Query-param length caps, pagination clamping, sanitised parsing |

> 📄 Full audit, residual risks and verification steps: [`SECURITY.md`](./SECURITY.md)

---

## 📜 Scripts

| Command | Description |
| :-- | :-- |
| `npm run dev` | Start the development server (Turbopack) |
| `npm run build` | Create an optimized production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npx tsc --noEmit` | Type-check the whole project without emitting |

---

## ☁️ Deployment on Vercel

1. Push the repository to GitHub.
2. Import the project in **[Vercel](https://vercel.com/new)** — framework auto-detected as Next.js.
3. Add the [required environment variables](#-environment-variables) to the project settings —
   including the server-only `SUPABASE_SERVICE_ROLE_KEY`, which the console needs for the user
   directory and Promote/Demote.
4. Deploy — the 5-minute stream-health cron is already declared in `vercel.json`.
5. Run **both** migrations once against your production Supabase project, in order:
   `20261018120000_security_hardening.sql`, then `20261019000000_profiles_roles.sql`.
6. Promote your first administrator with the bootstrap statement in
   [Roles & Access Control](#-roles--access-control-rbac), then sign out and back in.

---

## 📄 License & Credits

**Developed by [Sithum Thilina](https://github.com/sithumdevx)** — *Full-Stack Developer &
Interface Engineer*. © 2026 StreamPulse. All rights reserved.

- Primary developer & maintainer: **Sithum Thilina**
- Source code, design system and engineering: **Sithum Thilina**
- In-app developer profile: [`/developer`](./src/app/developer/page.tsx)

StreamPulse indexes **free-to-air public broadcasts**; all channel names, logos and streams
belong to their respective broadcasters. Icons by [Lucide](https://lucide.dev), fonts by
[Geist](https://vercel.com/font), streaming by [HLS.js](https://github.com/video-dev/hls.js).

---

<div align="center">

**Star ⭐ this repository if StreamPulse helps you cut the cord.**

*[StreamPulse](https://github.com/sithumdevx/Ipchannel) — Live TV, everywhere.*

</div>
