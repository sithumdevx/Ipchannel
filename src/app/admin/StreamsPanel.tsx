"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  CircleX,
  Clock,
  Eye,
  MonitorPlay,
  Radio,
  RefreshCw,
  Search,
  Signal,
  TriangleAlert,
} from "lucide-react";
import type { AdminStats, AdminStreamRow, AdminStreamsResponse } from "@/types/admin";
import { PALETTE, Panel, StatCard, StatusChip } from "@/components/admin/charts";
import StreamPreviewModal from "./StreamPreviewModal";

/**
 * Stream health monitoring table.
 *
 * Answers the one question an operator opens this tab for: *which streams are
 * down, why, and when did we last learn that?* So failures sort first, the
 * column set is exactly status / last tested / latency / error, and each row is
 * clickable to play the stream — because a probe can only report that an origin
 * answered, never that it produced a watchable picture.
 *
 * Data lives on its own endpoint (`/api/admin/streams`) rather than in the stats
 * payload: the summary is small and polled every 15s, this is paged and searched
 * on demand across ten thousand-plus rows.
 */

const PER_PAGE = 25;

type StatusFilter = "all" | "online" | "offline" | "unknown";

const STATUS_TABS: { id: StatusFilter; label: string; color: keyof typeof PALETTE }[] = [
  { id: "all", label: "All", color: "slate" },
  { id: "offline", label: "Offline", color: "rose" },
  { id: "online", label: "Online", color: "emerald" },
  { id: "unknown", label: "Unverified", color: "amber" },
];

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

function statusCell(row: AdminStreamRow) {
  if (row.status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
        <CircleCheck className="w-3 h-3" />
        Online
      </span>
    );
  }
  if (row.status === "dead") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-300">
        <CircleX className="w-3 h-3" />
        Offline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-300">
      <Clock className="w-3 h-3" />
      Unverified
    </span>
  );
}

