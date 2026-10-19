import { NextResponse } from "next/server";

/**
 * Latency probe.
 *
 * The player measures its own round trip against this endpoint to grade the
 * viewer's connection. Three properties matter, and they are the reason this is
 * a dedicated route rather than a reuse of `/api/health` (which runs a stream
 * sweep and would be both slow and wrong to time):
 *
 *  - **No body.** An empty 200 keeps the measurement dominated by network time
 *    rather than by transfer size. (204 would be more precise about "no
 *    content", but the Fetch `Response` constructor rejects it in this runtime,
 *    and the byte difference is a couple of headers.)
 *  - **Never cached.** The service worker already refuses to cache `/api/*`,
 *    and `no-store` covers the browser HTTP cache and any intermediary. A
 *    cached reply would report ~0 ms and the connection badge would lie.
 *  - **Deliberately dynamic.** The probe is allowed to be answered at request
 *    time, so the number includes whatever the serverless hop actually costs —
 *    which is exactly what a viewer is asking when they wonder whether the app
 *    or their network is to blame.
 */
export function GET() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
