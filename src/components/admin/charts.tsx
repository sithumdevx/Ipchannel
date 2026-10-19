"use client";

import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend as RcLegend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AdminActivityPoint } from "@/types/admin";

/**
 * Presentational building blocks for the admin console.
 *
 * Two tiers, deliberately:
 *
 *   - **Primitives** below — panels, stat cards, a donut, bar lists. Small,
 *     static, and cheap: they cost a few hundred bytes of markup instead of
 *     shipping a charting library for a dozen bars and a ring.
 *   - **Interactive charts** — `ActivityChart`, `RatioChart`, `ViewsChart` at the
 *     bottom, built on Recharts. These are the ones an operator actually wants to
 *     *explore*: 24 hourly buckets with a crosshair, hover readout, and a legend
 *     that toggles a series. Hand-rolling hover, focus, tooltip placement, and
 *     responsive sizing is where the real complexity lives, and it is complexity
 *     Recharts already pays for.
 *
 * The split keeps the bundle honest: the primitives are always on screen, while
 * Recharts is only pulled in by the charts that use it.
 *
 * The palette is intentionally fixed-dark. This is an operator console, not a
 * themed end-user surface, so it stays cinematic regardless of the visitor's
 * light/dark preference.
 */

export const PALETTE = {
  cyan: "#22d3ee",
  indigo: "#818cf8",
  purple: "#c084fc",
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
  sky: "#38bdf8",
  slate: "#64748b",
} as const;

export type AccentKey = keyof typeof PALETTE;

/* -------------------------------------------------------------------------- */
/* Panel + stat card                                                           */
/* -------------------------------------------------------------------------- */

