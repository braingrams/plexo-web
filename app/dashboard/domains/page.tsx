import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { Template, PublishedDomain, RegisteredDomain } from "@/lib/db/contentEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { DomainsClient } from "./domains-client";
import { PageContainer } from "../_components/PageContainer";

export default async function DomainsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: user } = await User.get({ id: session.user.id }).go();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: orgResolution.organizationId }).go({ pages: "all" });

  // Fetch the org's landing pages to link/re-link — root/home pages only. A domain always
  // links to a page tree's root; its sub-pages ride along under that same domain via the
  // page-tree walk in app/pub/[domain]/[[...slug]], they never get an independent
  // PublishedDomain of their own, so listing them here would let someone "link a domain"
  // to a page that can't actually be a site root.
  const landingPages = orgTemplates
    .filter((t) => t.kind === "LANDING_PAGE" && !t.parentId && !t.isBlogLayout && !t.isCommerceLayout)
    // Tie-break on createdAt — the org-backfill migration bumped every template's
    // updatedAt to the same instant.
    .sort((a, b) => {
      const byUpdated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      if (byUpdated !== 0) return byUpdated;
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    })
    .map((t) => ({ id: t.id, name: t.name }));

  // PublishedDomain has no org-wide index (only templateId-primary and byDomain-GSI1,
  // see contentEntities.ts) — fans out per root template, same bound as the dashboard
  // overview page's identical query.
  const templateNameById = new Map(orgTemplates.map((t) => [t.id, t.name]));
  const rootTemplateIds = orgTemplates.filter((t) => !t.parentId).map((t) => t.id);
  const domainBatches = await Promise.all(rootTemplateIds.map((id) => PublishedDomain.query.primary({ templateId: id }).go()));
  const publishedDomains = domainBatches
    .flatMap((b) => b.data)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  // Purchased-domain rows (registeredDomainId set — see the Buy-a-Domain feature) carry
  // registrar/billing state in a separate RegisteredDomain row, joined in here the same way
  // GET /api/v1/domains does for the client-side refresh path, so the settings panel has
  // what it needs on first paint without an extra round-trip.
  const registeredDomainRows = await Promise.all(
    publishedDomains
      .filter((d): d is typeof d & { registeredDomainId: string } => !!d.registeredDomainId)
      .map((d) => RegisteredDomain.get({ templateId: d.templateId, id: d.registeredDomainId }).go()),
  );
  const registeredDomainById = new Map(registeredDomainRows.map((r) => r.data).filter((r) => !!r).map((r) => [r!.id, r!]));

  const domains = publishedDomains.map((d) => {
    const reg = d.registeredDomainId ? registeredDomainById.get(d.registeredDomainId) : undefined;
    return {
      id: d.id,
      domain: d.domain,
      type: d.type,
      templateId: d.templateId,
      templateName: templateNameById.get(d.templateId) ?? "",
      createdAt: d.createdAt ?? new Date().toISOString(),
      dnsVerified: d.dnsVerified ?? false,
      dnsVerifiedAt: d.dnsVerifiedAt ?? null,
      certificateStatus: d.certificateStatus,
      certificateValidationName: d.certificateValidationName,
      certificateValidationValue: d.certificateValidationValue,
      noindex: d.noindex ?? false,
      registration: reg
        ? {
            status: reg.status,
            renewalDate: reg.renewalDate,
            renewalPriceUsdCents: reg.renewalPriceUsdCents,
            autoRenew: reg.autoRenew,
            whoisPrivacyEnabled: reg.whoisPrivacyEnabled,
            transferLocked: reg.transferLocked,
            paymentMethod: reg.paymentMethod,
          }
        : undefined,
    };
  });

  return (
    <PageContainer>
      <DomainsClient
        initialDomains={domains}
        landingPages={landingPages}
        plan={user.subscriptionPlan ?? "FREE"}
        customLimit={user.customDomainLimit ?? null}
      />
    </PageContainer>
  );
}
