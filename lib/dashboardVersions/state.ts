import { cache } from "react";

import { User } from "@/lib/db/coreEntities";
import { pickOffer, resolveDashboardVersion, type ResolvedVersion, type VersionOffer } from "./resolve";
import { loadRegistry } from "./store";
import { buildSwitchPatch } from "./switch";
import type { DashboardVersionRow, VersionUser } from "./types";
import { implementationFor, type DashboardShellKind } from "./versions";

export type DashboardVersionState = ResolvedVersion & {
  shell: DashboardShellKind;
  label: string;
  /** What the account menu / Settings can offer: the versions they may switch to now. */
  targets: { id: string; label: string; isDefault: boolean }[];
  offer: VersionOffer | null;
};

const labelOf = (registry: DashboardVersionRow[], id: string) => registry.find((r) => r.id === id)?.label ?? implementationFor(id).defaultLabel;

export function buildState(user: VersionUser, registry: DashboardVersionRow[], now: Date = new Date()): DashboardVersionState {
  const resolved = resolveDashboardVersion(user, registry);
  return {
    ...resolved,
    shell: implementationFor(resolved.versionId).shell,
    label: labelOf(registry, resolved.versionId),
    targets: resolved.switchTargets.map((id) => ({ id, label: labelOf(registry, id), isDefault: !!registry.find((r) => r.id === id)?.isDefault })),
    offer: pickOffer(user, registry, resolved, now),
  };
}

// One resolution per request: the layout, the page and the settings sections all ask.
const stateForRequest = cache(async (_userId: string, user: VersionUser) => {
  const registry = await loadRegistry();
  const state = buildState(user, registry);
  await recordRolloutMove(user, state);
  return state;
});

export function getDashboardVersionState(user: NonNullable<VersionUser> & { id: string }): Promise<DashboardVersionState> {
  return stateForRequest(user.id, user);
}

/** True when this person's dashboard renders in the new (v3) shell. For page guards that can await. */
export async function usesNewShell(user: (NonNullable<VersionUser> & { id: string }) | null | undefined): Promise<boolean> {
  if (!user) return false;
  return (await getDashboardVersionState(user)).shell === "v3";
}

/**
 * When a mandatory rollout moves someone, write it into their history once ("by rollout") so
 * admin can see when they moved and a later rollback keeps them where they were. Best effort:
 * the page renders correctly either way.
 */
async function recordRolloutMove(user: VersionUser, state: DashboardVersionState): Promise<void> {
  if (!user?.id || state.source !== "mandatory" || user.dashboardVersion === state.versionId) return;
  try {
    await User.patch({ id: user.id }).set(buildSwitchPatch(user, { to: state.versionId, by: "rollout" })).go();
  } catch (err) {
    console.error("dashboard version rollout history:", err);
  }
}
