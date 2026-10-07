import { randomUUID } from "node:crypto";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { checkUrlsForThreats } from "@/lib/safeBrowsing";
import { discoverWordPressInstall, WordPressNotFoundError } from "./discover";
import type { MigrationAccess } from "./access";

// The one place a migration is started — shared by the dashboard's REST route and the MCP
// tool so an AI assistant gets exactly the same checks, limits and owner-readable errors a
// person clicking through the dashboard does.

const ACTIVE_PHASES = new Set(["PENDING", "PLANNING", "POSTS", "PAGES", "ASSETS", "FINALIZING", "PAUSED_ERROR"]);
// The heaviest job Plexo runs (a whole site's pages, media and theme files) — generous for
// real use (re-running after fixing something on WordPress), tight enough that it can't be
// used to mirror arbitrary sites in bulk.
const DAILY_LIMIT = 5;

export type StartMigrationResult =
  | { ok: true; jobId: string; templateId: string; siteName: string }
  | { ok: false; status: number; error: string; requiresOwnershipAttestation?: boolean; requiresAupAcceptance?: boolean; notWordPress?: boolean; existing?: { id: string; templateId: string } };

export async function startWordPressMigration(
  access: MigrationAccess,
  input: { sourceUrl?: string; ownershipAttested?: boolean; acceptAup?: boolean },
): Promise<StartMigrationResult> {
  const sourceUrl = input.sourceUrl?.trim();
  if (!sourceUrl) return { ok: false, status: 400, error: "Enter your WordPress site's address, like example.com." };
  if (input.ownershipAttested !== true) {
    return { ok: false, status: 400, error: "Please confirm you own this website or have permission to move it.", requiresOwnershipAttestation: true };
  }

  // Migrated pages are served exactly as WordPress rendered them (scripts included), so
  // they fall under the same one-time Acceptable Use consent as any raw HTML upload.
  const { data: user } = await User.get({ id: access.userId }).go();
  if (!user?.aupAcceptedAt) {
    if (input.acceptAup !== true) {
      return { ok: false, status: 403, error: "Please accept the Acceptable Use Policy (/legal/acceptable-use) to continue.", requiresAupAcceptance: true };
    }
    await User.patch({ id: access.userId }).set({ aupAcceptedAt: new Date().toISOString() }).go();
  }

  const { data: orgJobs } = await WpMigrationJob.query.byOrg({ organizationId: access.organizationId }).go({ pages: "all" });
  const running = orgJobs.find((j) => ACTIVE_PHASES.has(j.phase ?? "PENDING"));
  if (running) {
    return {
      ok: false,
      status: 409,
      error: "You already have a WordPress migration in progress — continue that one or wait for it to finish.",
      existing: { id: running.id, templateId: running.templateId },
    };
  }
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (orgJobs.filter((j) => (j.createdAt ?? "") > dayAgo).length >= DAILY_LIMIT) {
    return { ok: false, status: 429, error: `You can start up to ${DAILY_LIMIT} migrations a day. Try again tomorrow.` };
  }

  let install;
  try {
    install = await discoverWordPressInstall(sourceUrl);
  } catch (err) {
    if (err instanceof WordPressNotFoundError) return { ok: false, status: 422, error: err.message, notWordPress: true };
    return { ok: false, status: 502, error: "We couldn't reach that site. Check the address is right and the site is online, then try again." };
  }
  if ((await checkUrlsForThreats([install.origin])).length > 0) {
    return { ok: false, status: 400, error: "That site was flagged as unsafe (malware or phishing), so it can't be moved." };
  }

  // Always a brand-new Plexo site — a migration never overwrites one the owner already has.
  const siteName = install.siteName || new URL(install.origin).host;
  const templateId = randomUUID();
  await Template.create({
    id: templateId,
    userId: access.userId,
    organizationId: access.organizationId,
    name: siteName,
    kind: "LANDING_PAGE",
    sourceType: "RAW_UPLOAD",
    designJson: {},
    compiledHtml: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${siteName.replace(/</g, "&lt;")}</title></head><body><p>This site is being moved to Plexo…</p></body></html>`,
    migratedFrom: install.origin,
  }).go();

  const jobId = randomUUID();
  await WpMigrationJob.create({
    id: jobId,
    templateId,
    organizationId: access.organizationId,
    createdBy: access.userId,
    sourceUrl: install.homeUrl,
    install,
    phase: "PENDING",
    ownershipAttestedAt: new Date().toISOString(),
  }).go();

  return { ok: true, jobId, templateId, siteName };
}
