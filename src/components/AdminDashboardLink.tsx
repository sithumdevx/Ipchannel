"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

/**
 * Header link to the admin console, rendered only for administrators.
 *
 * This is a *UI hint*, not a security boundary: `/api/admin/me` answers a
 * boolean, and the real gate lives on the `/admin` page and on every
 * `/api/admin/*` route. Hiding the link simply keeps a dead-end entry point out
 * of ordinary members' navigation.
 *
 * The probe is memoised at module scope so a page with two navbars (desktop and
 * mobile) still issues a single request, and it is never retried after a
 * failure — an unauthenticated visitor should not poll for privileges.
 */

let adminProbe: Promise<boolean> | null = null;

function probeAdmin(): Promise<boolean> {
  if (!adminProbe) {
    adminProbe = fetch("/api/admin/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => Boolean((payload as { admin?: boolean } | null)?.admin))
      .catch(() => false);
  }
  return adminProbe;
}

export default function AdminDashboardLink({
  className = "",
  iconClassName = "w-3.5 h-3.5",
  label = "Admin",
  labelClassName = "",
}: {
  className?: string;
  iconClassName?: string;
  label?: string;
  /** Lets a caller collapse the link to icon-only on small screens. */
  labelClassName?: string;
}) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    void probeAdmin().then((admin) => {
      if (active) setIsAdmin(admin);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!isAdmin) return null;

  return (
    <Link href="/admin" className={className} title="Admin console — system health and analytics">
      <LayoutDashboard className={iconClassName} />
      <span className={labelClassName}>{label}</span>
    </Link>
  );
}
