import { resolveDashboardVersion } from "../dashboardVersions/resolve";
import { getSnapshot } from "../dashboardVersions/snapshot";
import type { DashboardVersionRow, VersionUser } from "../dashboardVersions/types";

/**
 * The v3 dashboard switch (docs/redesign/SPEC.md "Launch"). Off by default: the env flag
 * `DASHBOARD_V3` ("true"/"1"/"on", loaded from SSM like the other runtime flags in
 * lib/ssmEnv.ts) turns it on for everyone; a user's own `dashboardV3` field overrides the env
 * either way, so staff can test it in production before launch (or opt back out after).
 */
export type DashboardV3User = ({ dashboardV3?: boolean | null } & NonNullable<VersionUser>) | null | undefined;

export function dashboardV3EnvEnabled(value: string | undefined = process.env.DASHBOARD_V3): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

/**
 * Sync check for call sites that can't await: a thin wrapper over resolveDashboardVersion
 * (lib/dashboardVersions) using the last registry this server instance loaded. With no registry
 * rows it is exactly the old rule (the user's `dashboardV3`, else the env). Prefer
 * getDashboardVersionState / isOnDashboard where you can await: those load the registry.
 */
export function isDashboardV3(user: DashboardV3User, envValue: string | undefined = process.env.DASHBOARD_V3, registry?: DashboardVersionRow[]): boolean {
  const rows = registry ?? getSnapshot()?.rows ?? [];
  return resolveDashboardVersion(user as VersionUser, rows, { legacyEnv: envValue ?? null }).versionId === "v3";
}

/** The redesign's onboarding version: a user below it sees /welcome/setup once. */
export const CURRENT_ONBOARDING_VERSION = 3;

export type OnboardingUser = { onboardingVersion?: number | null; onboardingDeferredAt?: string | null } | null | undefined;

/**
 * Where /dashboard sends a v3 user: the one-time setup until they've finished it (or chosen
 * "Continue later"), then Home.
 */
export function v3EntryDestination(user: OnboardingUser): "onboarding" | "home" {
  if (!user) return "onboarding";
  const done = (user.onboardingVersion ?? 0) >= CURRENT_ONBOARDING_VERSION;
  if (done || user.onboardingDeferredAt) return "home";
  return "onboarding";
}

export const ONBOARDING_PATH = "/welcome/setup";
