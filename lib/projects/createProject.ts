import type { PaidPlanId } from "@/lib/plan/plans";
import { templateLimitGate } from "@/lib/plan/limitGates";
import { randomUUID } from "node:crypto";
import { Template } from "@/lib/db/contentEntities";
import { getTierFeatures } from "@/lib/subscription";
import { scaffoldFiles } from "./scaffold";
import { writeFiles, snapshotVersion, type FileWrite } from "./fileStore";
import { createPreviewHost } from "./previewHost";
import { chunk } from "./concurrency";
import { PROJECT_LIMITS } from "./paths";
import { countsAsSite } from "@/lib/plan/countsAsSite";

export type ProjectOwner = { userId: string; organizationId: string; subscriptionPlan: string; userName?: string };

export class ProjectLimitError extends Error {
  constructor(message: string, readonly requiredPlan?: PaidPlanId) {
    super(message);
  }
}

/** Projects are sites — they share the plan's site limit with builder/raw sites, so an
 * owner never has to understand two separate quotas. */
export async function assertCanCreateSite(owner: ProjectOwner): Promise<void> {
  const features = getTierFeatures(owner.subscriptionPlan);
  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: owner.organizationId }).go({ pages: "all", attributes: ["id", "parentId", "kind"] });
  const rootCount = orgTemplates.filter((t) => countsAsSite(t)).length;
  if (rootCount >= features.maxLandingPages) {
    const gate = templateLimitGate("LANDING_PAGE", features.maxLandingPages);
    throw new ProjectLimitError(gate.message, gate.requiredPlan);
  }
}

/**
 * Creates a ready-to-build React project: a REACT_PROJECT site, the scaffold (or the
 * caller's own files layered over it — a Deploy API upload or a GitHub import can replace
 * any scaffold file), a reserved preview address, and a first version. Nothing to configure
 * before the first build works.
 */
export async function createProject(
  owner: ProjectOwner,
  input: { name: string; files?: FileWrite[]; useScaffold?: boolean; source?: "ai" | "editor" | "deploy" | "git" },
): Promise<{ templateId: string; previewHost: string; versionId: string }> {
  await assertCanCreateSite(owner);
  const name = input.name.trim().slice(0, 120) || "My App";
  const templateId = randomUUID();

  await Template.create({
    id: templateId,
    userId: owner.userId,
    organizationId: owner.organizationId,
    name,
    kind: "LANDING_PAGE",
    sourceType: "REACT_PROJECT",
    designJson: {},
    compiledHtml: "",
  }).go();

  const previewHost = await createPreviewHost(templateId, owner.organizationId);
  await Template.patch({ id: templateId }).set({ previewHost }).go();

  const merged = new Map<string, FileWrite>();
  if (input.useScaffold !== false) {
    for (const [path, content] of Object.entries(scaffoldFiles(name))) merged.set(path, { path, content });
  }
  for (const file of input.files ?? []) merged.set(file.path, file);
  for (const batch of chunk([...merged.values()], PROJECT_LIMITS.maxFilesPerWrite)) {
    await writeFiles(templateId, batch, owner.userId);
  }

  const { versionId } = await snapshotVersion(templateId, {
    message: input.files?.length ? "Imported project" : "Created project",
    source: input.files?.length ? (input.source ?? "deploy") : "scaffold",
    authorId: owner.userId,
    authorName: owner.userName,
  });
  return { templateId, previewHost, versionId };
}
