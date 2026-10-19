import type { Metadata } from "next";
import type { ComponentType } from "react";
import Link from "next/link";
import {
  Tv,
  Play,
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Mail,
  Globe2,
  Sparkles,
  Code2,
  Layers,
  Database,
  Zap,
  ShieldCheck,
  Film,
  Heart,
  Award,
  MapPin,
  Rocket,
  LayoutGrid,
} from "lucide-react";
import AdminDashboardLink from "@/components/AdminDashboardLink";

/* Brand marks (lucide no longer ships brand icons, so we inline them) */
function GitHubMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LinkedInMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function XMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zM17.61 20.644h2.039L6.486 3.24H4.298z" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   EDIT ME: swap these placeholder URLs for your real profiles.
--------------------------------------------------------------------------- */
const DEVELOPER = {
  name: "Sithum Thilina",
  role: "Full-Stack Developer & Interface Engineer",
  tagline:
    "Designing and engineering cinematic, production-grade web experiences — from streaming infrastructure to pixel-perfect UI.",
  location: "Available Worldwide · Remote",
  years: "5+",
  signature: "Built solo, end to end.",
};

const SOCIAL_LINKS: {
  label: string;
  handle: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  accent: string;
  description: string;
}[] = [
  {
    label: "GitHub",
    handle: "github.com/your-username",
    href: "https://github.com/your-username",
    icon: GitHubMark,
    accent: "text-white bg-slate-500/10 border-slate-400/20 hover:border-slate-300/50",
    description: "Source code, experiments & open-source contributions.",
  },
  {
    label: "LinkedIn",
    handle: "linkedin.com/in/your-handle",
    href: "https://www.linkedin.com/in/your-handle",
    icon: LinkedInMark,
    accent: "text-sky-300 bg-sky-500/10 border-sky-500/25 hover:border-sky-400/60",
    description: "Professional profile, experience & recommendations.",
  },
  {
    label: "X / Twitter",
    handle: "@your-handle",
    href: "https://x.com/your-handle",
    icon: XMark,
    accent: "text-slate-200 bg-slate-500/10 border-slate-500/25 hover:border-slate-300/60",
    description: "Build logs, launches & product thoughts.",
  },
  {
    label: "Portfolio",
    handle: "your-portfolio.dev",
    href: "https://your-portfolio.dev",
    icon: Globe2,
    accent: "text-cyan-300 bg-cyan-500/10 border-cyan-500/25 hover:border-cyan-400/60",
    description: "Selected case studies, demos and design work.",
  },
  {
    label: "Email",
    handle: "hello@your-domain.dev",
    href: "mailto:hello@your-domain.dev",
    icon: Mail,
    accent: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25 hover:border-emerald-400/60",
    description: "Projects, collaborations, and freelance inquiries.",
  },
];

const STACK = [
  { name: "Next.js 16", icon: Layers, tone: "text-white" },
  { name: "React 19", icon: Code2, tone: "text-cyan-400" },
  { name: "TypeScript", icon: Code2, tone: "text-indigo-400" },
  { name: "Tailwind CSS", icon: Sparkles, tone: "text-sky-400" },
  { name: "Supabase Auth", icon: Database, tone: "text-emerald-400" },
  { name: "HLS.js Player", icon: Film, tone: "text-rose-400" },
  { name: "Edge Proxy (CORS)", icon: ShieldCheck, tone: "text-amber-400" },
  { name: "Vercel Analytics", icon: Zap, tone: "text-purple-400" },
];

