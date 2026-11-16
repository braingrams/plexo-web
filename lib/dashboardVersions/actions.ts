import { DEFAULT_REMIND_DAYS, type DashboardVersionRow, type OfferState, type VersionUser } from "./types";
import { resolveDashboardVersion, switchDenied, type ResolveOptions } from "./resolve";
import { buildSwitchPatch } from "./switch";

export type SwitchPlan = { ok: true; patch: ReturnType<typeof buildSwitchPatch>; from: string; to: string } | { ok: false; status: number; error: string };

/** A person switching their own dashboard: allowed only when it isn't locked or mandatory. */
export function planUserSwitch(user: VersionUser, registry: DashboardVersionRow[], to: unknown, now: Date = new Date(), opts: ResolveOptions = {}): SwitchPlan {
  if (typeof to !== "string" || !to) return { ok: false, status: 400, error: "Choose which dashboard to switch to." };
  const denied = switchDenied(user, registry, to, opts);
  if (denied) return { ok: false, status: 403, error: denied };
  const from = resolveDashboardVersion(user, registry, opts).versionId;
  return { ok: true, from, to, patch: { ...buildSwitchPatch(user, { to, by: "user" }, now, from) } };
}

export type OfferAnswer = "later" | "never";

/** "Maybe later" asks again after the version's reminder days; "Don't ask again" never asks. */
export function planOfferAnswer(user: VersionUser, registry: DashboardVersionRow[], versionId: unknown, action: unknown, now: Date = new Date()):
  | { ok: true; offers: Record<string, OfferState> }
  | { ok: false; status: number; error: string } {
  if (typeof versionId !== "string" || (action !== "later" && action !== "never")) return { ok: false, status: 400, error: "That answer wasn't understood." };
  const row = registry.find((r) => r.id === versionId);
  if (!row) return { ok: false, status: 404, error: "That dashboard doesn't exist." };
  const days = row.remindAfterDays ?? DEFAULT_REMIND_DAYS;
  const next: OfferState =
    action === "never"
      ? { never: true, askedAt: now.toISOString() }
      : { snoozeUntil: new Date(now.getTime() + days * 86_400_000).toISOString(), askedAt: now.toISOString() };
  return { ok: true, offers: { ...(user?.dashboardOffers ?? {}), [versionId]: next } };
}
