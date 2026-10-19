"use client";

import React, { useState } from "react";
import {
  CircleCheck,
  CircleX,
  Clock,
  Info,
  Megaphone,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { AdminAnnouncement, AdminAnnouncementLevel } from "@/types/admin";
import { PALETTE, Panel } from "@/components/admin/charts";

/**
 * Broadcast banner control.
 *
 * A site-wide banner is the one admin action with an immediate, unmissable,
 * *public* effect, so the form is written to make the consequences legible
 * before the button is pressed rather than after:
 *
 *  - the level picker previews the exact colours and labels visitors will see;
 *  - the expiry is a duration, not a timestamp, because "how long should this be
 *    up?" is the real question and a raw date hides the answer;
 *  - the live banner is shown as-is from the same store the public route reads,
 *    so what you see here is what every visitor is seeing right now;
 *  - "Clear" is a separate destructive action with its own confirmation, so a
 *    refresh click cannot silently remove a notice that is still relevant.
 *
 * Publishing writes through `/api/admin/announcement`, which validates the
 * payload server-side (including rejecting links that would turn a banner into
 * an open redirect) — the client checks here exist to give earlier feedback,
 * never to be the only check.
 */

const LEVELS: {
  id: AdminAnnouncementLevel;
  label: string;
  hint: string;
  color: string;
}[] = [
  { id: "info", label: "Info", hint: "Neutral update", color: PALETTE.sky },
  { id: "success", label: "Success", hint: "Resolved / back online", color: PALETTE.emerald },
  { id: "warning", label: "Warning", hint: "Degraded / maintenance", color: PALETTE.amber },
  { id: "critical", label: "Critical", hint: "Outage — needs attention", color: PALETTE.rose },
];

/** Durations offered in the picker: `0` means "no expiry (clear it manually)". */
const DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 180, label: "3 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "24 hours" },
  { minutes: 0, label: "Until cleared" },
];

