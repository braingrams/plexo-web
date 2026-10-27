import type { resolveUser } from "@/lib/auth/resolveUser";
import type { RevalidateFn } from "@/lib/blog/savePostCore";
import { getTierFeatures } from "@/lib/subscription";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { MIGRATION_PLAN_MESSAGE, type MigrationAccess } from "@/lib/wpMigration/access";
import { discoverWordPressInstall } from "@/lib/wpMigration/discover";
import { previewInstall } from "@/lib/wpMigration/inventory";
import { startWordPressMigration } from "@/lib/wpMigration/startMigration";
import { continueInBackground } from "@/lib/wpMigration/background";
import { donationPaymentIssue, donationPaymentsReady, processWpMigrationStep } from "@/lib/wpMigration/runJobDynamo";
import { analyzeDomain, plexoRoutingEndpoint, verifyLive, type CutoverPlan } from "@/lib/wpMigration/cutover";
import { checkConnector, createConnector, revealConnectorCode, runExtrasStep, type ConnectorState } from "@/lib/wpMigration/connector";
import { refreshReport, type MigrationReport } from "@/lib/wpMigration/report";
import { estimateMigrationSeconds, estimateSecondsLeft, formatDuration, type EstimateCounts } from "@/lib/wpMigration/estimate";

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

Returns templateId + jobId. The migration then runs on Plexo's servers by itself — a small site takes minutes, a blog with thousands of posts can take hours — and the owner is emailed when it's done (or if it pauses). Tell the owner the estimated time (preview_wordpress_migration's estimatedDuration) and that they can come back later; check progress with get_wordpress_migration.`,
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
    description: `Returns a WordPress migration's progress and estimated time left (it runs on its own; each call also nudges it along). Check back occasionally rather than polling in a tight loop — the owner is emailed when it finishes. If phase is PAUSED_ERROR, calling again retries from where it stopped. When COMPLETED, returns the report: what was copied, SEO comparison, what happened to each plugin, and a cutover checklist. Items with status "blocked" (e.g. connecting payments for a donation form) must be done before the owner points their domain at Plexo; tell the owner about them plainly. Omit jobId to get the organization's most recent migration.`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The Plexo site id returned by start_wordpress_migration." },
        jobId: { type: "string", description: "The migration id returned by start_wordpress_migration." },
      },
    },
  },
  {
    name: "connect_wordpress_migrator_plugin",
    description: `Starts copying what WordPress keeps private (past form entries and applications, donation history, drafts, redirect rules, the team list) for a finished migration. Returns a download link for the read-only "Plexo Migrator" WordPress plugin and a connection code. Tell the owner: install and activate the plugin (Plugins → Add New → Upload Plugin), then paste the code in WordPress under Tools → Plexo Migrator. Then call import_wordpress_private_data.`,
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, jobId: { type: "string" } }, required: ["templateId", "jobId"] },
  },
  {
    name: "import_wordpress_private_data",
    description: `Checks the Plexo Migrator plugin connection and copies the next batch of private data. Call repeatedly until stage is "done". If it returns an error message, relay it to the owner (it says exactly what to do, e.g. "paste the code in Tools → Plexo Migrator"). When done, the result lists the team found on WordPress — offer to invite them.`,
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, jobId: { type: "string" } }, required: ["templateId", "jobId"] },
  },
  {
    name: "get_domain_switch_plan",
    description: `For a finished migration: reads the old domain's live DNS and returns exactly how to point it at Plexo — who hosts the DNS (and whether cancelling the WordPress hosting would delete it), the email provider, records to KEEP unchanged (email, verification), records to ADD for Plexo, step-by-step instructions and a zone file. Connect the domain first with publish_existing_landing_page (CUSTOM, both apex and www) so the certificate records are included. Always relay the warnings to the owner.`,
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, jobId: { type: "string" } }, required: ["templateId", "jobId"] },
  },
  {
    name: "verify_domain_switch",
    description: `Checks on the real domain that Plexo now serves every migrated URL, email records are intact, DNS no longer depends on the old host, and nothing in the migration is blocking. Only tell the owner it's safe to cancel WordPress hosting when safeToCancelWordPress is true. Call get_domain_switch_plan first.`,
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, jobId: { type: "string" } }, required: ["templateId", "jobId"] },
  },
];

export const WP_MIGRATION_TOOL_NAMES = new Set(WP_MIGRATION_MCP_TOOLS.map((t) => t.name));

