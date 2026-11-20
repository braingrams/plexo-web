import { redirectToShopIfV3 } from "@/lib/dashboardV3/hubRedirect";
import { CustomersContent } from "./Content";

export default async function CommerceCustomersPage({ params, searchParams }: { params: Promise<{ templateId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { templateId } = await params;
  await redirectToShopIfV3(templateId, "customers", (await searchParams)?.classic);
  return <CustomersContent templateId={templateId} />;
}
