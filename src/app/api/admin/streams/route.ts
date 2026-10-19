import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getChannelCatalog } from "@/lib/channels";
import { healthRows } from "@/lib/stream-health";
import type { AdminStreamsQuery, AdminStreamsResponse } from "@/types/admin";

/**
 * Stream health monitoring table.
 *
 * Split from `/api/admin/stats` on purpose: the summary is small and polled
 * often, this table is paged and searched on demand. Folding 11k rows into the
 * stats payload would make every refresh pay for data the operator is not
 * looking at.
 *
 * `status=offline` is the operationally interesting query, and the default
 * ordering already floats failures to the top.
 */


const VALID_STATUS: AdminStreamsQuery["status"][] = ["all", "online", "offline", "unknown"];

function parseStatus(raw: string | null): NonNullable<AdminStreamsQuery["status"]> {
  const value = (raw ?? "all").trim().toLowerCase();
  return (VALID_STATUS as string[]).includes(value)
    ? (value as NonNullable<AdminStreamsQuery["status"]>)
    : "all";
}

function parsePositive(raw: string | null, fallback: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  try {
    const params = request.nextUrl.searchParams;

    const status = parseStatus(params.get("status"));
    const page = parsePositive(params.get("page"), 1, 10_000);
    const perPage = parsePositive(params.get("perPage"), 25, 200);
    const search = (params.get("search") ?? "").slice(0, 120);

    const catalog = await getChannelCatalog();
    const table = healthRows(catalog.channels, {
      status,
      search,
      offset: (page - 1) * perPage,
      limit: perPage,
    });

    const payload: AdminStreamsResponse = {
      rows: table.rows,
      total: table.total,
      counts: table.counts,
      page,
      perPage,
    };

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read stream health.", detail: error instanceof Error ? error.message : "unknown" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
