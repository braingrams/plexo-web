import { randomUUID } from "node:crypto";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getAvailableFunnelSlots } from "@/lib/lms/funnelSlots";
import { defaultUnlockRules } from "@/lib/lms/rules";
import { compileFunnelStarterDesign } from "@/lib/lms/funnelStarterDesign";
import { sendMagicLinkEmail } from "@/lib/lms/enrollment";
import { Template, LmsFunnel, LmsPage, LmsEnrollment, LmsPageProgress, LmsFunnelAddonSlot } from "@/lib/db/contentEntities";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

/** Every Funnel/LMS tool is scoped to a "site" — a root Template (parentId === null) owned
 * by the caller's organization, same convention as commerceTools.ts's resolveCommerceSiteId. */
async function resolveLmsSiteId(resolved: ResolvedUser, templateId: unknown): Promise<string> {
  const trimmed = typeof templateId === "string" ? templateId.trim() : "";
  if (!trimmed) {
    throw new Error("templateId is required — pass the site's home page id (see list_landing_pages).");
  }
  const { data: site } = await Template.get({ id: trimmed }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    throw new Error(`No site found with id "${trimmed}" in this account. templateId must be a site's home page (no parent) — use list_landing_pages to find it.`);
  }
  return site.id;
}

async function requireFunnel(templateId: string) {
  const { data: funnel } = await LmsFunnel.get({ templateId }).go();
  if (!funnel) throw new Error(`Site "${templateId}" isn't a funnel yet — call create_funnel first.`);
  return funnel;
}

const PAGE_KINDS = new Set(["WELCOME", "VIDEO", "DOCUMENT", "IMAGE"]);
const CONTENT_MODES = new Set(["SIMPLE", "RAW_HTML", "ADVANCED"]);

export const LMS_MCP_TOOLS = [
  {
    name: "create_funnel",
    description: "Attaches Funnel/LMS capability to an existing root landing page (see create_landing_page / list_landing_pages for how to get one), seeding a single Welcome page. Gated by the organization's funnel slot allowance (get_funnel_addon_slots shows current usage) — fails with the slot summary if none is available.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "An existing root landing page's template id to turn into a funnel." } },
      required: ["templateId"],
    },
  },
  {
    name: "get_funnel",
    description: "Fetches a funnel's settings: enabled state, signup mode (FREE/PAID), signup product, and welcome-page options.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The funnel's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "update_funnel",
    description: "Updates a funnel's settings. Only the fields provided are changed. Switching signupMode to PAID requires signupProductId (a DIGITAL Commerce product) to already be set or provided here.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The funnel's home page template id." },
        enabled: { type: "boolean" },
        signupMode: { type: "string", enum: ["FREE", "PAID"] },
        signupProductId: { type: "string", description: "A DIGITAL Commerce product id (see create_commerce_product). Pass an empty string to clear it." },
        requireName: { type: "boolean" },
        collectPhone: { type: "boolean" },
        welcomeRedirectPath: { type: "string", description: "Pass an empty string to clear it." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "delete_funnel",
    description: "Soft-deletes a funnel (enabled:false — hidden from visitors). Pages, enrollments, and progress are kept, so re-enabling later restores everything as-is.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The funnel's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "list_funnel_pages",
    description: "Lists a funnel's pages in their display order.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The funnel's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "create_funnel_page",
    description: "Appends a new page to a funnel. Defaults to kind VIDEO and unlocks after the current last page (defaultUnlockRules) — use update_funnel_page to customize unlockRules afterward.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The funnel's home page template id." },
        title: { type: "string", description: "Defaults to \"Page N\"." },
        kind: { type: "string", enum: ["WELCOME", "VIDEO", "DOCUMENT", "IMAGE"], description: "Defaults to VIDEO." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "update_funnel_page",
    description: "Updates a funnel page's content and/or unlock rules. Only the fields provided are changed. unlockRules shape: { mode: \"ALL\", conditions: [...] } where each condition is one of PREREQUISITE_PAGES ({type,pageIds}), TIME_DRIP_RELATIVE ({type,days}), TIME_DRIP_FIXED_DATE ({type,date}), MANUAL_APPROVAL ({type}) — satisfied via approve_funnel_enrollment_page.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The funnel's home page template id." },
        pageId: { type: "string" },
        title: { type: "string" },
        kind: { type: "string", enum: ["WELCOME", "VIDEO", "DOCUMENT", "IMAGE"] },
        contentMode: { type: "string", enum: ["SIMPLE", "RAW_HTML", "ADVANCED"], description: "SIMPLE/RAW_HTML both write to bodyHtml; ADVANCED is a full-builder page and isn't settable from here." },
        bodyHtml: { type: "string", description: "Sanitized server-side. For a WELCOME page this renders as plain text, not markup." },
        youtubeVideoId: { type: "string", description: "Empty string clears it." },
        assetUrl: { type: "string", description: "Already-uploaded file URL (this tool can't accept raw bytes). Empty string clears it." },
        assetFileName: { type: "string" },
        assetMimeType: { type: "string" },
        assetSizeBytes: { type: "number" },
        unlockRules: { type: "object", description: "See this tool's description for the shape." },
        visible: { type: "boolean" },
      },
      required: ["templateId", "pageId"],
    },
  },
  {
    name: "delete_funnel_page",
    description: "Deletes a funnel page and closes the resulting order gap in the remaining pages.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The funnel's home page template id." },
        pageId: { type: "string" },
      },
      required: ["templateId", "pageId"],
    },
  },
  {
    name: "reorder_funnel_pages",
    description: "Reorders a funnel's pages. orderedPageIds must contain exactly this funnel's current page ids, in the new order.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The funnel's home page template id." },
        orderedPageIds: { type: "array", items: { type: "string" } },
      },
      required: ["templateId", "orderedPageIds"],
    },
  },
  {
    name: "list_funnel_enrollments",
    description: "Lists a funnel's learner enrollments, most recently enrolled first.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The funnel's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "get_funnel_enrollment",
    description: "Fetches one learner's enrollment plus their per-page progress.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The funnel's home page template id." },
        email: { type: "string" },
      },
      required: ["templateId", "email"],
    },
  },
  {
    name: "approve_funnel_enrollment_page",
    description: "Marks one page as manually approved for one learner — the way a MANUAL_APPROVAL unlock condition gets satisfied (see update_funnel_page's unlockRules description). Reversible: calling it again just re-stamps the approval.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The funnel's home page template id." },
        email: { type: "string" },
        pageId: { type: "string" },
      },
      required: ["templateId", "email", "pageId"],
    },
  },
  {
    name: "set_funnel_enrollment_status",
    description: "Revokes or reactivates a learner's enrollment. Revoked takes effect immediately on their next page load (no session to separately invalidate).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The funnel's home page template id." },
        email: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "REVOKED"] },
      },
      required: ["templateId", "email", "status"],
    },
  },
  {
    name: "resend_funnel_magic_link",
    description: "Re-sends the passwordless login email to an ACTIVE learner. Rate-limited to once per 60 seconds per learner.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The funnel's home page template id." },
        email: { type: "string" },
      },
      required: ["templateId", "email"],
    },
  },
  {
    name: "get_funnel_addon_slots",
    description: "Reports the organization's funnel slot usage (plan-included + purchased addon slots vs. funnels currently using one) and any active addon-slot subscriptions. Org-scoped, not per-site.",
    inputSchema: { type: "object", properties: {} },
  },
];

