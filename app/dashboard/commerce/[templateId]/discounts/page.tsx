import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { DiscountsContent } from "./Content";

export default async function CommerceDiscountsPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "discounts", (await searchParams)?.classic);
  return <DiscountsContent templateId={templateId} />;
}
