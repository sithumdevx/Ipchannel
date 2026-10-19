"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Ban,
  ChartColumn,
  CircleCheck,
  CircleX,
  Database,
  Earth,
  Gauge,
  HeartPulse,
  Info,
  Megaphone,
  Radio,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  Signal,
  Trash2,
  TriangleAlert,
  Users,
  Wrench,
} from "lucide-react";
import { countryFlag } from "@/lib/countries";
import type {
  AdminAction,
  AdminActionResult,
  AdminStats,
} from "@/types/admin";
import {
  ActivityChart,
  BarList,
  CategoryPie,
  Donut,
  Legend,
  Meter,
  MiniBars,
  PALETTE,
  Panel,
  RatioChart,
  StatCard,
  StatusChip,
  ViewsChart,
  type BarRow,
  type DonutSegment,
} from "@/components/admin/charts";
import StreamsPanel from "./StreamsPanel";
import UsersPanel from "./UsersPanel";
import BroadcastPanel from "./BroadcastPanel";

/**
 * The admin console.
 *
 * One aggregated payload from `/api/admin/stats` drives every tab, and it is
 * re-polled while the tab is visible so the numbers track a running system
 * rather than a snapshot from page load. Mutations go to `/api/admin/actions`
 * (and `/api/admin/users`, `/api/admin/announcement`), each of which answers
 * with a *refreshed* snapshot — so an action never leaves the console showing a
 * stale frame of what it just changed.
 *
 * Design notes:
 *  - **Actions are idempotent-in-effect and bounded server-side.** The buttons
 *    only name an action from a fixed allow-list; the runtime budget and the
 *    scan limits live on the server, so a double-click cannot escalate them.
 *  - **Every capability states its scope.** Presence, metrics and proxy logs are
 *    per-instance and reset on cold start. The console says so next to the
 *    number instead of implying a durability the deployment does not have.
 */

const POLL_MS = 15_000;
const COUNTRY_ROWS = 10;

type TabId = "overview" | "streams" | "users" | "broadcast" | "system";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <Gauge className="w-3.5 h-3.5" /> },
  { id: "streams", label: "Streams", icon: <Radio className="w-3.5 h-3.5" /> },
  { id: "users", label: "Users", icon: <Users className="w-3.5 h-3.5" /> },
  { id: "broadcast", label: "Broadcast", icon: <Megaphone className="w-3.5 h-3.5" /> },
  { id: "system", label: "System", icon: <ServerCog className="w-3.5 h-3.5" /> },
];

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

