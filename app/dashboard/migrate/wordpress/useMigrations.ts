"use client";

import { useEffect, useState } from "react";
import type { EstimateCounts } from "@/lib/wpMigration/estimate";

// The organization's WordPress migrations, shared by the dashboard-wide banner and every
// site card: one request however many places show it, refreshed every 20s only while one
// is actually running (and when the tab comes back into focus).

export interface MigrationSummary {
  id: string;
  templateId: string;
  sourceUrl: string;
  phase: string;
  siteName: string | null;
  createdAt: string;
  finishedAt: string | null;
  counts: EstimateCounts | null;
  estimatedSecondsLeft: number | null;
  pausedReason: string | null;
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const POLL_MS = 20_000;

let current: MigrationSummary[] = [];
let loaded = false;
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(m: MigrationSummary[]) => void>();

export function isRunning(m: MigrationSummary): boolean {
  return !TERMINAL.has(m.phase) && m.phase !== "PAUSED_ERROR";
}

export function migrationHref(m: { templateId: string; id: string }): string {
  return `/dashboard/migrate/wordpress?site=${m.templateId}&job=${m.id}`;
}

function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch("/api/v1/wp-migration")
    // A member without access to migrations (or a signed-out tab) simply sees nothing.
    .then((r) => (r.ok ? r.json() : { migrations: [] }))
    .then((data: { migrations?: MigrationSummary[] }) => {
      current = data.migrations ?? [];
      loaded = true;
      listeners.forEach((l) => l(current));
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
      schedule();
    });
  return inflight;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (listeners.size > 0 && current.some(isRunning)) timer = setTimeout(() => void refresh(), POLL_MS);
}

export function useMigrations(): MigrationSummary[] {
  const [migrations, setMigrations] = useState<MigrationSummary[]>(current);
  useEffect(() => {
    listeners.add(setMigrations);
    if (!loaded) void refresh();
    else schedule();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      listeners.delete(setMigrations);
      window.removeEventListener("focus", onFocus);
      if (listeners.size === 0 && timer) clearTimeout(timer);
    };
  }, []);
  return migrations;
}

/** The newest migration of this site (a site can be re-migrated), if any. */
export function migrationForSite(migrations: MigrationSummary[], templateId: string): MigrationSummary | undefined {
  return migrations.find((m) => m.templateId === templateId);
}
