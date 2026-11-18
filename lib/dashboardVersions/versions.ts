/**
 * The dashboard versions this codebase can actually render. Registry rows (admin) decide who
 * sees which; this map decides what each id IS. An id in the registry that is not here falls
 * back to classic. To add a future version: add an entry here, implement its shell (see
 * app/dashboard/layout.tsx and docs/DASHBOARD_VERSIONS.md), then add its registry row in admin.
 */
export type DashboardShellKind = "classic" | "v3";

export type DashboardVersionImpl = {
  id: string;
  /** Which shell renders it (app/dashboard/layout.tsx switches on this). */
  shell: DashboardShellKind;
  /** Used for the registry seed and when a row has no label. People never see ids: they see "Version 1" / "Version 2". */
  defaultLabel: string;
  /** One plain sentence for the registry seed. */
  defaultDescription: string;
  /** Up to three plain bullets for the "Try Plexo Version 2" offer. */
  defaultWhatsNew: string[];
};

export const DASHBOARD_VERSIONS: Record<string, DashboardVersionImpl> = {
  classic: { id: "classic", shell: "classic", defaultLabel: "Version 1", defaultDescription: "The Plexo you know.", defaultWhatsNew: [] },
  v3: {
    id: "v3",
    shell: "v3",
    defaultLabel: "Version 2",
    defaultDescription: "A simpler, cleaner Plexo that guides you step by step.",
    defaultWhatsNew: ["A simpler home screen that shows what to do next", "Everything for one website in one place", "Clearer plans, prices and billing"],
  },
};

export function implementationFor(id: string | null | undefined): DashboardVersionImpl {
  return (id && DASHBOARD_VERSIONS[id]) || DASHBOARD_VERSIONS.classic;
}

export function implementedIds(): string[] {
  return Object.keys(DASHBOARD_VERSIONS);
}
