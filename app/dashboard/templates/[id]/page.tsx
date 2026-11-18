import { effectivePlan } from "@/lib/plan/entitlement";
import { lockedTierFor } from "@/lib/ai/solEngine";
import { notFound, redirect } from "next/navigation";
import type { TemplateJSON } from "@charisol/plexo-sdk";

import { auth } from "@/server/authDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { findRootTemplateId } from "@/lib/siteLayoutDynamo";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { resolveActiveApiKeyForUser } from "@/lib/ai/resolveUserAiKey";

import { TemplateEditorDynamic } from "./template-editor-dynamic";
import { RawFileEditor } from "./raw-file-editor";
import { migratedPreviewBase } from "@/lib/wpMigration/previewBase";
import { canMoveToV2 } from "@/lib/v2/convertV1";
import { designFormatOf, parseV2Design } from "@/lib/v2/design";
import { designSystemDownloadUrl, resolveDesignSystem } from "@/lib/v2/designSystemStore";

/** Up to this many characters of brand are handed to the editor with the page; beyond it the browser loads the brand itself. */
const BRAND_INLINE_MAX_CHARS = 2_000_000;

function isTemplateJson(value: unknown): value is TemplateJSON {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const body = (value as { body?: unknown }).body;
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const rows = (body as { rows?: unknown }).rows;
  return Array.isArray(rows);
}

const BLANK_TEMPLATE_SHELL: TemplateJSON = {
  body: {
    style: {
      background: "#0b0f19",
      padding: "24px",
    },
    rows: [],
  },
};

export default async function TemplateEditorPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/auth/login?redirectTo=/dashboard/templates/${params.id}`);
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: template } = await Template.get({ id: params.id }).go();
  if (!template || template.organizationId !== orgResolution.organizationId) {
    notFound();
  }
  // React apps have their own editor (code, preview, database, AI) — any link here for one
  // (site lists, domains, older bookmarks) lands there.
  if (template.sourceType === "REACT_PROJECT") {
    redirect(`/dashboard/apps/${template.id}`);
  }

  const [{ data: user }, activeApiKey] = await Promise.all([
    User.get({ id: session.user.id }).go(),
    resolveActiveApiKeyForUser(session.user.id),
  ]);
  // Free accounts on Plexo's AI run on Basic everywhere (lib/ai/solEngine.ts) — show that.
  const basicLock = !!(await lockedTierFor(session.user.id));

  // Commerce (and Site Layout) are scoped per SITE (the root Template — parentId null),
  // not per page, so a sub-page's editor needs to walk up to the root to know whether to
  // show the Commerce block palette / where to link Site Layout. Most sites are only one
  // level deep, but the page tree can nest further.
  const rootTemplateId = await findRootTemplateId(
    template.id,
    template.parentId ?? null,
  );
  const { data: commerceSettings } = await CommerceSettings.get({
    templateId: rootTemplateId,
  }).go();

  const tierFeatures = getTierFeatures(effectivePlan(user));

  if (template.sourceType === "RAW_UPLOAD") {
    return (
      <RawFileEditor
        templateId={template.id}
        siteId={rootTemplateId}
        templateName={template.name}
        templateKind={template.kind}
        subscriptionPlan={effectivePlan(user)}
        useAi={activeApiKey?.useAi ?? tierFeatures.aiEnabled}
        aiProvider={activeApiKey?.aiProvider ?? "openai"}
        aiTier={basicLock ? "BASIC" : activeApiKey?.aiTier ?? tierFeatures.sdkAiTier}
        previewBaseHref={await migratedPreviewBase(template)}
      />
    );
  }

  const designFormat = designFormatOf(template);
  let initialV2Design = null;
  if (designFormat === "v2") {
    const parsed = parseV2Design(template.draftJson ?? template.designJson);
    if (!parsed.ok) {
      // Never open an editor on a design it can't read: saving would overwrite the real one.
      return (
        <div style={{ padding: "3rem 1.5rem", maxWidth: 560, margin: "0 auto", textAlign: "center", color: "var(--ed-t-800)" }}>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 800 }}>This page can&rsquo;t be opened right now</h1>
          <p style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>{parsed.error} Nothing has been changed. You can restore an earlier version from the site&rsquo;s version history, or contact support.</p>
        </div>
      );
    }
    initialV2Design = parsed.design;
    // A big brand lives in storage: a modest one is loaded here and handed over as usual; a very large one is left for the browser
    // to fetch straight from storage (it can be larger than this page's own response may be).
    const ref = parsed.design.designSystemRef;
    if (ref) {
      try {
        if (ref.size <= BRAND_INLINE_MAX_CHARS) initialV2Design = await resolveDesignSystem(parsed.design);
        else initialV2Design = { ...parsed.design, designSystemUrl: await designSystemDownloadUrl(ref.hash) };
      } catch (err) {
        return (
          <div style={{ padding: "3rem 1.5rem", maxWidth: 560, margin: "0 auto", textAlign: "center", color: "var(--ed-t-800)" }}>
            <h1 style={{ fontSize: "1.2rem", fontWeight: 800 }}>This page can&rsquo;t be opened right now</h1>
            <p style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>{err instanceof Error ? err.message : "Its colours and fonts couldn't be loaded."} Nothing has been changed. Please try again in a moment.</p>
          </div>
        );
      }
    }
  }

  const liveDesignJson = isTemplateJson(template.designJson)
    ? template.designJson
    : BLANK_TEMPLATE_SHELL;
  const initialDesignJson = isTemplateJson(template.draftJson)
    ? template.draftJson
    : liveDesignJson;
  const hasUnpublishedChanges = template.draftJson != null;

  const unsplashKey = process.env.UNSPLASH_KEY || "";
  const pexelsKey = process.env.PEXELS_KEY || "";
  const pixabayKey = process.env.PIXABAY_KEY || "";

  return (
    <TemplateEditorDynamic
      templateId={template.id}
      templateName={template.name}
      templateKind={template.kind}
      templateParentId={template.parentId ?? null}
      initialDesignJson={initialDesignJson}
      liveDesignJson={liveDesignJson}
      hasUnpublishedChanges={hasUnpublishedChanges}
      subscriptionPlan={effectivePlan(user)}
      useAi={activeApiKey?.useAi ?? tierFeatures.aiEnabled}
      aiProvider={activeApiKey?.aiProvider ?? "openai"}
      aiTier={basicLock ? "BASIC" : activeApiKey?.aiTier ?? tierFeatures.sdkAiTier}
      unsplashKey={unsplashKey}
      pexelsKey={pexelsKey}
      pixabayKey={pixabayKey}
      currentUserId={session.user.id}
      currentUserRole={orgResolution.role}
      organizationId={orgResolution.organizationId}
      isBlogLayout={template.isBlogLayout ?? false}
      commerceEnabled={commerceSettings?.enabled ?? false}
      maildripConnected={Boolean(commerceSettings?.maildripApiKeyEncrypted)}
      rootTemplateId={rootTemplateId}
      designFormat={designFormat}
      initialV2Design={initialV2Design}
      canTryNewEditor={canMoveToV2(template)}
      canGoBackToClassic={designFormat === "v2" && !!template.classicBackupId}
      templateSlug={template.slug ?? null}
    />
  );
}