function accessFor(resolved: ResolvedUser, permission: "create" | "update"): MigrationAccess {
  const permissionError = requirePermission(resolved.role, { template: [permission] });
  if (permissionError) throw new Error("Your role in this organization can't create or edit sites.");
  if (!getTierFeatures(resolved.subscriptionPlan).siteMigrationEnabled) throw new Error(MIGRATION_PLAN_MESSAGE);
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

export async function handleWpMigrationTool(toolName: string, args: any, resolved: ResolvedUser, revalidate?: RevalidateFn): Promise<any> {
  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

  switch (toolName) {
    case "preview_wordpress_migration": {
      accessFor(resolved, "create");
      if (typeof args.url !== "string" || !args.url.trim()) throw new Error("url is required.");
      const install = await discoverWordPressInstall(args.url);
      const preview = await previewInstall(install);
      return { preview, estimatedDuration: formatDuration(estimateMigrationSeconds(preview.counts)) };
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
      // Runs on the server from here — an assistant doesn't drive it step by step.
      await continueInBackground(result.templateId, result.jobId);
      return {
        started: true,
        templateId: result.templateId,
        jobId: result.jobId,
        siteName: result.siteName,
        dashboardUrl: `${baseAppUrl}/dashboard/migrate/wordpress?site=${result.templateId}&job=${result.jobId}`,
        next: "It now runs on Plexo's servers by itself — the owner is emailed when it's done (and if it ever pauses). Call get_wordpress_migration to check progress and the estimated time left; a big blog can take hours, so tell the owner they can come back later.",
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
        await processWpMigrationStep(templateId, jobId, revalidate);
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
          report: summarizeReport(refreshReport(job.report as MigrationReport, await donationPaymentsReady(templateId), await donationPaymentIssue(templateId))),
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
        estimatedTimeLeft: (() => {
          const seconds = estimateSecondsLeft({ phase: job.phase ?? "PENDING", counts: (job.counts as EstimateCounts | undefined) ?? null, startedAt: job.startedAt });
          return seconds === null ? "still reading the WordPress site to work out its size" : formatDuration(seconds);
        })(),
        lastError: job.phase === "PAUSED_ERROR" && Array.isArray(job.errors) ? (job.errors as string[]).slice(-1)[0] : undefined,
        next: job.phase === "PAUSED_ERROR"
          ? "Call get_wordpress_migration again to retry from where it stopped."
          : "It keeps running by itself and the owner is emailed when it's done — check back later with get_wordpress_migration rather than polling continuously.",
      };
    }

    case "get_domain_switch_plan":
    case "verify_domain_switch": {
      const access = accessFor(resolved, "update");
      const { data: site } = await Template.get({ id: String(args.templateId ?? "") }).go();
      if (!site || site.organizationId !== access.organizationId) throw new Error("Migration not found.");
      const { data: job } = await WpMigrationJob.get({ templateId: site.id, id: String(args.jobId ?? "") }).go();
      if (!job?.report) throw new Error("Finish the migration first (get_wordpress_migration until COMPLETED).");
      if (toolName === "get_domain_switch_plan") {
        const host = new URL((job.install as { origin: string }).origin).host.replace(/^www\./, "");
        const { data: domains } = await PublishedDomain.query.primary({ templateId: site.id }).go();
        const validations = domains
          .filter((d) => d.type === "CUSTOM" && (d.domain === host || d.domain === `www.${host}`))
          .map((d) => d as { certificateValidationName?: string; certificateValidationValue?: string })
          .filter((d) => d.certificateValidationName && d.certificateValidationValue)
          .map((d) => ({ name: d.certificateValidationName!, value: d.certificateValidationValue! }));
        const plan = await analyzeDomain((job.install as { origin: string }).origin, { routingEndpoint: plexoRoutingEndpoint(), validations });
        await WpMigrationJob.patch({ templateId: site.id, id: job.id }).set({ cutover: { ...((job.cutover as object | undefined) ?? {}), plan } }).go();
        return { ...plan, connectedDomains: domains.filter((d) => d.type === "CUSTOM").map((d) => d.domain) };
      }
      const plan = (job.cutover as { plan?: CutoverPlan } | undefined)?.plan;
      if (!plan) throw new Error("Call get_domain_switch_plan first.");
      const verification = await verifyLive(job, plan, refreshReport(job.report as MigrationReport, await donationPaymentsReady(site.id), await donationPaymentIssue(site.id)));
      await WpMigrationJob.patch({ templateId: site.id, id: job.id }).set({ cutover: { ...(job.cutover as object), verification } }).go();
      return verification;
    }

    case "connect_wordpress_migrator_plugin":
    case "import_wordpress_private_data": {
      const access = accessFor(resolved, "update");
      const { data: site } = await Template.get({ id: String(args.templateId ?? "") }).go();
      if (!site || site.organizationId !== access.organizationId) throw new Error("Migration not found.");
      const { data: job } = await WpMigrationJob.get({ templateId: site.id, id: String(args.jobId ?? "") }).go();
      if (!job) throw new Error("Migration not found.");
      if (toolName === "connect_wordpress_migrator_plugin") {
        const code = revealConnectorCode(job) ?? (await createConnector(job));
        return { pluginDownloadUrl: `${baseAppUrl}/api/v1/wp-migration/plugin`, connectionCode: code, steps: ["Install and activate the plugin (Plugins → Add New → Upload Plugin).", "In WordPress, go to Tools → Plexo Migrator and paste the connection code.", "Then call import_wordpress_private_data."] };
      }
      let current = job;
      if ((job.connector as ConnectorState | undefined)?.status !== "CONNECTED") {
        const state = await checkConnector(job);
        if (state.status !== "CONNECTED") return { connected: false, message: state.error };
        current = (await WpMigrationJob.get({ templateId: site.id, id: job.id }).go()).data ?? job;
      }
      const extras = await runExtrasStep(current, revalidate);
      return { connected: true, stage: extras.stage, counts: extras.counts, team: extras.stage === "done" ? extras.team : undefined, error: extras.error, next: extras.stage === "done" ? "Done. Offer to invite the team (admins as admin, others as editor of this site)." : "Call import_wordpress_private_data again to continue." };
    }
  }
  throw new Error(`Unknown tool: ${toolName}`);
}
