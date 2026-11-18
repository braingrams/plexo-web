import { PLAN } from "@/lib/plan/plans";
import { redirectIfV3 } from "@/lib/dashboardV3/v3Redirect";
import { auth } from "@/server/authDynamo";
import { LmsFunnel } from "@/lib/db/contentEntities";
import { CommerceProduct, CommerceSettings } from "@/lib/db/commerceEntities";
import { User } from "@/lib/db/coreEntities";
import { lmsSignupEmbedSnippet } from "@/lib/lms/embedSnippet";
import { SettingsClient } from "./SettingsClient";

export default async function FunnelSettingsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  await redirectIfV3(`/dashboard/learners/${templateId}/settings`);
  const session = await auth();

  const [{ data: funnel }, { data: user }, { data: products }, { data: commerceSettings }] = await Promise.all([
    LmsFunnel.get({ templateId }).go(),
    session?.user ? User.get({ id: session.user.id }).go() : Promise.resolve({ data: null }),
    CommerceProduct.query.primary({ templateId }).go({ pages: "all" }),
    CommerceSettings.get({ templateId }).go(),
  ]);

  if (!funnel) return null;

  return (
    <SettingsClient
      templateId={templateId}
      initialFunnel={{
        enabled: funnel.enabled ?? false,
        signupMode: funnel.signupMode ?? PLAN.FREE,
        signupProductId: funnel.signupProductId ?? null,
        requireName: funnel.requireName ?? true,
        collectPhone: funnel.collectPhone ?? false,
      }}
      initialBuilderLevel={user?.funnelBuilderLevel ?? "INTERMEDIATE"}
      products={products.map((p) => ({ id: p.id, name: p.name }))}
      currency={commerceSettings?.currency ?? "NGN"}
      embedSnippet={lmsSignupEmbedSnippet(templateId)}
    />
  );
}