const CONTRIBUTIONS = [
  {
    title: "Adaptive HLS Playback",
    icon: Film,
    tone: "bg-rose-500/10 border-rose-500/20 text-rose-400",
    desc: "Deep-buffer tuning, auto bitrate level switching, and stall recovery for live 1080p streams in the browser.",
  },
  {
    title: "Server-Side CORS Bypass",
    icon: ShieldCheck,
    tone: "bg-amber-500/10 border-amber-500/20 text-amber-400",
    desc: "Next.js route handler that rewrites M3U8 manifests so cross-origin broadcasts play without browser origin errors.",
  },
  {
    title: "30,000+ Channel Index",
    icon: Database,
    tone: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    desc: "M3U parsing, category taxonomy, and sub-millisecond multi-token search across the full channel catalogue.",
  },
  {
    title: "Profiles, Favorites & Cloud Sync",
    icon: Heart,
    tone: "bg-rose-500/10 border-rose-500/20 text-rose-400",
    desc: "Mandatory Google or email + username sign-in with Supabase-backed favorites and per-device watch history.",
  },
  {
    title: "Cinematic Design System",
    icon: Sparkles,
    tone: "bg-cyan-500/10 border-cyan-500/20 text-cyan-400",
    desc: "Dark, glass-morphic UI language — ambient glow orbs, gradient accents, and motion tuned for a premium feel.",
  },
  {
    title: "Global Delivery",
    icon: Rocket,
    tone: "bg-purple-500/10 border-purple-500/20 text-purple-400",
    desc: "Edge-deployed on Vercel with analytics, streamed responses, and zero-config incremental static regeneration.",
  },
];

export const metadata: Metadata = {
  title: "Developer — Sithum Thilina | StreamPulse",
  description:
    "StreamPulse was designed, built, and maintained by Sithum Thilina — full-stack developer and interface engineer. Explore the tech stack, contributions, and social links.",
  alternates: { canonical: "/developer" },
};

