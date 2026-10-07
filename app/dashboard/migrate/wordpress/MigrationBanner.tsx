"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDuration, migrationActivity, migrationProgress } from "@/lib/wpMigration/estimate";
import { isRunning, migrationHref, useMigrations, type MigrationSummary } from "./useMigrations";

// Shown above every dashboard page while a WordPress site is moving (the owner was told
// they can close the migration tab and come back), when it's paused waiting on them, and
// for a few days after it finishes until they've seen the report.

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
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
    ?? migrations.find((m) => m.phase === "COMPLETED" && m.finishedAt && Date.now() - Date.parse(m.finishedAt) < RECENT_MS);

  useEffect(() => {
    if (shown) setDismissed((d) => (shown.id in d ? d : { ...d, [shown.id]: readDismissed(shown.id) }));
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
  };

  return (
    <div role="status" style={{ ...bar, borderColor: tone(shown).border, background: tone(shown).background }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f0f2ff" }}>{headline(shown, name)}</div>
        <div style={{ fontSize: 12, color: "rgba(240,242,255,0.6)", marginTop: 2 }}>{detail(shown)}</div>
        {isRunning(shown) && (
          <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.08)", marginTop: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(migrationProgress(shown.phase, shown.counts) * 100)}%`, background: "var(--brand)", transition: "width 0.6s" }} />
          </div>
        )}
      </div>
      <Link href={migrationHref(shown)} style={button}>
        {shown.phase === "PAUSED_ERROR" ? "Continue the move" : shown.phase === "COMPLETED" ? "See your report" : "View progress"} →
      </Link>
      {shown.phase === "COMPLETED" && (
        <button type="button" onClick={dismiss} aria-label="Dismiss" style={close}>×</button>
      )}
    </div>
  );
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

function tone(m: MigrationSummary) {
  if (m.phase === "PAUSED_ERROR") return { border: "rgba(245,183,74,0.45)", background: "rgba(245,183,74,0.08)" };
  if (m.phase === "COMPLETED") return { border: "rgba(110,231,168,0.4)", background: "rgba(110,231,168,0.07)" };
  return { border: "rgba(var(--brand-rgb),0.35)", background: "rgba(var(--brand-rgb),0.07)" };
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}

const bar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap",
  padding: "12px 16px",
  margin: "0 0 20px",
  borderRadius: 12,
  border: "1px solid",
};

const button: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 14px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  textDecoration: "none",
  background: "rgba(var(--brand-rgb),0.18)",
  color: "var(--brand)",
  whiteSpace: "nowrap",
};

const close: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "rgba(240,242,255,0.5)",
  fontSize: 20,
  lineHeight: 1,
  cursor: "pointer",
  padding: "0 4px",
};
