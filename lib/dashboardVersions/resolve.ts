import { DEFAULT_REMIND_DAYS, FALLBACK_VERSION_ID, type AccessMode, type DashboardVersionRow, type VersionUser } from "./types";
import { DASHBOARD_VERSIONS } from "./versions";

export type ResolveOptions = {
  /** DASHBOARD_VERSIONS_KILL: "classic" forces everyone onto classic. Defaults to the env var. */
  kill?: string | null;
  /** DASHBOARD_V3 env, read only when the registry is empty. Defaults to the env var. */
  legacyEnv?: string | null;
  /** Ids this build can render. Defaults to the DASHBOARD_VERSIONS map. */
  implemented?: readonly string[];
};

export type ResolveSource = "kill" | "mandatory" | "locked" | "choice" | "default" | "legacy";

export type ResolvedVersion = {
  versionId: string;
  source: ResolveSource;
  /** True when the person is on this version and cannot leave it (locked or mandatory). */
  locked: boolean;
  /** Versions they may switch to right now (empty when locked/mandatory). */
  switchTargets: string[];
};

function truthy(v: string | null | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "on" || s === "yes";
}

function implementedSet(opts: ResolveOptions): Set<string> {
  return new Set(opts.implemented ?? Object.keys(DASHBOARD_VERSIONS));
}

/** A version people can be on right now: the default always, otherwise a live (not OFF, not retired) one. */
function isActive(row: DashboardVersionRow | undefined, impl: Set<string>): row is DashboardVersionRow {
  if (!row || !impl.has(row.id)) return false;
  if (row.isDefault) return true;
  return (row.rolloutMode ?? "OFF") !== "OFF" && row.status !== "retired";
}

export function defaultVersionId(registry: DashboardVersionRow[], impl: Set<string>): string {
  const d = registry.find((r) => r.isDefault && impl.has(r.id));
  return d?.id ?? FALLBACK_VERSION_ID;
}

/** How the admin added this person to a version's audience, if they did. */
export function accessFor(user: VersionUser, versionId: string): AccessMode | null {
  return user?.dashboardVersionAccess?.[versionId] ?? null;
}

/** May this person be on / try this (non-default) version under its current rollout mode? */
export function isEligible(user: VersionUser, row: DashboardVersionRow): boolean {
  const mode = row.rolloutMode ?? "OFF";
  if (mode === "MANDATORY") return true;
  if (mode === "SELECTED") return accessFor(user, row.id) !== null;
  if (mode === "OFFERED") return (row.offerAudience ?? "everyone") === "everyone" || accessFor(user, row.id) !== null;
  return false;
}

/** Other versions this person may switch to themselves (never when locked or mandatory). */
function targetsFor(user: VersionUser, registry: DashboardVersionRow[], current: string, impl: Set<string>): string[] {
  const out: string[] = [];
  for (const row of [...registry].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    if (row.id === current || !isActive(row, impl)) continue;
    if (row.isDefault || (row.rolloutMode !== "MANDATORY" && isEligible(user, row))) out.push(row.id);
  }
  return out;
}

/**
 * Which dashboard a person sees. Order: kill switch -> mandatory rollout -> admin-locked
 * assignment -> the person's own latest choice -> the registry default. With no registry rows
 * at all, the old per-user `dashboardV3` field / DASHBOARD_V3 env decide (legacy fallback).
 * Pure: pass the registry in (lib/dashboardVersions/state.ts loads it, cached).
 */
export function resolveDashboardVersion(user: VersionUser, registry: DashboardVersionRow[], opts: ResolveOptions = {}): ResolvedVersion {
  const kill = opts.kill !== undefined ? opts.kill : process.env.DASHBOARD_VERSIONS_KILL;
  if ((kill ?? "").trim().toLowerCase() === "classic") {
    return { versionId: FALLBACK_VERSION_ID, source: "kill", locked: true, switchTargets: [] };
  }
  const impl = implementedSet(opts);

  if (registry.length === 0) {
    const env = opts.legacyEnv !== undefined ? opts.legacyEnv : process.env.DASHBOARD_V3;
    const v3 = typeof user?.dashboardV3 === "boolean" ? user.dashboardV3 : truthy(env);
    return { versionId: v3 && impl.has("v3") ? "v3" : FALLBACK_VERSION_ID, source: "legacy", locked: false, switchTargets: [] };
  }

  const byId = new Map(registry.map((r) => [r.id, r]));
  const fallback = defaultVersionId(registry, impl);

  const mandatory = registry
    .filter((r) => isActive(r, impl) && !r.isDefault && r.rolloutMode === "MANDATORY")
    .sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0))[0];
  if (mandatory) return { versionId: mandatory.id, source: "mandatory", locked: true, switchTargets: [] };

  const assigned = user?.dashboardVersion ?? null;
  const row = assigned ? byId.get(assigned) : undefined;
  if (assigned && isActive(row, impl)) {
    if (user?.dashboardVersionLocked) return { versionId: assigned, source: "locked", locked: true, switchTargets: [] };
    if (row.isDefault || isEligible(user, row)) {
      return { versionId: assigned, source: "choice", locked: false, switchTargets: targetsFor(user, registry, assigned, impl) };
    }
  }
  return { versionId: fallback, source: "default", locked: false, switchTargets: targetsFor(user, registry, fallback, impl) };
}

export type VersionOffer = { versionId: string; label: string; whatsNew: string[]; remindAfterDays: number };

/**
 * The "Try Plexo Version 2" offer this person should see now, or null. Only for OFFERED versions
 * they're in the audience of, aren't on, haven't said "Don't ask again" to, and aren't snoozed on.
 */
export function pickOffer(user: VersionUser, registry: DashboardVersionRow[], resolved: ResolvedVersion, now: Date = new Date(), opts: ResolveOptions = {}): VersionOffer | null {
  if (resolved.locked || resolved.source === "legacy") return null;
  const impl = implementedSet(opts);
  for (const row of [...registry].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    if (row.isDefault || row.rolloutMode !== "OFFERED" || row.status === "retired" || !impl.has(row.id) || row.id === resolved.versionId) continue;
    if (!isEligible(user, row)) continue;
    const state = user?.dashboardOffers?.[row.id];
    if (state?.never) continue;
    if (state?.snoozeUntil && Date.parse(state.snoozeUntil) > now.getTime()) continue;
    return {
      versionId: row.id,
      label: row.label,
      whatsNew: (row.whatsNew?.length ? row.whatsNew : (DASHBOARD_VERSIONS[row.id]?.defaultWhatsNew ?? [])).slice(0, 3),
      remindAfterDays: row.remindAfterDays ?? DEFAULT_REMIND_DAYS,
    };
  }
  return null;
}

/** Why a switch isn't allowed, or null when it is. Plain words: shown to the person. */
export function switchDenied(user: VersionUser, registry: DashboardVersionRow[], to: string, opts: ResolveOptions = {}): string | null {
  const resolved = resolveDashboardVersion(user, registry, opts);
  if (resolved.source === "kill") return "The dashboard can't be changed right now.";
  if (resolved.source === "mandatory") return "Everyone has moved to this dashboard, so it can't be switched back.";
  if (resolved.locked) return "Your dashboard has been set by your Plexo admin, so it can't be changed here.";
  if (resolved.source === "legacy") return "Switching isn't available yet.";
  if (to === resolved.versionId) return "You're already on that dashboard.";
  if (!resolved.switchTargets.includes(to)) return "That dashboard isn't available to you.";
  return null;
}