export default function DeveloperPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#07080c] text-slate-100 overflow-x-hidden selection:bg-cyan-500 selection:text-black">
      {/* Top Glass Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-[#0a0d14]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 group-hover:scale-105 transition-transform">
              <Tv className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                  StreamPulse
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  FREE IPTV
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Live TV Everywhere</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/categories"
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold border border-slate-800 transition"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Categories</span>
            </Link>
            <Link
              href="/"
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold border border-slate-800 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Home</span>
            </Link>
            <Link
              href="/watch"
              className="px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs sm:text-sm shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition active:scale-95 flex items-center gap-1.5"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Watch Now</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* Cinematic Hero */}
      <section className="relative pt-32 pb-16 md:pt-40 md:pb-24 overflow-hidden">
        {/* Ambient glow orbs */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[600px] bg-gradient-to-tr from-cyan-500/15 via-indigo-600/15 to-purple-600/15 rounded-full blur-[130px] pointer-events-none" />
        <div className="absolute top-28 left-8 w-72 h-72 bg-cyan-600/10 rounded-full blur-[90px] pointer-events-none" />
        <div className="absolute top-40 right-8 w-72 h-72 bg-purple-600/10 rounded-full blur-[90px] pointer-events-none" />
        {/* Cinematic letterbox vignette */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center space-y-7">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <Sparkles className="w-3.5 h-3.5" />
            <span>Developed by {DEVELOPER.name}</span>
          </div>

          {/* Monogram */}
          <div className="mx-auto w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 p-[2px] shadow-2xl shadow-cyan-500/25">
            <div className="w-full h-full rounded-[20px] bg-[#0a0d14] flex items-center justify-center">
              <span className="text-4xl sm:text-5xl font-black tracking-tight bg-gradient-to-br from-cyan-300 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
                ST
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-xs sm:text-sm font-bold tracking-[0.3em] uppercase text-cyan-400/80">
              The Developer
            </p>
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight text-white leading-[1.05]">
              Sithum{" "}
              <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Thilina
              </span>
            </h1>
            <p className="text-sm sm:text-base md:text-lg text-slate-300 max-w-2xl mx-auto font-medium">
              {DEVELOPER.role}
            </p>
            <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
              {DEVELOPER.tagline}
            </p>
          </div>

          {/* Quick facts */}
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/70 border border-slate-800 text-slate-300">
              <Award className="w-3.5 h-3.5 text-cyan-400" />
              {DEVELOPER.years}+ Years Building For The Web
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/70 border border-slate-800 text-slate-300">
              <MapPin className="w-3.5 h-3.5 text-purple-400" />
              {DEVELOPER.location}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/70 border border-slate-800 text-slate-300">
              <Code2 className="w-3.5 h-3.5 text-emerald-400" />
              {DEVELOPER.signature}
            </span>
          </div>
        </div>
      </section>

      {/* Contributions Grid */}
      <section className="py-16 md:py-24 border-t border-white/5 bg-[#0a0d14]/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold border border-cyan-500/20">
              <Rocket className="w-3.5 h-3.5" />
              Crafted Inside StreamPulse
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              What I Built
            </h2>
            <p className="text-sm text-slate-400">
              Every layer of StreamPulse — streaming engine, proxy, data layer, and interface —
              designed and engineered as one cohesive product.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {CONTRIBUTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-cyan-500/10 space-y-3"
                >
                  <div
                    className={`w-12 h-12 rounded-2xl border flex items-center justify-center ${item.tone}`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white">{item.title}</h3>
                  <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="py-16 md:py-24 border-t border-white/5">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-semibold border border-indigo-500/20">
              <Layers className="w-3.5 h-3.5" />
              Powered By
            </div>
            <h2 className="text-3xl font-bold text-white tracking-tight">The Stack</h2>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {STACK.map((tech) => {
              const Icon = tech.icon;
              return (
                <span
                  key={tech.name}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-cyan-500/40 hover:bg-slate-800/70 transition text-sm font-semibold text-slate-200"
                >
                  <Icon className={`w-4 h-4 ${tech.tone}`} />
                  {tech.name}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* Social / Portfolio Links */}
      <section className="py-16 md:py-24 border-t border-white/5 bg-[#0a0d14]/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold border border-cyan-500/20">
              <Heart className="w-3.5 h-3.5" />
              Connect
            </div>
            <h2 className="text-3xl font-bold text-white tracking-tight">
              Find Me Online
            </h2>
            <p className="text-sm text-slate-400 max-w-xl mx-auto">
              Have a project in mind, or just want to talk shop? These are the fastest ways to
              reach me.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SOCIAL_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.href.startsWith("mailto:") ? undefined : "_blank"}
                  rel="noreferrer"
                  className="group p-5 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-cyan-500/10 flex items-start gap-4"
                >
                  <div
                    className={`w-11 h-11 shrink-0 rounded-2xl border flex items-center justify-center transition ${link.accent}`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-white group-hover:text-cyan-300 transition">
                        {link.label}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 transition" />
                    </div>
                    <p className="text-[11px] text-cyan-400/90 font-medium truncate">
                      {link.handle}
                    </p>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      {link.description}
                    </p>
                  </div>
                </a>
              );
            })}

            {/* Back to StreamPulse card */}
            <Link
              href="/watch"
              className="group p-5 rounded-3xl bg-gradient-to-br from-cyan-500/15 via-indigo-500/10 to-purple-500/15 border border-cyan-500/30 hover:border-cyan-400/60 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-cyan-500/15 flex items-start gap-4"
            >
              <div className="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-black shadow-lg shadow-cyan-500/25">
                <Play className="w-5 h-5 fill-current" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm text-white group-hover:text-cyan-300 transition">
                    Watch StreamPulse
                  </span>
                  <ChevronRight className="w-4 h-4 text-cyan-400 group-hover:translate-x-1 transition-transform" />
                </div>
                <p className="text-[11px] text-cyan-300 font-medium">30,000+ live channels</p>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  Jump straight into the channel browser and player.
                </p>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-slate-950 py-10 text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center text-black font-bold">
              <Tv className="w-4 h-4" />
            </div>
            <span className="font-bold text-slate-300">StreamPulse IPTV</span>
            <span>•</span>
            <span>
              Designed &amp; developed by{" "}
              <span className="text-cyan-400 font-semibold">{DEVELOPER.name}</span>
            </span>
          </div>

          <div className="flex items-center gap-6 text-slate-400">
            <Link href="/" className="hover:text-cyan-400 transition">
              Home
            </Link>
            <Link href="/categories" className="hover:text-cyan-400 transition">
              Categories
            </Link>
            <Link href="/watch" className="hover:text-cyan-400 transition">
              Watch TV
            </Link>
            <Link href="/about" className="hover:text-cyan-400 transition">
              About
            </Link>
            {/* Administrators only — renders nothing for ordinary members. */}
            <AdminDashboardLink
              className="hover:text-amber-400 transition font-semibold text-amber-300/90"
              label="Admin Console"
            />
          </div>
        </div>
      </footer>
    </div>
  );
}
