import type { resolveUser } from "@/lib/auth/resolveUser";
import { getTierFeatures } from "@/lib/subscription";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { MIGRATION_PLAN_MESSAGE, type MigrationAccess } from "@/lib/wpMigration/access";
import { discoverWordPressInstall } from "@/lib/wpMigration/discover";
import { previewInstall } from "@/lib/wpMigration/inventory";
import { startWordPressMigration } from "@/lib/wpMigration/startMigration";
import { processWpMigrationStep } from "@/lib/wpMigration/runJobDynamo";
import type { MigrationReport } from "@/lib/wpMigration/report";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// WordPress → Plexo migration for AI assistants, with the same three-step shape as the
// dashboard (preview → start → follow progress to the report). get_wordpress_migration
// also ADVANCES the migration by one bounded step each call, the way the open dashboard
// tab does — so an assistant that keeps polling finishes the job promptly instead of
// waiting on the background resume schedule.

export const WP_MIGRATION_MCP_TOOLS = [
  {
    name: "preview_wordpress_migration",
    description: `Checks a WordPress website and previews what moving it to Plexo would involve — WITHOUT changing anything. Finds WordPress even when it's installed in a subfolder or behind a splash/landing page, and returns page/post/media counts, the theme, and what will happen to each plugin (replaced by a Plexo feature, carried over as-is, needs attention, or not needed). Call this first and show the owner the plugin outcomes — especially anything marked NEEDS_ATTENTION (e.g. payment/donation plugins) — before calling start_wordpress_migration.`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The site's public address, e.g. 'example.org' or 'https://example.org/blog'. Any page on the site works." },
      },
      required: ["url"],
    },
  },
  {
    name: "start_wordpress_migration",
    description: `Starts moving a WordPress site to a NEW Plexo site (never overwrites an existing one). Copies every page exactly as it looks (theme, Elementor and other page-builder designs, fonts, animations), every blog post into Plexo Blog, the whole media library, and every SEO tag — keeping every web address identical so search rankings and links survive. Forms (Forminator, Contact Form 7, WPForms, Elementor) are reconnected to Plexo Forms. The WordPress site itself is not changed.

Requires the owner's explicit confirmation that they own the site (ownershipConfirmed: true) — ask them, never assume. If their account hasn't accepted Plexo's Acceptable Use Policy yet, the call fails with requiresAupAcceptance; ask them to read /legal/acceptable-use and retry with acceptAcceptableUsePolicy: true only if they agree.

Returns templateId + jobId. Then call get_wordpress_migration repeatedly (each call advances the migration) until phase is COMPLETED.`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The site's public address (same as preview_wordpress_migration)." },
        ownershipConfirmed: { type: "boolean", description: "true only if the owner confirmed they own the site or have permission to move it." },
        acceptAcceptableUsePolicy: { type: "boolean", description: "true only if the owner agreed to Plexo's Acceptable Use Policy (needed once per account)." },
      },
      required: ["url", "ownershipConfirmed"],
    },
  },
  {
    name: "get_wordpress_migration",
    description: `Advances a WordPress migration by one step and returns its progress — call it repeatedly until phase is COMPLETED (or PAUSED_ERROR, in which case calling again retries from where it stopped). When COMPLETED, returns the report: what was copied, SEO comparison, what happened to each plugin, and a cutover checklist. Items with status "blocked" (e.g. connecting payments for a donation form) must be done before the owner points their domain at Plexo; tell the owner about them plainly. Omit jobId to get the organization's most recent migration.`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The Plexo site id returned by start_wordpress_migration." },
        jobId: { type: "string", description: "The migration id returned by start_wordpress_migration." },
      },
    },
  },
];

export const WP_MIGRATION_TOOL_NAMES = new Set(WP_MIGRATION_MCP_TOOLS.map((t) => t.name));

function accessFor(resolved: ResolvedUser, permission: "create" | "update"): MigrationAccess {
  const permissionError = requirePermission(resolved.role, { template: [permission] });
  if (permissionError) throw new Error("Your role in this organization can't create or edit sites.");
  if (!getTierFeatures(resolved.subscriptionPlan).multiPageSitesEnabled) throw new Error(MIGRATION_PLAN_MESSAGE);
  return { userId: resolved.userId, organizationId: resolved.organizationId, role: resolved.role, subscriptionPlan: resolved.subscriptionPlan };
}

