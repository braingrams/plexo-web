/**
 * The "Your brand" picker's logic (app/dashboard/_v3/brand/StrataBrandPicker.tsx), pure: which state the picker is in, what the
 * owner's choice means, the words it uses. Tested in tests/strataBrandPicker.test.ts.
 *
 * Plain words only: owners see "brand", "colours", "fonts" and "logo", never tokens, ids or tool names. The tool behind it is named only in the help panel (lib/dashboardV3/brandDefinition.ts).
 */
import { parseBrandChoice, type BrandChoice } from "@/lib/brand/brandModel";

export type PickerProject = { id: string; name: string; description?: string | null; color?: string | null; logo?: string | null; updatedAt?: string; role?: "owner" | "editor" | "viewer" };

export type PickerStage = "loading" | "unavailable" | "not-connected" | "error" | "empty" | "list";

/** What the owner has chosen so far. `none` and `skip` both mean "carry on with my own brand". */
export type PickerSelection = { kind: "none" } | { kind: "skip" } | { kind: "project"; id: string; name: string } | { kind: "create" };

export const NO_SELECTION: PickerSelection = { kind: "none" };

export function stageFor(input: { available: boolean | null; connected: boolean; loading: boolean; error?: string | null; projects: PickerProject[] | null }): PickerStage {
  if (input.available === false) return "unavailable";
  if (input.available === null || input.loading) return "loading";
  if (!input.connected) return "not-connected";
  if (input.error) return "error";
  if (!input.projects || input.projects.length === 0) return "empty";
  return "list";
}

/** The project this site uses now first, then the most recently edited. Projects the owner can only view are listed last (linking needs edit access). */
export function sortProjects(projects: PickerProject[], currentId?: string | null): PickerProject[] {
  const rank = (p: PickerProject) => (p.id === currentId ? 0 : p.role === "viewer" ? 2 : 1);
  return [...projects].sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.name.localeCompare(b.name));
}

export const canLink = (p: PickerProject): boolean => p.role !== "viewer";

/** The first letter shown when a project has no logo. */
export const projectInitial = (name: string): string => (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "S").toUpperCase();

/** What the new-site and onboarding screens send to the server for this choice (undefined = no brand step result). */
export function selectionToChoice(sel: PickerSelection): BrandChoice | undefined {
  if (sel.kind === "project") return parseBrandChoice({ projectId: sel.id, projectName: sel.name });
  if (sel.kind === "create") return parseBrandChoice({ createFromBrand: true });
  return undefined;
}

/** Toggling a choice: choosing the same one again clears it. */
export function toggleSelection(current: PickerSelection, next: PickerSelection): PickerSelection {
  const same = current.kind === next.kind && (current.kind !== "project" || (next.kind === "project" && current.id === next.id));
  return same ? NO_SELECTION : next;
}

export const PICKER_COPY = {
  title: "Your brand",
  lead: "If you already have a saved brand, use it here. Your website will look like your brand from the start and follow it when you change it.",
  connectTitle: "Find my saved brands",
  connectText: "Sign in with your Charisol account to see the brands you have saved. This is optional: everything works without it.",
  /** For a website that already exists: its brand has to live in Strata, so this is the one step left, not an option. */
  connectSiteText: "Sign in with your Charisol account once. Plexo then saves your brand for you, and keeps it up to date.",
  connectButton: "Sign in to continue",
  notConnectedNote: "You'll sign in with your Charisol account in a small window.",
  emptyTitle: "You have no saved brands yet",
  emptyText: "You can make one from the colours and logo you're using here. It's saved safely and stays in step with your website.",
  createTitle: "Create a brand from mine",
  createText: "Plexo saves your colours, fonts and logo as a new brand, so it lives in one place from now on.",
  createNeedsColours: "Choose your colours first, then Plexo can save your brand.",
  skip: "Skip for now",
  skipNote: "Your website will use the colours and logo you choose here. You can set up your brand any time from its Your brand page.",
  syncTitle: "Keep my website up to date",
  syncOn: "When you change your brand, your website follows within a couple of minutes.",
  syncOff: "Your website keeps its current look until you turn this back on.",
  viewOnly: "View only: you need edit access to use this brand",
  deferred: "Your website will use this brand as soon as it's made.",
  retry: "Try again",
} as const;

/**
 * Changing the brand a website follows is a big change (colours, fonts and logo on the live site), so it is confirmed first.
 * Choosing the brand the site already uses, or the first brand for a site that has none, needs no question.
 */
export function needsSwitchConfirmation(input: { currentProjectId?: string | null; selection: PickerSelection }): boolean {
  const { currentProjectId, selection } = input;
  if (!currentProjectId) return false;
  if (selection.kind === "create") return true;
  return selection.kind === "project" && selection.id !== currentProjectId;
}

/** What switching will do, in plain words, for the confirmation. */
export function switchWarning(input: { siteName: string; toName: string; created?: boolean; autoSync: boolean }): { title: string; lines: string[]; confirm: string } {
  const to = input.toName.trim() || "this brand";
  return {
    title: input.created ? "Make a new brand from this website?" : `Switch ${input.siteName}'s brand to "${to}"?`,
    lines: [
      `${input.siteName} will use the colours, fonts and logo from ${input.created ? "the new brand" : `"${to}"`}. If the website is online, you will see the change there within a couple of minutes.`,
      "Your words, pictures and pages stay exactly as they are.",
      input.autoSync ? "From now on, the website follows this brand when you change it." : "The website will not follow later changes to this brand until you turn \"Keep my website up to date\" back on.",
      "You can switch back any time.",
    ],
    confirm: input.created ? "Yes, make it" : "Yes, switch my brand",
  };
}

/** One plain sentence for after a brand was linked or created, e.g. for a toast or the panel's confirmation. */
export function confirmationText(input: { projectName?: string | null; created?: boolean; autoSync: boolean; notes?: string[] }): string {
  const name = input.projectName?.trim();
  const head = input.created ? `Your brand is saved${name ? ` as "${name}"` : ""} and on your website.` : `Your ${name ? `"${name}" ` : ""}brand is on your website.`;
  const sync = input.autoSync ? " It stays in step when you change it." : "";
  return `${head}${sync}${input.notes?.length ? ` ${input.notes[0]}` : ""}`;
}
