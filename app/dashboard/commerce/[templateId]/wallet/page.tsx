import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { WalletContent } from "./Content";

export default async function CommerceWalletPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "wallet", (await searchParams)?.classic);
  return <WalletContent templateId={templateId} searchParams={await searchParams} />;
}