export const LMS_TOOL_NAMES = new Set(LMS_MCP_TOOLS.map((t) => t.name));

export async function handleLmsTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  switch (toolName) {
    case "create_funnel": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      const { data: template } = await Template.get({ id: siteId }).go();
      if (!template) throw new Error(`Site "${siteId}" vanished unexpectedly.`);

      const { data: existing } = await LmsFunnel.get({ templateId: siteId }).go();
      if (existing) throw new Error("This site is already a funnel.");

      const slots = await getAvailableFunnelSlots(resolved.organizationId, resolved.subscriptionPlan);
      if (!slots.hasSlotAvailable) {
        throw new Error(`You've used every funnel slot your plan includes (${slots.used}/${slots.total}). Buy another slot to create more.`);
      }

      const funnelId = randomUUID();
      const { designJson, compiledHtml } = await compileFunnelStarterDesign(template.name, siteId);
      await Promise.all([
        LmsFunnel.create({ id: funnelId, templateId: siteId, organizationId: resolved.organizationId, userId: resolved.userId }).go(),
        Template.patch({ id: siteId }).set({ isLmsFunnel: true, designJson, compiledHtml }).go(),
      ]);
      await LmsPage.create({
        id: randomUUID(),
        templateId: siteId,
        organizationId: resolved.organizationId,
        order: 0,
        kind: "WELCOME",
        title: "Welcome",
        bodyHtml: "Welcome! We're glad you're here.",
        unlockRules: defaultUnlockRules(null),
      }).go();

      const { data: funnel } = await LmsFunnel.get({ templateId: siteId }).go();
      return { success: true, funnel };
    }

    case "get_funnel": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      return { funnel: await requireFunnel(siteId) };
    }

    case "update_funnel": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      const existing = await requireFunnel(siteId);

      if (args.signupMode === "PAID" && !args.signupProductId && !existing.signupProductId) {
        throw new Error("Provide signupProductId to charge for signup before switching to PAID.");
      }
      if (args.signupMode !== undefined && args.signupMode !== "FREE" && args.signupMode !== "PAID") {
        throw new Error("signupMode must be FREE or PAID.");
      }

      const patch: Record<string, unknown> = {};
      if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
      if (args.signupMode === "FREE" || args.signupMode === "PAID") patch.signupMode = args.signupMode;
      if (args.signupProductId !== undefined) patch.signupProductId = args.signupProductId || undefined;
      if (typeof args.requireName === "boolean") patch.requireName = args.requireName;
      if (typeof args.collectPhone === "boolean") patch.collectPhone = args.collectPhone;
      if (args.welcomeRedirectPath !== undefined) patch.welcomeRedirectPath = args.welcomeRedirectPath || undefined;

      if (Object.keys(patch).length > 0) {
        await LmsFunnel.patch({ templateId: siteId }).set(patch).go();
      }
      const { data: funnel } = await LmsFunnel.get({ templateId: siteId }).go();
      return { success: true, funnel };
    }

    case "delete_funnel": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      await LmsFunnel.patch({ templateId: siteId }).set({ enabled: false }).go();
      return { success: true };
    }

    case "list_funnel_pages": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const { data: pages } = await LmsPage.query.byOrder({ templateId: siteId }).go({ pages: "all" });
      return { pages };
    }

    case "create_funnel_page": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const kind = PAGE_KINDS.has(args.kind) ? args.kind : "VIDEO";
      const { data: existingPages } = await LmsPage.query.byOrder({ templateId: siteId }).go({ pages: "all" });
      const nextOrder = existingPages.length;
      const previousPage = existingPages[existingPages.length - 1];

      const id = randomUUID();
      await LmsPage.create({
        id,
        templateId: siteId,
        organizationId: resolved.organizationId,
        order: nextOrder,
        kind,
        title: (typeof args.title === "string" && args.title.trim()) || `Page ${nextOrder + 1}`,
        unlockRules: defaultUnlockRules(previousPage?.id ?? null),
      }).go();
      const { data: page } = await LmsPage.get({ templateId: siteId, id }).go();
      return { success: true, page };
    }

    case "update_funnel_page": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const pageId = typeof args.pageId === "string" ? args.pageId.trim() : "";
      if (!pageId) throw new Error("pageId is required.");
      const { data: existing } = await LmsPage.get({ templateId: siteId, id: pageId }).go();
      if (!existing) throw new Error(`Page not found with id "${pageId}".`);

      if (args.kind !== undefined && !PAGE_KINDS.has(args.kind)) throw new Error("kind must be WELCOME, VIDEO, DOCUMENT, or IMAGE.");
      if (args.contentMode !== undefined && !CONTENT_MODES.has(args.contentMode)) throw new Error("contentMode must be SIMPLE, RAW_HTML, or ADVANCED.");

      const patch: Record<string, unknown> = {};
      if (typeof args.title === "string" && args.title.trim()) patch.title = args.title.trim();
      if (args.kind !== undefined) patch.kind = args.kind;
      if (args.contentMode !== undefined) patch.contentMode = args.contentMode;
      if (args.bodyHtml !== undefined) patch.bodyHtml = args.bodyHtml;
      if (args.youtubeVideoId !== undefined) patch.youtubeVideoId = args.youtubeVideoId || undefined;
      if (args.assetUrl !== undefined) patch.assetUrl = args.assetUrl || undefined;
      if (args.assetFileName !== undefined) patch.assetFileName = args.assetFileName || undefined;
      if (args.assetMimeType !== undefined) patch.assetMimeType = args.assetMimeType || undefined;
      if (args.assetSizeBytes !== undefined) patch.assetSizeBytes = args.assetSizeBytes || undefined;
      if (args.unlockRules) patch.unlockRules = args.unlockRules;
      if (typeof args.visible === "boolean") patch.visible = args.visible;

      if (Object.keys(patch).length > 0) {
        await LmsPage.patch({ templateId: siteId, id: pageId }).set(patch).go();
      }
      const { data: page } = await LmsPage.get({ templateId: siteId, id: pageId }).go();
      return { success: true, page };
    }

    case "delete_funnel_page": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const pageId = typeof args.pageId === "string" ? args.pageId.trim() : "";
      if (!pageId) throw new Error("pageId is required.");
      const { data: existing } = await LmsPage.get({ templateId: siteId, id: pageId }).go();
      if (!existing) throw new Error(`Page not found with id "${pageId}".`);

      await LmsPage.delete({ templateId: siteId, id: pageId }).go();
      const { data: remaining } = await LmsPage.query.byOrder({ templateId: siteId }).go({ pages: "all" });
      await Promise.all(
        remaining.map((page, index) => (page.order === index ? Promise.resolve() : LmsPage.patch({ templateId: siteId, id: page.id }).set({ order: index }).go())),
      );
      return { success: true };
    }

    case "reorder_funnel_pages": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const orderedPageIds = args.orderedPageIds;
      if (!Array.isArray(orderedPageIds) || orderedPageIds.length === 0) throw new Error("orderedPageIds is required.");

      const { data: existingPages } = await LmsPage.query.byOrder({ templateId: siteId }).go({ pages: "all" });
      const existingIds = new Set(existingPages.map((p) => p.id));
      if (orderedPageIds.length !== existingPages.length || !orderedPageIds.every((id: unknown) => typeof id === "string" && existingIds.has(id))) {
        throw new Error("orderedPageIds must contain exactly this funnel's current pages.");
      }

      await Promise.all(orderedPageIds.map((id: string, index: number) => LmsPage.patch({ templateId: siteId, id }).set({ order: index }).go()));
      const { data: pages } = await LmsPage.query.byOrder({ templateId: siteId }).go({ pages: "all" });
      return { pages };
    }

    case "list_funnel_enrollments": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const { data: enrollments } = await LmsEnrollment.query.byEnrolledAt({ templateId: siteId }).go({ pages: "all" });
      enrollments.sort((a, b) => (b.enrolledAt ?? "").localeCompare(a.enrolledAt ?? ""));
      return { enrollments };
    }

    case "get_funnel_enrollment": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
      if (!email) throw new Error("email is required.");
      const [{ data: enrollment }, { data: progress }] = await Promise.all([
        LmsEnrollment.get({ templateId: siteId, email }).go(),
        LmsPageProgress.query.primary({ templateId: siteId, email }).go({ pages: "all" }),
      ]);
      if (!enrollment) throw new Error(`Enrollment not found for "${email}".`);
      return { enrollment, progress };
    }

    case "approve_funnel_enrollment_page": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
      const pageId = typeof args.pageId === "string" ? args.pageId.trim() : "";
      if (!email || !pageId) throw new Error("email and pageId are required.");

      const [{ data: enrollment }, { data: page }] = await Promise.all([
        LmsEnrollment.get({ templateId: siteId, email }).go(),
        LmsPage.get({ templateId: siteId, id: pageId }).go(),
      ]);
      if (!enrollment) throw new Error(`Enrollment not found for "${email}".`);
      if (!page) throw new Error(`Page not found with id "${pageId}".`);

      await LmsPageProgress.upsert({ templateId: siteId, email, pageId, adminApprovedAt: new Date().toISOString(), adminApprovedByUserId: resolved.userId }).go();
      const { data: progress } = await LmsPageProgress.get({ templateId: siteId, email, pageId }).go();
      return { success: true, progress };
    }

    case "set_funnel_enrollment_status": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
      if (!email) throw new Error("email is required.");
      if (args.status !== "ACTIVE" && args.status !== "REVOKED") throw new Error("status must be ACTIVE or REVOKED.");

      const { data: existing } = await LmsEnrollment.get({ templateId: siteId, email }).go();
      if (!existing) throw new Error(`Enrollment not found for "${email}".`);

      await LmsEnrollment.patch({ templateId: siteId, email })
        .set(args.status === "REVOKED" ? { status: "REVOKED", revokedAt: new Date().toISOString(), revokedByUserId: resolved.userId } : { status: "ACTIVE" })
        .go();
      const { data: enrollment } = await LmsEnrollment.get({ templateId: siteId, email }).go();
      return { success: true, enrollment };
    }

    case "resend_funnel_magic_link": {
      const siteId = await resolveLmsSiteId(resolved, args.templateId);
      await requireFunnel(siteId);
      const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
      if (!email) throw new Error("email is required.");

      const { data: enrollment } = await LmsEnrollment.get({ templateId: siteId, email }).go();
      if (!enrollment) throw new Error(`Enrollment not found for "${email}".`);
      if (enrollment.status !== "ACTIVE") throw new Error("This enrollment is revoked — reactivate it first.");
      const RESEND_COOLDOWN_MS = 60_000;
      if (enrollment.magicLinkLastSentAt && Date.now() - new Date(enrollment.magicLinkLastSentAt).getTime() < RESEND_COOLDOWN_MS) {
        throw new Error("A link was just sent — wait a moment before resending.");
      }

      await sendMagicLinkEmail(siteId, email);
      return { success: true };
    }

    case "get_funnel_addon_slots": {
      const [slots, { data: addonSlots }] = await Promise.all([
        getAvailableFunnelSlots(resolved.organizationId, resolved.subscriptionPlan),
        LmsFunnelAddonSlot.query.primary({ organizationId: resolved.organizationId }).go({ pages: "all" }),
      ]);
      return { ...slots, addonSlots: addonSlots.filter((s) => s.status !== "CANCELLED").map((s) => ({ id: s.id, status: s.status, createdAt: s.createdAt })) };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
