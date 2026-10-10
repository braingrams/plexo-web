"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRightLeft, CheckCircle2 } from "lucide-react";
import { DashboardNotice } from "../../_components/DashboardNotice";
import { usePathname } from "next/navigation";
import { formatDuration, migrationActivity, migrationProgress } from "@/lib/wpMigration/estimate";
import { isRunning, migrationHref, useMigrations, type MigrationSummary } from "./useMigrations";

// Shown above every dashboard page while a WordPress site is moving (the owner was told
// they can close the migration tab and come back), when it's paused waiting on them, and
// for a few days after it finishes until they've seen the report.

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
// Closing the banner is saved on the migration (so it stays closed on every device); this
// browser also remembers it, so it hides instantly before the list has loaded.
const dismissKey = (id: string) => `plexo:wp-migration-banner-dismissed:${id}`;

function readDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(id)) === "1";
  } catch {
    return false;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function MigrationBanner() {
  const pathname = usePathname();
  const migrations = useMigrations();
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const shown = migrations.find((m) => isRunning(m) || m.phase === "PAUSED_ERROR")
    ?? migrations.find((m) => m.phase === "COMPLETED" && !m.bannerDismissed && m.finishedAt && Date.now() - Date.parse(m.finishedAt) < RECENT_MS);

  useEffect(() => {
    if (!shown) return;
    const closedHere = readDismissed(shown.id);
    setDismissed((d) => (shown.id in d ? d : { ...d, [shown.id]: closedHere }));
    // Closed in this browser before it was saved on the account: save it now.
    if (closedHere && shown.phase === "COMPLETED") void saveDismissal(shown);
  }, [shown]);

  // The migration screen already shows all of this.
  if (!shown || pathname?.startsWith("/dashboard/migrate/wordpress")) return null;
  if (shown.phase === "COMPLETED" && dismissed[shown.id] !== false) return null;

  const name = shown.siteName || hostOf(shown.sourceUrl);
  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissKey(shown.id), "1");
    } catch {
      // still hidden for this visit
    }
    setDismissed((d) => ({ ...d, [shown.id]: true }));
    void saveDismissal(shown);
  };

  return (
    <DashboardNotice
      tone={shown.phase === "PAUSED_ERROR" ? "warning" : shown.phase === "COMPLETED" ? "success" : "brand"}
      icon={shown.phase === "PAUSED_ERROR" ? AlertTriangle : shown.phase === "COMPLETED" ? CheckCircle2 : ArrowRightLeft}
      title={headline(shown, name)}
      detail={detail(shown)}
      progress={isRunning(shown) ? migrationProgress(shown.phase, shown.counts) : undefined}
      actions={[{ label: shown.phase === "PAUSED_ERROR" ? "Continue the move" : shown.phase === "COMPLETED" ? "See your report" : "View progress", href: migrationHref(shown) }]}
      onDismiss={shown.phase === "COMPLETED" ? dismiss : undefined}
    />
  );
}

function saveDismissal(m: MigrationSummary): Promise<unknown> {
  return fetch(`/api/v1/wp-migration/${m.templateId}/${m.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dismissBanner: true }),
  }).catch(() => undefined);
}

function headline(m: MigrationSummary, name: string): string {
  if (m.phase === "PAUSED_ERROR") return `Moving ${name} to Plexo has paused`;
  if (m.phase === "COMPLETED") return `${name} has moved to Plexo`;
  return `Moving ${name} to Plexo`;
}

function detail(m: MigrationSummary): string {
  if (m.phase === "PAUSED_ERROR") return `${m.pausedReason ?? "Something went wrong."} Pick up exactly where it stopped — nothing already moved is lost.`;
  if (m.phase === "COMPLETED") return "Preview it, check the report, then connect your domain.";
  const left = typeof m.estimatedSecondsLeft === "number" ? ` · ${capitalize(formatDuration(m.estimatedSecondsLeft))} left` : "";
  return `${migrationActivity(m.phase, m.counts)}${left} · It keeps going if you leave — we'll email you when it's done.`;
}


function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}