function formatTime(epochMs: number): string {
  if (!epochMs) return "never";
  return new Date(epochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAge(epochMs: number): string {
  if (!epochMs) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/* -------------------------------------------------------------------------- */
/* Small shared pieces                                                         */
/* -------------------------------------------------------------------------- */

function Badge({
  children,
  accent = "cyan",
}: {
  children: React.ReactNode;
  accent?: keyof typeof PALETTE;
}) {
  const color = PALETTE[accent];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${color}1a`, borderColor: `${color}40`, color }}
    >
      {children}
    </span>
  );
}

/** A footnote explaining the scope of a per-instance metric. */
function ScopeNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[10px] text-slate-600 leading-relaxed mt-3">
      <Info className="w-3 h-3 flex-shrink-0 mt-px" />
      <span>{children}</span>
    </p>
  );
}

const SOURCE_LABEL: Record<AdminStats["channels"]["source"], string> = {
  live: "Live upstream playlist",
  cache: "Cached playlist",
  fallback: "Bootstrap list",
};

const SOURCE_ACCENT: Record<AdminStats["channels"]["source"], "emerald" | "cyan" | "amber"> = {
  live: "emerald",
  cache: "cyan",
  fallback: "amber",
};

/* -------------------------------------------------------------------------- */
/* Actions strip                                                               */
/* -------------------------------------------------------------------------- */

interface ActionState {
  running: AdminAction | null;
  message: string | null;
  tone: "ok" | "error";
}

const ACTION_BUTTONS: {
  id: AdminAction;
  label: string;
  icon: React.ReactNode;
  accent: string;
  description: string;
}[] = [
  {
    id: "health-check",
    label: "Run Health Check",
    icon: <Signal className="w-3.5 h-3.5" />,
    accent: "#22d3ee",
    description: "Re-probe a batch of streams inline (~400, bounded to 25s).",
  },
  {
    id: "deep-health-check",
    label: "Deep Scan (all)",
    icon: <HeartPulse className="w-3.5 h-3.5" />,
    accent: "#34d399",
    description: "Wider sweep across up to 1,500 streams, bounded to 45s.",
  },
  {
    id: "refresh-cache",
    label: "Refresh Cache",
    icon: <RefreshCw className="w-3.5 h-3.5" />,
    accent: "#818cf8",
    description: "Drop the channel catalogue and re-download the playlist now.",
  },
  {
    id: "clear-caches",
    label: "Clear Caches",
    icon: <Trash2 className="w-3.5 h-3.5" />,
    accent: "#fbbf24",
    description: "Clear the catalogue and cached media segments.",
  },
  {
    id: "flush-states",
    label: "Flush States",
    icon: <Wrench className="w-3.5 h-3.5" />,
    accent: "#fb7185",
    description: "Reset health verdicts, segment cache and every counter.",
  },
];

function ActionButton({
  action,
  disabled,
  busy,
  onClick,
}: {
  action: (typeof ACTION_BUTTONS)[number];
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={action.description}
      className="group flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition hover:bg-white/[0.07] hover:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span
        className="w-8 h-8 flex-shrink-0 rounded-xl border flex items-center justify-center transition group-hover:scale-105"
        style={{ background: `${action.accent}1f`, borderColor: `${action.accent}40`, color: action.accent }}
      >
        {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : action.icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold text-slate-200">{action.label}</span>
        <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">
          {action.description}
        </span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Console                                                                     */
/* -------------------------------------------------------------------------- */

export default function AdminConsole({ adminName, adminId }: { adminName: string; adminId: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("overview");
  const [action, setAction] = useState<ActionState>({ running: null, message: null, tone: "ok" });
  const [lastUpdated, setLastUpdated] = useState(0);

  /** Guards against overlapping polls when a request is slow. */
  const inFlight = useRef(false);

  /**
   * Fetch the aggregate snapshot.
   *
   * Written as a promise chain rather than `async`/`await`: the rule React
   * ships (`react-hooks/set-state-in-effect`) is right that setting state
   * *synchronously* from an effect causes cascading renders, and it cannot see
   * past `await` inside a local `async` helper. Putting every `setState` inside
   * a `.then`/`.catch`/`.finally` callback makes the async boundary explicit to
   * both the linter and a reader — which is exactly the "subscribe to an
   * external system, then update" shape the effect is supposed to have.
   */
  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;

    fetch("/api/admin/stats", { cache: "no-store" })
      .then((response) => {
        if (response.status === 401) {
          setError("Your session expired. Sign in again as an administrator.");
          return null;
        }
        if (response.status === 403) {
          setError("This account is no longer on the admin allowlist.");
          return null;
        }
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json() as Promise<AdminStats>;
      })
      .then((data) => {
        if (!data) return; // an auth failure already set the message
        setStats(data);
        setError(null);
        setLastUpdated(Date.now());
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load statistics.");
      })
      .finally(() => {
        setLoading(false);
        inFlight.current = false;
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Re-poll while the tab is visible, and refresh immediately on refocus — a
  // console left open in a background tab is otherwise always stale.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);

    const onFocus = () => load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const runAction = useCallback(
    async (next: AdminAction) => {
      if (action.running) return;

      setAction({ running: next, message: null, tone: "ok" });
      try {
        const response = await fetch("/api/admin/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: next }),
        });

        const payload = (await response.json()) as AdminActionResult & { error?: string };

        if (!response.ok) throw new Error(payload.error ?? `Action failed (${response.status})`);

        setStats(payload.stats);
        setLastUpdated(Date.now());
        setAction({ running: null, message: payload.summary, tone: "ok" });
      } catch (err) {
        setAction({
          running: null,
          message: err instanceof Error ? err.message : "Action failed.",
          tone: "error",
        });
      }
    },
    [action.running]
  );

  /* ---------------------------------------------------------------------- */
  /* Derived values                                                          */
  /* ---------------------------------------------------------------------- */

  const uptime = useMemo(
    () => (stats ? stats.proxy.uptime : 1),
    [stats]
  );

  const countryRows: BarRow[] = useMemo(
    () =>
      (stats?.countries ?? []).slice(0, COUNTRY_ROWS).map((row) => ({
        key: row.code,
        label: row.name,
        value: row.count,
        prefix: <span className="text-sm leading-none">{countryFlag(row.code)}</span>,
        accent: "indigo" as const,
      })),
    [stats]
  );

  const healthSegments: DonutSegment[] = useMemo(() => {
    if (!stats) return [];
    return [
      { label: "Online", value: stats.streams.online, color: PALETTE.emerald },
      { label: "Offline", value: stats.streams.offline, color: PALETTE.rose },
      { label: "Unverified", value: stats.streams.unknown, color: PALETTE.slate },
    ].filter((segment) => segment.value > 0);
  }, [stats]);

  const signups: { label: string; value: number }[] = useMemo(
    () =>
      (stats?.users.last7Days ?? []).map((row) => ({
        label: row.date.slice(8, 10),
        value: row.count,
      })),
    [stats]
  );

  /* ---------------------------------------------------------------------- */
  /* Non-happy states                                                        */
  /* ---------------------------------------------------------------------- */

  if (error && !stats) {
    return (
      <Shell adminName={adminName} tabs={TABS} tab={tab} onTab={setTab} lastUpdated={0} stats={null}>
        <div className="mx-auto max-w-md rounded-3xl border border-rose-500/30 bg-[#0b0e16]/80 p-8 text-center">
          <CircleX className="w-10 h-10 text-rose-400 mx-auto" />
          <h1 className="mt-4 text-lg font-bold text-slate-100">Console unavailable</h1>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">{error}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => load()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/10 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
            <Link
              href="/watch"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/10 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to the app
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (loading && !stats) {
    return (
      <Shell adminName={adminName} tabs={TABS} tab={tab} onTab={setTab} lastUpdated={0} stats={null}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="rounded-3xl border border-white/10 bg-[#0b0e16]/80 p-5 animate-pulse"
            >
              <div className="h-3 w-24 rounded bg-white/10" />
              <div className="mt-4 h-8 w-20 rounded bg-white/10" />
              <div className="mt-4 h-3 w-32 rounded bg-white/[0.07]" />
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          Collecting system statistics…
        </p>
      </Shell>
    );
  }

  if (!stats) return null;

  return (
    <Shell
      adminName={adminName}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      lastUpdated={lastUpdated}
      stats={stats}
    >
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <TriangleAlert className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => load()}
            className="text-[11px] font-bold uppercase tracking-wider underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* ============================ ACTIONS ============================ */}
      <section className="rounded-3xl border border-white/10 bg-[#0b0e16]/80 backdrop-blur-xl p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
        <header className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="mt-0.5 w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-tr from-amber-500/20 to-rose-500/20 border border-white/10 flex items-center justify-center text-amber-300">
              <Wrench className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-100 tracking-tight">
                Quick Actions
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Every action is server-bounded and returns a refreshed snapshot.
              </p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {ACTION_BUTTONS.map((entry) => (
            <ActionButton
              key={entry.id}
              action={entry}
              disabled={action.running !== null}
              busy={action.running === entry.id}
              onClick={() => void runAction(entry.id)}
            />
          ))}
        </div>

        {action.message && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs leading-relaxed ${
              action.tone === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}
            role="status"
          >
            {action.tone === "ok" ? (
              <CircleCheck className="w-4 h-4 flex-shrink-0 mt-px" />
            ) : (
              <CircleX className="w-4 h-4 flex-shrink-0 mt-px" />
            )}
            <span>{action.message}</span>
          </div>
        )}
      </section>

      {/* ============================= STATS ============================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
        <StatCard
          label="Total Active Users"
          value={stats.users.available ? formatCount(stats.users.total) : "—"}
          hint={
            stats.users.available
              ? `${formatCount(stats.users.activeToday)} today · ${formatCount(stats.users.activeWeek)} in 7 days`
              : stats.users.reason ?? "Not configured"
          }
          icon={<Users className="w-4 h-4" />}
          accent="indigo"
          footer={
            stats.users.approximate ? (
              <span className="text-[10px] text-amber-400/80">
                Sign-up histogram sampled from the first pages of the directory.
              </span>
            ) : undefined
          }
        />

        <StatCard
          label="Live Channels"
          value={formatCount(stats.channels.total)}
          hint={`${formatCount(stats.streams.online)} online · ${formatCount(stats.streams.offline)} offline`}
          icon={<Radio className="w-4 h-4" />}
          accent="cyan"
          badge={<Badge accent={SOURCE_ACCENT[stats.channels.source]}>{SOURCE_LABEL[stats.channels.source]}</Badge>}
        />

        <StatCard
          label="System Health Rate"
          value={formatPercent(uptime)}
          hint={`${formatCount(stats.proxy.total)} proxy requests · ${formatCount(stats.proxy.failures)} failed (15 min)`}
          icon={<HeartPulse className="w-4 h-4" />}
          accent={uptime >= 0.99 ? "emerald" : uptime >= 0.9 ? "amber" : "rose"}
          badge={
            stats.health.trusted === false ? (
              <Badge accent="amber">Verdicts untrusted — probes blocked?</Badge>
            ) : undefined
          }
        />

        <StatCard
          label="Automated Health Checks"
          value={formatCount(stats.metrics.health.checksAutomated)}
          hint={`${formatCount(stats.metrics.health.checksManual)} manual · p95 ${formatMs(
            stats.metrics.health.p95LatencyMs
          )}`}
          icon={<Activity className="w-4 h-4" />}
          accent="purple"
          footer={
            <Meter ratio={stats.metrics.health.liveRatio} accent="emerald" />
          }
        />
      </div>

      {/* ============================= TABS ============================== */}
      <div className="mt-4">
        {tab === "overview" && (
          <OverviewTab
            stats={stats}
            countryRows={countryRows}
            healthSegments={healthSegments}
            signups={signups}
            uptime={uptime}
          />
        )}

        {tab === "streams" && <StreamsPanel onStats={setStats} />}

        {tab === "users" && <UsersPanel adminId={adminId} />}

        {tab === "broadcast" && (
          <BroadcastPanel
            announcement={stats.announcement}
            onPublish={(announcement) =>
              // Splice just the banner into the cached snapshot: publishing
              // must not silently reset every other number on the console.
              setStats((current) => (current ? { ...current, announcement } : current))
            }
          />
        )}

        {tab === "system" && <SystemTab stats={stats} />}
      </div>
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                       */
/* -------------------------------------------------------------------------- */

function Shell({
  adminName,
  tabs,
  tab,
  onTab,
  lastUpdated,
  stats,
  children,
}: {
  adminName: string;
  tabs: { id: TabId; label: string; icon: React.ReactNode }[];
  tab: TabId;
  onTab: (id: TabId) => void;
  lastUpdated: number;
  stats: AdminStats | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#05060a] text-slate-200">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-56 left-1/2 -translate-x-1/2 w-[1000px] h-[1000px] rounded-full bg-gradient-to-tr from-cyan-500/10 via-indigo-600/10 to-purple-600/10 blur-[150px]" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] rounded-full bg-gradient-to-tr from-fuchsia-600/10 to-transparent blur-[140px]" />
      </div>

      <header className="relative border-b border-white/10 bg-[#05060a]/85 backdrop-blur-xl sticky top-0 z-30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3.5 flex items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 flex-shrink-0 rounded-2xl bg-gradient-to-tr from-cyan-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <ShieldAlert className="w-4.5 h-4.5 text-black" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-black text-slate-50 tracking-tight truncate">
                StreamPulse Admin Console
              </h1>
              <p className="text-[10px] text-slate-500 truncate">
                {adminName}
                {stats && (
                  <>
                    {" · "}generated {formatTime(Date.parse(stats.generatedAt))}
                  </>
                )}
              </p>
            </div>
          </div>

          <nav className="ml-auto hidden lg:flex items-center gap-1">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onTab(entry.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  tab === entry.id
                    ? "bg-white/10 text-slate-50 border border-white/15"
                    : "text-slate-400 border border-transparent hover:text-slate-200 hover:bg-white/5"
                }`}
              >
                {entry.icon}
                {entry.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto lg:ml-0 flex items-center gap-3">
            <span className="hidden sm:block text-[10px] text-slate-600 tabular-nums">
              {lastUpdated ? `updated ${formatAge(lastUpdated)}` : ""}
            </span>
            <Link
              href="/watch"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-slate-300 hover:bg-white/10 transition"
              title="Back to the app"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">App</span>
            </Link>
          </div>
        </div>

        {/* Mobile tab row */}
        <div className="lg:hidden border-t border-white/10 overflow-x-auto">
          <div className="flex items-center gap-1 px-4 py-2 min-w-max">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onTab(entry.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition ${
                  tab === entry.id
                    ? "bg-white/10 text-slate-50"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {entry.icon}
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-4 sm:px-6 py-6 pb-16">{children}</main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview tab                                                                */
/* -------------------------------------------------------------------------- */

function OverviewTab({
  stats,
  countryRows,
  healthSegments,
  signups,
  uptime,
}: {
  stats: AdminStats;
  countryRows: BarRow[];
  healthSegments: DonutSegment[];
  signups: { label: string; value: number }[];
  uptime: number;
}) {
  const judged = stats.streams.online + stats.streams.offline;

  return (
    <>
      {/* ======================== ACTIVITY CHARTS ======================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel
          title="24-Hour Traffic"
          subtitle="Proxy requests and stream views, hourly"
          icon={<ChartColumn className="w-4 h-4" />}
          className="lg:col-span-2"
        >
          <ActivityChart points={stats.metrics.series} />
          <ScopeNote>
            Hourly buckets are per server instance and reset on cold start, so this
            window shows the life of the current process rather than a durable
            24-hour history.
          </ScopeNote>
        </Panel>

        <Panel
          title="Request Success / Failure"
          subtitle="Share of each hour's proxy responses"
          icon={<Activity className="w-4 h-4" />}
        >
          <RatioChart points={stats.metrics.series} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Panel
          title="Active Stream Views"
          subtitle="Sessions that started watching, per hour"
          icon={<Radio className="w-4 h-4" />}
        >
          <ViewsChart points={stats.metrics.series} />
        </Panel>

        <Panel
          title="Health Verdicts"
          subtitle={`${formatCount(judged)} of ${formatCount(stats.channels.total)} streams verified`}
          icon={<HeartPulse className="w-4 h-4" />}
        >
          <div className="flex items-center gap-5">
            <Donut
              segments={healthSegments}
              size={140}
              thickness={14}
              centerLabel={formatPercent(judged === 0 ? 0 : stats.streams.online / Math.max(1, judged), 0)}
              centerHint="online"
            />
            <Legend
              items={healthSegments.map((segment) => ({
                label: segment.label,
                value: segment.value.toLocaleString(),
                color: segment.color,
              }))}
            />
          </div>
          <ScopeNote>
            Verdicts expire after {Math.round(stats.health.ttlMs / 60_000)} minutes. Streams never
            probed show as Unverified rather than Offline.
          </ScopeNote>
        </Panel>

        <Panel
          title="Proxy Uptime"
          subtitle={`Last ${Math.round(stats.proxy.windowMs / 60_000)} minutes`}
          icon={<Signal className="w-4 h-4" />}
        >
          <div className="text-4xl font-black text-slate-50 tabular-nums">
            {formatPercent(uptime, 2)}
          </div>
          <div className="mt-3">
            <Meter ratio={uptime} accent={uptime >= 0.99 ? "emerald" : uptime >= 0.9 ? "amber" : "rose"} />
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {stats.proxy.byStatus.length === 0 ? (
              <span className="text-[10px] text-slate-500">No proxy traffic in the window.</span>
            ) : (
              stats.proxy.byStatus.slice(0, 6).map((row) => (
                <StatusChip key={row.status} status={row.status} label={`${row.status} · ${row.count}`} />
              ))
            )}
          </div>
        </Panel>
      </div>

      {/* ========================= DISTRIBUTIONS ========================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Panel
          title="Channel Categories"
          subtitle={`${formatCount(stats.channels.categories)} categories in the catalogue`}
          icon={<ChartColumn className="w-4 h-4" />}
        >
          <CategoryPie data={stats.categories} />
        </Panel>

        <Panel
          title="Country Breakdown"
          subtitle="Where the catalogue's streams are licensed to serve"
          icon={<Earth className="w-4 h-4" />}
        >
          <BarList rows={countryRows} empty="No country metadata in the active playlist." />
          <ScopeNote>
            Derived from each channel&apos;s declared country. Playlist entries without country
            metadata are excluded rather than counted as Global.
          </ScopeNote>
        </Panel>

        <Panel
          title="Most Watched Channels"
          subtitle="Live concurrency × 3 + member favorites × 2"
          icon={<Users className="w-4 h-4" />}
        >
          <BarList
            rows={stats.topChannels.slice(0, 8).map((row) => ({
              key: row.id,
              label: row.name,
              value: row.viewers,
              suffix: `${row.favorites} saves`,
              accent: "amber" as const,
            }))}
            empty="Nobody is watching right now."
          />
          <ScopeNote>
            Concurrency is live and per-instance; favorites come from Supabase and are persistent.
            Both are combined because neither answers &quot;what is hot&quot; on its own.
          </ScopeNote>
        </Panel>
      </div>

      {/* ====================== SIGN-UPS + OVERVIEW ====================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <Panel
          title="Sign-ups (7 days)"
          subtitle={
            stats.users.available
              ? `From the Supabase user directory${stats.users.approximate ? " (sampled)" : ""}`
              : "Unavailable"
          }
          icon={<Users className="w-4 h-4" />}
        >
          {stats.users.available ? (
            <>
              <MiniBars points={signups} accent="indigo" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Today</p>
                  <p className="text-lg font-black text-slate-50 tabular-nums mt-1">
                    {formatCount(stats.users.activeToday)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">7 days</p>
                  <p className="text-lg font-black text-slate-50 tabular-nums mt-1">
                    {formatCount(stats.users.activeWeek)}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="py-6 text-center">
              <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                {stats.users.reason}
              </p>
              <p className="mt-3 text-[10px] text-slate-600">
                The count is hidden rather than shown as 0, which would be misleading.
              </p>
            </div>
          )}
        </Panel>

        <Panel
          title="Recent Proxy Errors"
          subtitle="Newest failures from the streaming path"
          icon={<TriangleAlert className="w-4 h-4" />}
          className="lg:col-span-2"
        >
          {stats.proxy.recent.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              No proxy failures in the window. Nothing to investigate.
            </p>
          ) : (
            <ul className="divide-y divide-white/5 max-h-64 overflow-y-auto pr-1">
              {stats.proxy.recent.slice(0, 12).map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 py-2.5">
                  <StatusChip status={entry.status} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-300 truncate font-medium">{entry.message}</p>
                    <p className="text-[10px] text-slate-600 truncate font-mono mt-0.5">
                      {entry.endpoint}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] text-slate-500 tabular-nums">{formatAge(entry.at)}</p>
                    <p className="text-[9px] text-slate-600 uppercase tracking-wider mt-0.5">
                      {entry.kind}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ScopeNote>
            Endpoints are stored as origin + path only — signed query strings are never logged.
            The log is in-memory and reset on cold start.
          </ScopeNote>
        </Panel>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* System tab                                                                  */
/* -------------------------------------------------------------------------- */

function SystemTab({ stats }: { stats: AdminStats }) {
  const { cache, metrics, health } = stats;

  const rows: { label: string; value: string; hint?: string }[] = [
    {
      label: "Channel catalogue",
      value: `${formatCount(cache.catalogue.channels)} channels`,
      hint: `age ${formatAge(cache.catalogue.fetchedAt)} · TTL ${Math.round(cache.catalogue.ttlMs / 60_000)} min${
        cache.catalogue.stale ? " · stale" : ""
      }${cache.catalogue.refreshing ? " · refreshing" : ""}`,
    },
    {
      label: "Segment cache",
      value: `${formatCount(cache.segments.entries)}/${formatCount(cache.segments.capacity)} chunks`,
      hint: `${formatBytes(cache.segments.bytes)} · hit rate ${formatPercent(
        cache.segments.hitRate,
        0
      )} · TTL ${Math.round(cache.segments.ttlMs / 60_000)} min`,
    },
    {
      label: "Health registry",
      value: `${formatCount(cache.health.tracked)} verdicts`,
      hint: `${formatCount(cache.health.watching)} watched · TTL ${Math.round(
        cache.health.ttlMs / 60_000
      )} min · last sweep ${formatAge(health.lastSweepAt)}`,
    },
    {
      label: "Viewer presence",
      value: `${formatCount(cache.presenceSessions)} sessions`,
      hint: `window ${Math.round(stats.viewers.windowMs / 1000)}s · peak ${formatCount(
        stats.viewers.peak
      )}`,
    },
    {
      label: "Health checks (all)",
      value: formatCount(metrics.health.checksTotal),
      hint: `${formatCount(metrics.health.checksAutomated)} automated · ${formatCount(
        metrics.health.checksManual
      )} manual`,
    },
    {
      label: "Probe verdicts",
      value: `${formatCount(metrics.health.liveVerdicts)} live / ${formatCount(
        metrics.health.deadVerdicts
      )} dead`,
      hint: `avg ${formatMs(metrics.health.avgLatencyMs)} · p95 ${formatMs(
        metrics.health.p95LatencyMs
      )}`,
    },
    {
      label: "Proxy requests (all)",
      value: formatCount(metrics.requestsTotal),
      hint: `${formatCount(metrics.failuresTotal)} failed · ${formatPercent(
        metrics.successRate,
        2
      )} success`,
    },
    {
      label: "Process uptime",
      value: formatAge(metrics.startedAt),
      hint: `started ${new Date(metrics.startedAt).toLocaleString()}`,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Cache & State"
          subtitle="What each layer is currently holding"
          icon={<Database className="w-4 h-4" />}
        >
          <dl className="space-y-3">
            {rows.slice(0, 4).map((row) => (
              <div
                key={row.label}
                className="flex items-baseline gap-3 rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3"
              >
                <dt className="text-xs text-slate-400 flex-shrink-0 w-36">{row.label}</dt>
                <dd className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-100 tabular-nums">
                    {row.value}
                  </span>
                  {row.hint && (
                    <span className="block text-[10px] text-slate-600 mt-0.5">{row.hint}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel
          title="Health Check History"
          subtitle="Every probe this process has completed"
          icon={<Activity className="w-4 h-4" />}
        >
          <dl className="space-y-3">
            {rows.slice(4).map((row) => (
              <div
                key={row.label}
                className="flex items-baseline gap-3 rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3"
              >
                <dt className="text-xs text-slate-400 flex-shrink-0 w-36">{row.label}</dt>
                <dd className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-100 tabular-nums">
                    {row.value}
                  </span>
                  {row.hint && (
                    <span className="block text-[10px] text-slate-600 mt-0.5">{row.hint}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
              Failure diagnostics by type
            </p>
            {stats.errors.length === 0 ? (
              <p className="text-xs text-slate-500">No failures recorded in this process.</p>
            ) : (
              <ul className="space-y-2">
                {stats.errors.map((group) => (
                  <li key={group.key} className="flex items-center gap-3">
                    <StatusChip status={group.status} label={String(group.status || "net")} />
                    <span className="text-xs text-slate-300 flex-1 truncate">{group.label}</span>
                    <span className="text-[10px] text-slate-600 uppercase tracking-wider">
                      {group.source}
                    </span>
                    <span className="text-xs font-bold text-slate-100 tabular-nums w-16 text-right">
                      {formatCount(group.count)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-4 rounded-3xl border border-white/10 bg-[#0b0e16]/80 p-5">
        <p className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
          <Ban className="w-3.5 h-3.5 flex-shrink-0 mt-px text-amber-400/70" />
          <span>
            Every metric above is held in process memory: presence, proxy telemetry, activity
            counters, the segment cache and the health registry all reset when this server instance
            is recycled. Nothing here is a durable audit trail, and the console never pretends it is.
            For persistent history, these counters would need to be written to a database on a
            schedule rather than read from RAM.
          </span>
        </p>
      </div>
    </>
  );
}
