/**
 * Dashboard versions: which dashboard a person sees. Admin-controlled (plexo-admin "Versions"),
 * data-driven. See docs/DASHBOARD_VERSIONS.md.
 */
export const ROLLOUT_MODES = ["OFF", "SELECTED", "OFFERED", "MANDATORY"] as const;
export type RolloutMode = (typeof ROLLOUT_MODES)[number];

export const VERSION_STATUSES = ["beta", "stable", "retired"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/** One row of the registry (the DashboardVersion entity). */
export type DashboardVersionRow = {
  id: string;
  /** What people see, e.g. "Version 2". */
  label: string;
  description?: string | null;
  /** Up to three plain-language bullets for the "Try Plexo Version 2" offer. */
  whatsNew?: string[] | null;
  status?: VersionStatus | null;
  isDefault?: boolean | null;
  rolloutMode?: RolloutMode | null;
  /** OFFERED only: who gets the offer. */
  offerAudience?: "everyone" | "selected" | null;
  /** OFFERED only: days before "Maybe later" asks again (default 7). */
  remindAfterDays?: number | null;
  sortOrder?: number | null;
};

export type AccessMode = "optional" | "locked";

export type SwitchActor = "user" | "admin" | "rollout";

export type SwitchHistoryEntry = {
  at: string;
  from: string | null;
  to: string;
  by: SwitchActor;
  adminId?: string;
  note?: string;
};

export type OfferState = { snoozeUntil?: string; never?: boolean; askedAt?: string };

/** The user fields the system reads (all optional: most people have none of them). */
export type VersionUser = {
  id?: string;
  dashboardVersion?: string | null;
  dashboardVersionLocked?: boolean | null;
  dashboardVersionHistory?: SwitchHistoryEntry[] | null;
  /** The audience: versionId -> how the admin added them. */
  dashboardVersionAccess?: Record<string, AccessMode> | null;
  dashboardOffers?: Record<string, OfferState> | null;
  /** Legacy per-user switch (before the registry). */
  dashboardV3?: boolean | null;
} | null | undefined;

export const DEFAULT_REMIND_DAYS = 7;
export const FALLBACK_VERSION_ID = "classic";
export const MAX_HISTORY = 50;