function formatTime(epochMs: number): string {
  if (!epochMs) return "—";
  return new Date(epochMs).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAge(epochMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

interface Notice {
  tone: "ok" | "error";
  text: string;
}

export default function BroadcastPanel({
  announcement,
  onPublish,
}: {
  announcement: AdminAnnouncement | null;
  /** Receives the refreshed banner so the console's copy stays in step. */
  onPublish: (announcement: AdminAnnouncement | null) => void;
}) {
  const [message, setMessage] = useState(announcement?.message ?? "");
  const [detail, setDetail] = useState(announcement?.detail ?? "");
  const [level, setLevel] = useState<AdminAnnouncementLevel>(
    announcement?.level ?? "info"
  );
  const [href, setHref] = useState(announcement?.href ?? "");
  const [minutes, setMinutes] = useState(60);

  const [busy, setBusy] = useState<"publish" | "clear" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const trimmed = message.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 240;

  const publish = async () => {
    if (!valid || busy) return;
    setBusy("publish");
    setNotice(null);

    try {
      const response = await fetch("/api/admin/announcement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          level,
          detail: detail.trim() || undefined,
          href: href.trim() || undefined,
          expiresInMinutes: minutes,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        announcement?: AdminAnnouncement;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? `Publish failed (${response.status})`);
      }

      onPublish(payload.announcement ?? null);
      setNotice({
        tone: "ok",
        text:
          minutes === 0
            ? "Banner published. It stays up until you clear it."
            : `Banner published live for ${DURATIONS.find((d) => d.minutes === minutes)?.label ?? `${minutes} min`}.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not publish.",
      });
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy("clear");
    setNotice(null);

    try {
      const response = await fetch("/api/admin/announcement", { method: "DELETE" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? `Clear failed (${response.status})`);
      }

      onPublish(null);
      setNotice({ tone: "ok", text: "Banner cleared — visitors stop seeing it on their next poll." });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not clear the banner.",
      });
    } finally {
      setBusy(null);
    }
  };

  const previewColor =
    LEVELS.find((entry) => entry.id === level)?.color ?? PALETTE.sky;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* ------------------------------ FORM ------------------------------ */}
      <Panel
        title="Publish a broadcast"
        subtitle="Pushes to every connected visitor"
        icon={<Megaphone className="w-4 h-4" />}
        className="lg:col-span-3"
      >
        <label className="block">
          <span className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
            Message
            <span
              className={`tabular-nums ${trimmed.length > 240 ? "text-rose-400" : "text-slate-600"}`}
            >
              {trimmed.length}/240
            </span>
          </span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={2}
            placeholder="Scheduled maintenance begins in 10 minutes."
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-cyan-500/50 focus:bg-white/[0.07] transition resize-y"
          />
        </label>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Detail (optional)
            </span>
            <input
              type="text"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={160}
              placeholder="Streams may buffer for ~2 minutes."
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-500/50 focus:bg-white/[0.07] transition"
            />
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Link (optional)
            </span>
            <input
              type="text"
              value={href}
              onChange={(event) => setHref(event.target.value)}
              maxLength={300}
              placeholder="/about  ·  https://status.example.com"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-500/50 focus:bg-white/[0.07] transition"
            />
            <span className="block text-[10px] text-slate-600 mt-1">
              Must be a same-site path or an http(s) URL — anything else is rejected.
            </span>
          </label>
        </div>

        <div className="mt-4">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            Level
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {LEVELS.map((entry) => {
              const active = level === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setLevel(entry.id)}
                  className="rounded-2xl border px-3 py-2.5 text-left transition"
                  style={
                    active
                      ? {
                          background: `${entry.color}1a`,
                          borderColor: `${entry.color}66`,
                        }
                      : {
                          background: "rgba(255,255,255,0.03)",
                          borderColor: "rgba(255,255,255,0.1)",
                        }
                  }
                >
                  <span
                    className="block text-[11px] font-bold"
                    style={{ color: active ? entry.color : "#94a3b8" }}
                  >
                    {entry.label}
                  </span>
                  <span className="block text-[10px] text-slate-600 leading-tight mt-0.5">
                    {entry.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            Expires after
          </span>
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((entry) => {
              const active = minutes === entry.minutes;
              return (
                <button
                  key={entry.minutes}
                  type="button"
                  onClick={() => setMinutes(entry.minutes)}
                  className={`rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition ${
                    active
                      ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.07]"
                  }`}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
          {minutes === 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-400/80">
              <TriangleAlert className="w-3 h-3 flex-shrink-0 mt-px" />
              <span>
                No expiry: the banner stays visible until someone clears it. Fine for a notice that
                is always true, a trap for one that stops being true.
              </span>
            </p>
          )}
        </div>

        {/* Preview: exactly how it will render for a visitor. */}
        <div className="mt-5">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            Visitor preview
          </span>
          <div
            className="flex items-start gap-3 rounded-2xl border px-4 py-3"
            style={{
              background: `${previewColor}14`,
              borderColor: `${previewColor}4d`,
            }}
          >
            <span
              className="mt-0.5 w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: previewColor }}
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-100 break-words">
                {trimmed || "Your message appears here."}
              </p>
              {detail.trim() && (
                <p className="text-[11px] text-slate-400 mt-0.5 break-words">{detail.trim()}</p>
              )}
            </div>
            {href.trim() && (
              <span className="ml-auto flex-shrink-0 text-[10px] font-bold uppercase tracking-wider" style={{ color: previewColor }}>
                View
              </span>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void publish()}
            disabled={!valid || busy !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-4 py-2.5 text-xs font-bold text-black shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {busy === "publish" ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Megaphone className="w-3.5 h-3.5" />
            )}
            {announcement ? "Update banner" : "Publish banner"}
          </button>

          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40 transition"
          >
            {busy === "clear" ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CircleX className="w-3.5 h-3.5" />
            )}
            Clear banner
          </button>

          {!announcement && (
            <span className="text-[11px] text-slate-500">No banner is live right now.</span>
          )}
        </div>

        {notice && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs leading-relaxed ${
              notice.tone === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}
            role="status"
          >
            {notice.tone === "ok" ? (
              <CircleCheck className="w-4 h-4 flex-shrink-0 mt-px" />
            ) : (
              <CircleX className="w-4 h-4 flex-shrink-0 mt-px" />
            )}
            <span>{notice.text}</span>
          </div>
        )}
      </Panel>

      {/* ---------------------------- LIVE STATE -------------------------- */}
      <Panel
        title="Currently live"
        subtitle="What visitors are seeing right now"
        icon={<Clock className="w-4 h-4" />}
        className="lg:col-span-2"
      >
        {announcement ? (
          <div className="space-y-4">
            <div
              className="rounded-2xl border p-4"
              style={{
                background: `${
                  LEVELS.find((entry) => entry.id === announcement.level)?.color ?? PALETTE.sky
                }14`,
                borderColor: `${
                  LEVELS.find((entry) => entry.id === announcement.level)?.color ?? PALETTE.sky
                }4d`,
              }}
            >
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                {announcement.level}
              </p>
              <p className="text-sm font-semibold text-slate-100 break-words">
                {announcement.message}
              </p>
              {announcement.detail && (
                <p className="text-[11px] text-slate-400 mt-1 break-words">
                  {announcement.detail}
                </p>
              )}
              {announcement.href && (
                <p className="text-[10px] font-mono text-slate-500 mt-2 break-all">
                  → {announcement.href}
                </p>
              )}
            </div>

            <dl className="space-y-2 text-[11px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Published</dt>
                <dd className="text-slate-300 tabular-nums text-right">
                  {formatTime(announcement.publishedAt)}
                  <span className="text-slate-600"> ({formatAge(announcement.publishedAt)})</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Expires</dt>
                <dd className="text-slate-300 tabular-nums text-right">
                  {announcement.expiresAt
                    ? `${formatTime(announcement.expiresAt)} (${formatAge(announcement.expiresAt)} from now)`
                    : "never — cleared manually"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Published by</dt>
                <dd className="text-slate-400 truncate max-w-[180px] text-right">
                  {announcement.publishedBy || "unknown"}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="py-8 text-center">
            <Megaphone className="w-7 h-7 text-slate-700 mx-auto" />
            <p className="mt-3 text-xs text-slate-400 font-semibold">No banner live</p>
            <p className="mt-1 text-[11px] text-slate-600 max-w-[220px] mx-auto leading-relaxed">
              Visitors polling <span className="font-mono">/api/announcement</span> receive nothing,
              and no banner is rendered anywhere in the app.
            </p>
          </div>
        )}

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px text-cyan-400/70" />
            <span>
              Visitors pick the banner up by polling the public announcement route, so delivery
              lands within the poll interval rather than over a socket. The banner is also
              snapshotted to disk and survives a restart, but it lives in <em>this</em> instance&apos;s
              memory — on a multi-instance deployment, another region will not see it.
            </span>
          </p>
        </div>
      </Panel>
    </div>
  );
}