function summarizeReport(report: MigrationReport) {
  return {
    readyForCutover: report.readyForCutover,
    checklist: report.checklist,
    summary: report.summary,
    seo: report.seo,
    plugins: report.plugins.map((p) => ({ name: p.name, outcome: p.outcome, explanation: p.explanation })),
    formsReconnected: report.forms.map((f) => ({ page: f.page, name: f.name, fields: f.fields })),
    brokenLinks: report.brokenLinks.slice(0, 20),
    failedFiles: report.failedFiles.slice(0, 20),
  };
}

export async function handleWpMigrationTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

  switch (toolName) {
    case "preview_wordpress_migration": {
      accessFor(resolved, "create");
      if (typeof args.url !== "string" || !args.url.trim()) throw new Error("url is required.");
      const install = await discoverWordPressInstall(args.url);
      return { preview: await previewInstall(install) };
    }

    case "start_wordpress_migration": {
      const access = accessFor(resolved, "create");
      const result = await startWordPressMigration(access, {
        sourceUrl: args.url,
        ownershipAttested: args.ownershipConfirmed === true,
        acceptAup: args.acceptAcceptableUsePolicy === true,
      });
      if (!result.ok) {
        return { started: false, error: result.error, requiresAupAcceptance: result.requiresAupAcceptance ?? false, existingMigration: result.existing ?? null };
      }
      return {
        started: true,
        templateId: result.templateId,
        jobId: result.jobId,
        siteName: result.siteName,
        dashboardUrl: `${baseAppUrl}/dashboard/migrate/wordpress?site=${result.templateId}&job=${result.jobId}`,
        next: "Call get_wordpress_migration with this templateId and jobId until phase is COMPLETED.",
      };
    }

    case "get_wordpress_migration": {
      const access = accessFor(resolved, "update");
      let templateId: string | undefined = typeof args.templateId === "string" ? args.templateId : undefined;
      let jobId: string | undefined = typeof args.jobId === "string" ? args.jobId : undefined;
      if (!jobId || !templateId) {
        const { data } = await WpMigrationJob.query.byOrg({ organizationId: access.organizationId }).go({ order: "desc", limit: 1 });
        if (!data[0]) return { found: false, message: "No WordPress migrations yet — start one with start_wordpress_migration." };
        templateId = data[0].templateId;
        jobId = data[0].id;
      }
      const { data: site } = await Template.get({ id: templateId }).go();
      if (!site || site.organizationId !== access.organizationId) throw new Error("Migration not found.");

      const { data: before } = await WpMigrationJob.get({ templateId, id: jobId }).go();
      if (!before) throw new Error("Migration not found.");
      if (!["COMPLETED", "FAILED", "CANCELLED"].includes(before.phase ?? "PENDING")) {
        await processWpMigrationStep(templateId, jobId);
      }
      const [{ data: job }, { data: domains }] = await Promise.all([
        WpMigrationJob.get({ templateId, id: jobId }).go(),
        PublishedDomain.query.primary({ templateId }).go(),
      ]);
      if (!job) throw new Error("Migration not found.");
      const dashboardUrl = `${baseAppUrl}/dashboard/migrate/wordpress?site=${templateId}&job=${jobId}`;
      if (job.phase === "COMPLETED" && job.report) {
        return {
          phase: job.phase,
          templateId,
          jobId,
          dashboardUrl,
          publishedDomains: domains.map((d) => d.domain),
          report: summarizeReport(job.report as MigrationReport),
          next: domains.length === 0
            ? "Offer to publish a preview with publish_existing_landing_page (subdomain), then have the owner connect their own domain in Plexo's Domains page. Keep WordPress running until the domain shows the Plexo site."
            : "Have the owner connect their own domain in Plexo's Domains page once nothing in the checklist is blocked.",
        };
      }
      return {
        phase: job.phase,
        templateId,
        jobId,
        dashboardUrl,
        counts: job.counts ?? null,
        lastError: job.phase === "PAUSED_ERROR" && Array.isArray(job.errors) ? (job.errors as string[]).slice(-1)[0] : undefined,
        next: job.phase === "PAUSED_ERROR" ? "Call get_wordpress_migration again to retry from where it stopped." : "Call get_wordpress_migration again to continue.",
      };
    }
  }
  throw new Error(`Unknown tool: ${toolName}`);
}
