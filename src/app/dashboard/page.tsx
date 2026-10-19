import { redirect } from "next/navigation";

/**
 * `/dashboard` → `/admin`.
 *
 * The admin console moved to a stable, predictable URL. This stub exists so
 * bookmarks, the old header link, and anything already pointing at
 * `/dashboard` land in the right place instead of 404ing.
 *
 * It is a plain constant redirect — no guard of its own. `/admin` performs the
 * session + `ADMIN_EMAILS` check before rendering anything, so routing here
 * grants nothing; re-implementing the check in two places would only create a
 * second place for the two to disagree.
 */
export default function DashboardRedirect() {
  redirect("/admin");
}