export default function StreamsPanel({ onStats }: { onStats: (stats: AdminStats) => void }) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminStreamsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<AdminStreamRow | null>(null);

  const inFlight = useRef(false);
  /** Debounce handle for the search box. */
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Promise-chain rather than `async`/`await` so the async boundary is visible
   * to `react-hooks/set-state-in-effect`: every `setState` sits in a
   * `.then`/`.catch`/`.finally` callback, never synchronously in the effect.
   */
  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;

    const params = new URLSearchParams({ status, page: String(page), perPage: String(PER_PAGE) });
    if (search.trim()) params.set("search", search.trim());

    fetch(`/api/admin/streams?${params.toString()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json() as Promise<AdminStreamsResponse>;
      })
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load streams.");
      })
      .finally(() => {
        setLoading(false);
        inFlight.current = false;
      });
  }, [status, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  // Changing filters must reset paging, or page 3 of "Offline" shows an empty
  // table while the count says there are results.
  const changeStatus = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
  };

  const changeSearch = (next: string) => {
    setSearch(next);
    setPage(1);
    if (debounce.current) clearTimeout(debounce.current);
  };

  const counts = data?.counts ?? { online: 0, offline: 0, unknown: 0 };
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Online"
          value={counts.online.toLocaleString()}
          hint="Answered a probe inside the TTL"
          icon={<Signal className="w-4 h-4" />}
          accent="emerald"
        />
        <StatCard
          label="Offline"
          value={counts.offline.toLocaleString()}
          hint="Confirmed not to answer (404/410/502/…)"
          icon={<CircleX className="w-4 h-4" />}
          accent="rose"
        />
        <StatCard
          label="Unverified"
          value={counts.unknown.toLocaleString()}
          hint="Never probed, or the verdict expired"
          icon={<Clock className="w-4 h-4" />}
          accent="amber"
        />
      </div>

      <Panel
        title="Stream Health Monitoring"
        subtitle="Failures sort first. Click a row to preview the stream."
        icon={<Radio className="w-4 h-4" />}
        className="mt-4"
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
                placeholder="Search name, category, URL…"
                aria-label="Search streams"
                className="w-44 sm:w-56 rounded-xl border border-white/10 bg-white/[0.04] pl-8 pr-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-500/50 focus:bg-white/[0.07] transition"
              />
            </div>
            <button
              type="button"
              onClick={() => load()}
              title="Reload the table"
              className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {STATUS_TABS.map((entry) => {
            const color = PALETTE[entry.color];
            const count =
              entry.id === "all"
                ? counts.online + counts.offline + counts.unknown
                : counts[entry.id === "online" ? "online" : entry.id === "offline" ? "offline" : "unknown"];

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => changeStatus(entry.id)}
                className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-bold transition"
                style={
                  status === entry.id
                    ? { background: `${color}1a`, borderColor: `${color}59`, color }
                    : {
                        background: "transparent",
                        borderColor: "rgba(255,255,255,0.1)",
                        color: "#64748b",
                      }
                }
              >
                {entry.label}
                <span className="tabular-nums opacity-80">{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <TriangleAlert className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-11 rounded-xl bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-10 text-center">
            {loading ? (
              <RefreshCw className="w-8 h-8 text-cyan-400/70 mx-auto animate-spin" />
            ) : (
              <CircleCheck className="w-8 h-8 text-emerald-400/70 mx-auto" />
            )}
            <p className="mt-3 text-sm text-slate-300 font-semibold">
              {loading
                ? "Refreshing stream health…"
                : search
                  ? "No streams match that search."
                  : "Nothing in this bucket."}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {loading
                ? "Fresh verdicts will appear as probes complete."
                : search
                ? "Clear the search box to see every stream."
                : status === "offline"
                  ? "No streams are currently confirmed offline."
                  : "Health verdicts are still being populated."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="pb-2.5 pr-3 font-semibold">Stream</th>
                  <th className="pb-2.5 pr-3 font-semibold">Status</th>
                  <th className="pb-2.5 pr-3 font-semibold">Last tested</th>
                  <th className="pb-2.5 pr-3 font-semibold text-right">Latency</th>
                  <th className="pb-2.5 pr-3 font-semibold">Error log</th>
                  <th className="pb-2.5 font-semibold text-right">Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.rows.map((row) => (
                  <tr
                    key={`${row.id}-${row.url}`}
                    onClick={() => setPreview(row)}
                    className="cursor-pointer hover:bg-white/[0.04] transition group"
                    title="Open a live preview"
                  >
                    <td className="py-2.5 pr-3 max-w-[240px]">
                      <p className="text-xs font-semibold text-slate-200 truncate group-hover:text-cyan-200 transition">
                        {row.name}
                      </p>
                      <p className="text-[10px] text-slate-600 truncate">
                        {row.category || "—"}
                        {row.country ? ` · ${row.country}` : ""}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3">{statusCell(row)}</td>
                    <td className="py-2.5 pr-3 text-xs text-slate-400 tabular-nums whitespace-nowrap">
                      {formatAge(row.checkedAt)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-xs tabular-nums">
                      {row.status === "unknown" ? (
                        <span className="text-slate-600">—</span>
                      ) : (
                        <span
                          className={
                            row.latencyMs > 4000
                              ? "text-amber-300"
                              : row.latencyMs > 1500
                                ? "text-slate-300"
                                : "text-emerald-300"
                          }
                        >
                          {row.latencyMs ? `${row.latencyMs} ms` : "—"}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 max-w-[220px]">
                      {row.status === "dead" ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-rose-300 truncate">
                          {row.httpStatus ? <StatusChip status={row.httpStatus} /> : null}
                          <span className="truncate text-slate-500">{row.error ?? "unknown"}</span>
                        </span>
                      ) : row.status === "unknown" ? (
                        <span className="text-[11px] text-slate-600">not probed recently</span>
                      ) : (
                        <span className="text-[11px] text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-slate-400 opacity-0 group-hover:opacity-100 group-hover:text-cyan-300 group-hover:border-cyan-500/40 transition">
                        <MonitorPlay className="w-3 h-3" />
                        Play
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paging */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 tabular-nums">
              {total.toLocaleString()} matching streams · page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-300 disabled:opacity-30 enabled:hover:bg-white/[0.08] transition"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-300 disabled:opacity-30 enabled:hover:bg-white/[0.08] transition"
              >
                Next
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
            <Eye className="w-3.5 h-3.5 flex-shrink-0 mt-px text-cyan-400/70" />
            <span>
              Latency and the HTTP code come from the last probe of each URL. Because a probe only
              proves the origin answered, the preview modal exists for the cases where &quot;200
              OK&quot; still does not mean watchable video — click any row to play it through the
              proxy.
            </span>
          </p>
        </div>
      </Panel>

      {preview && (
        <StreamPreviewModal
          row={preview}
          onClose={() => setPreview(null)}
          onRecheck={() => {
            // A verdict this modal just produced should reach the headline
            // numbers too, not only this table.
            void fetch("/api/admin/stats", { cache: "no-store" })
              .then((response) => (response.ok ? response.json() : null))
              .then((next) => {
                if (next) onStats(next as AdminStats);
              })
              .catch(() => undefined);
            load();
          }}
        />
      )}
    </>
  );
}
