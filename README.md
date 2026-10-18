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
filtering and a glassmorphism dark/light UI.

| Route | Purpose |
| :-- | :-- |
| `/` | Cinematic landing page — hero spotlight, category rails, quick-browse grid |
| `/watch` | Protected player view — video player, Now Playing panel, filters, infinite grid |
| `/developer` | Custom developer profile — author details, tech stack, engineering highlights |
| `/about` | Redirects to `/developer` |
| `/api/channels` | Parsed, health-filtered channel catalogue with search/category/country filters |
| `/api/proxy` | Hardened CORS-bypass proxy for M3U8 manifests |
| `/api/health` | Stream-health sweep (cron) + on-demand probe + aggregate counters |

---

## ✨ Key Features

### 🔐 Mandatory Authentication
Secure, **account-only** access powered by Supabase Auth — **Google Sign-In** (OAuth) and
**Email / Username registration** with email confirmation. **No guest mode:** unauthenticated
visitors are bounced by the edge proxy to the sign-in wall before ever reaching the player.

### ⚡ Instant Post-Login Navigation
Fresh sign-ins are automatically routed straight into the channel player (`/watch`) — via the
OAuth callback (`/auth/callback?next=/watch`) and the profile sync layer — so returning users
land on the action, not on a passive landing page.

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

---

## 🧰 Tech Stack

| Layer | Technology |
| :-- | :-- |
| **Framework** | Next.js 16 — App Router, Route Handlers, Edge Proxy, Turbopack |
| **Language** | TypeScript (strict), React 19 |
| **Styling** | Tailwind CSS 4 (design tokens), Lucide Icons, glassmorphism UI, custom keyframe animations |
| **Player** | HLS.js with adaptive bitrate, PiP, quality switching |
| **Backend & Auth** | Supabase — Auth (Google OAuth + email), PostgreSQL, Row Level Security |
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
│   │   ├── developer/page.tsx     # Developer profile
│   │   ├── api/channels/          # Catalogue + search/category/country filters
│   │   ├── api/proxy/             # CORS-bypass M3U8 proxy
│   │   ├── api/health/            # Stream-health cron & probes
│   │   └── auth/callback/         # OAuth/email confirmation → /watch
│   ├── components/                # VideoPlayer, ChannelCard, CountryFilter, AuthModal …
│   ├── context/                   # ProfileContext (favorites/history), ThemeContext
│   ├── lib/                       # m3u-parser, stream-health, countries, security/*
│   ├── proxy.ts                   # Edge middleware: auth gate, rate limits, headers
│   └── types/iptv.ts              # Shared channel models
├── supabase/
│   ├── migrations/                # RLS + security hardening SQL
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

### 3 · Enable Row Level Security

In the Supabase Dashboard → **SQL Editor**, run the migration, then verify it:

```bash
# 1. Paste & Run:  supabase/migrations/20261018120000_security_hardening.sql
# 2. Verify (read-only): supabase/audit_rls.sql
```

Expected: every `public` table reports `rls_enabled = t`, `rls_forced = t`, and the audit
prints `OK: all public tables have RLS enabled.` — details in [`SECURITY.md`](./SECURITY.md).

### 4 · Run the development server

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)**, create an account (Google or email),
and you will be redirected straight into the player at **`/watch`**.

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
| `RATE_LIMIT_PROXY_PER_MIN` | `600` | Per-IP proxy requests / minute |
| `RATE_LIMIT_CHANNELS_PER_MIN` | `60` | Per-IP catalogue requests / minute |
| `RATE_LIMIT_API_PER_MIN` | `120` | Per-IP generic API requests / minute |

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

## 🛡️ Security

| Control | Implementation |
| :-- | :-- |
| Row Level Security | `supabase/migrations/20261018120000_security_hardening.sql` — strict `auth.uid() = user_id` policies, `anon` privileges revoked |
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

---

## ☁️ Deployment on Vercel

1. Push the repository to GitHub.
2. Import the project in **[Vercel](https://vercel.com/new)** — framework auto-detected as Next.js.
3. Add the [required environment variables](#-environment-variables) to the project settings.
4. Deploy — the 5-minute stream-health cron is already declared in `vercel.json`.
5. Run the RLS migration once against your production Supabase project.

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