export function Panel({
  title,
  subtitle,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-white/10 bg-[#0b0e16]/80 backdrop-blur-xl p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] ${className}`}
    >
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <span className="mt-0.5 w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-indigo-500/20 border border-white/10 flex items-center justify-center text-cyan-300">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-100 tracking-tight truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = "cyan",
  badge,
  footer,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  accent?: AccentKey;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const color = PALETTE[accent];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0e16]/80 backdrop-blur-xl p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
      {/* Ambient accent wash */}
      <div
        className="absolute -top-16 -right-12 w-40 h-40 rounded-full blur-3xl opacity-25 pointer-events-none"
        style={{ background: color }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {label}
          </p>
          <p className="mt-2 text-3xl font-black text-slate-50 leading-none tabular-nums">
            {value}
          </p>
          {hint && <p className="mt-2 text-[11px] text-slate-400">{hint}</p>}
        </div>
        <span
          className="w-10 h-10 flex-shrink-0 rounded-2xl border flex items-center justify-center"
          style={{ background: `${color}1f`, borderColor: `${color}40`, color }}
        >
          {icon}
        </span>
      </div>
      {badge && <div className="relative mt-3">{badge}</div>}
      {footer && <div className="relative mt-3">{footer}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Donut                                                                       */
/* -------------------------------------------------------------------------- */

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  size = 168,
  thickness = 16,
  centerLabel,
  centerHint,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: React.ReactNode;
  centerHint?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 50 - thickness / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={thickness}
        />
        {total > 0 &&
          segments.map((segment) => {
            const length = (segment.value / total) * circumference;
            const element = (
              <circle
                key={segment.label}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={thickness}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return element;
          })}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-black text-slate-50 tabular-nums">{centerLabel}</span>
        {centerHint && (
          <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mt-1">
            {centerHint}
          </span>
        )}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; value: React.ReactNode; color: string }[] }) {
  return (
    <ul className="space-y-2.5 min-w-0 flex-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2.5 text-xs">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: item.color }}
          />
          <span className="text-slate-400 truncate flex-1">{item.label}</span>
          <span className="font-bold text-slate-100 tabular-nums">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Horizontal bars                                                             */
/* -------------------------------------------------------------------------- */

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Rendered before the label (flag emoji, rank, icon…). */
  prefix?: React.ReactNode;
  /** Secondary value shown after the primary one. */
  suffix?: string;
  accent?: AccentKey;
}

export function BarList({ rows, empty = "No data yet." }: { rows: BarRow[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  if (rows.length === 0) {
    return <p className="text-xs text-slate-500 py-6 text-center">{empty}</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-center gap-2.5 text-xs mb-1.5">
            {row.prefix}
            <span className="text-slate-300 truncate flex-1" title={row.label}>
              {row.label}
            </span>
            {row.suffix && <span className="text-[10px] text-slate-500 tabular-nums">{row.suffix}</span>}
            <span className="font-bold text-slate-100 tabular-nums">{row.value.toLocaleString()}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                background: `linear-gradient(90deg, ${PALETTE[row.accent ?? "cyan"]}99, ${
                  PALETTE[row.accent ?? "cyan"]
                })`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Mini column chart                                                           */
/* -------------------------------------------------------------------------- */

export function MiniBars({
  points,
  accent = "cyan",
}: {
  points: { label: string; value: number }[];
  accent?: AccentKey;
}) {
  const max = Math.max(1, ...points.map((point) => point.value));
  const color = PALETTE[accent];

  return (
    <div>
      <div className="flex items-end gap-1.5 h-20">
        {points.map((point) => (
          <div
            key={point.label}
            className="flex-1 flex flex-col justify-end h-full group"
            title={`${point.label}: ${point.value}`}
          >
            <div
              className="w-full rounded-t-md transition-[height] duration-700 ease-out group-hover:brightness-125"
              style={{
                height: `${Math.max(2, (point.value / max) * 100)}%`,
                background: `linear-gradient(180deg, ${color}, ${color}44)`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {points.map((point) => (
          <span key={point.label} className="flex-1 text-center text-[9px] text-slate-500">
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

/** Colour a HTTP status the way an operator reads it: green → amber → red. */
export function statusAccent(status: number): AccentKey {
  if (status < 400) return "emerald";
  if (status === 404 || status === 410) return "amber";
  if (status >= 500) return "rose";
  return "indigo";
}

export function StatusChip({ status, label }: { status: number; label?: string }) {
  const accent = statusAccent(status);
  const color = PALETTE[accent];

  return (
    <span
      className="inline-flex items-center justify-center min-w-[42px] px-2 py-0.5 rounded-lg border text-[11px] font-bold tabular-nums"
      style={{ background: `${color}1a`, borderColor: `${color}4d`, color }}
    >
      {label ?? status}
    </span>
  );
}

export function Meter({ ratio, accent = "cyan" }: { ratio: number; accent?: AccentKey }) {
  const clamped = Math.min(1, Math.max(0, ratio));
  const color = PALETTE[accent];

  return (
    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${clamped * 100}%`, background: `linear-gradient(90deg, ${color}66, ${color})` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Interactive charts (Recharts)                                               */
/* -------------------------------------------------------------------------- */

/** Format an hourly bucket key as a clock label. */
function hourLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", hour12: false });
}

/** Tooltip shell matched to the console's palette (Recharts' default is light). */
function DarkTooltip({
  active,
  label,
  payload,
  unit,
}: {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string; value?: number | string; color?: string }[];
  unit?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-white/15 bg-[#0b0e16]/95 px-3 py-2 shadow-[0_16px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-sm">
      {label !== undefined && (
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          {typeof label === "number" ? hourLabel(label) : label}
        </p>
      )}
      <ul className="space-y-0.5">
        {payload.map((entry, index) => (
          <li key={entry.name ?? index} className="flex items-center gap-2 text-[11px]">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: entry.color ?? PALETTE.cyan }}
            />
            <span className="text-slate-400">{entry.name}</span>
            <span className="ml-auto font-bold text-slate-100 tabular-nums">
              {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
              {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Empty-state wrapper: ResponsiveContainer has no height at zero data. */
function ChartFrame({
  points,
  height = 220,
  empty = "No traffic recorded yet.",
  children,
}: {
  points: unknown[];
  height?: number;
  empty?: string;
  children: React.ReactNode;
}) {
  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-slate-500"
        style={{ height }}
      >
        {empty}
      </div>
    );
  }
  return <div style={{ height }}>{children}</div>;
}

/** X axis ticks for hourly buckets: label every third hour to stay readable. */
function ActivityXTicks({ points }: { points: { at: number }[] }) {
  return (
    <XAxis
      dataKey="at"
      type="number"
      domain={["dataMin", "dataMax"]}
      tickFormatter={hourLabel}
      tick={{ fill: "#64748b", fontSize: 10 }}
      axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
      tickLine={false}
      interval={Math.max(0, Math.floor(points.length / 6) - 1)}
    />
  );
}

/**
 * 24-hour request traffic and stream views.
 *
 * Two stacked areas on one axis: proxy requests (the server's own load) and
 * stream views (people starting to watch). They share a time axis because the
 * interesting question is whether viewing follows availability — a dip in
 * requests with flat views reads as a client-side problem, a dip in both reads
 * as an outage.
 */
export function ActivityChart({ points }: { points: AdminActivityPoint[] }) {
  const data = points.map((point) => ({
    at: point.at,
    requests: Math.max(0, point.requests),
    views: Math.max(0, point.views),
  }));
  const hasActivity = data.some((point) => point.requests > 0 || point.views > 0);

  return (
    <ChartFrame
      points={hasActivity ? data : []}
      empty="Telemetry history is still thin — no traffic has been recorded yet."
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="grad-requests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PALETTE.cyan} stopOpacity={0.55} />
              <stop offset="100%" stopColor={PALETTE.cyan} stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="grad-views" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PALETTE.indigo} stopOpacity={0.5} />
              <stop offset="100%" stopColor={PALETTE.indigo} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <ActivityXTicks points={points} />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            content={<DarkTooltip />}
            cursor={{ stroke: "rgba(255,255,255,0.18)", strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="requests"
            name="Requests"
            stroke={PALETTE.cyan}
            strokeWidth={2}
            fill="url(#grad-requests)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="views"
            name="Stream views"
            stroke={PALETTE.indigo}
            strokeWidth={2}
            fill="url(#grad-views)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Server request success/failure ratio over the same window.
 *
 * Successes and failures are stacked to 100% of that hour's traffic, so a quiet
 * hour and a busy hour look equally tall — the *shape* is what matters here.
 * One failure in an hour with a single request would otherwise be invisible on
 * an absolute scale, and it is exactly the case worth noticing.
 */
export function RatioChart({ points }: { points: AdminActivityPoint[] }) {
  const data = points
    .map((point) => ({
      at: point.at,
      ok: Math.max(0, point.requests - Math.max(0, point.failures)),
      failed: Math.min(Math.max(0, point.requests), Math.max(0, point.failures)),
    }))
    .filter((row) => row.ok > 0 || row.failed > 0);

  return (
    <ChartFrame points={data} empty="No requests yet — the proxy has served nothing.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -24 }} stackOffset="expand">
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <ActivityXTicks points={data} />
          <YAxis
            tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
          <RcLegend
            wrapperStyle={{ fontSize: 11, color: "#94a3b8", paddingTop: 6 }}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="ok" name="Success" stackId="a" fill={PALETTE.emerald} isAnimationActive={false} />
          <Bar dataKey="failed" name="Failed" stackId="a" fill={PALETTE.rose} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Stream views started per hour.
 *
 * Deliberately its own chart rather than a third series on `ActivityChart`:
 * views are small integers (tens) while proxy requests are large (thousands),
 * and one shared axis would flatten the views line into a floor.
 */
export function ViewsChart({ points }: { points: AdminActivityPoint[] }) {
  const data = points.filter((point) => point.views > 0);

  return (
    <ChartFrame points={data} empty="No stream views recorded in this window.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <ActivityXTicks points={data} />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
          <Bar dataKey="views" name="Views" fill={PALETTE.purple} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Channel category split as a pie, using Recharts rather than the hand-rolled
 * donut.
 *
 * Kept distinct from `Donut` because this one is interactive — hovering a slice
 * highlights it and the tooltip names the category with its exact count, which
 * the static ring cannot do once labels stop fitting.
 */
export function CategoryPie({
  data,
  size = 220,
}: {
  data: { name: string; count: number }[];
  size?: number;
}) {
  const slices = data.slice(0, 7);
  const other = data.slice(7).reduce((sum, row) => sum + row.count, 0);
  if (other > 0) {
    slices.push({ name: "Other", count: other });
  }

  const total = slices.reduce((sum, row) => sum + row.count, 0);
  const colors = [PALETTE.cyan, PALETTE.indigo, PALETTE.purple, PALETTE.emerald, PALETTE.amber, PALETTE.rose, PALETTE.sky, PALETTE.slate];

  if (slices.length === 0) {
    return <p className="text-xs text-slate-500 py-6 text-center">No categories yet.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div style={{ width: size, height: size }} className="relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="count"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1.5}
              stroke="rgba(5,6,10,0.9)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((slice, index) => (
                <Cell key={slice.name} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip content={<DarkTooltip unit=" channels" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-2xl font-black text-slate-50 tabular-nums">
            {total.toLocaleString()}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mt-1">
            channels
          </span>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 w-full">
        {slices.map((slice, index) => (
          <li key={slice.name} className="flex items-center gap-2 text-[11px] min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: colors[index % colors.length] }}
            />
            <span className="text-slate-400 truncate">{slice.name}</span>
            <span className="ml-auto font-bold text-slate-100 tabular-nums">
              {slice.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
