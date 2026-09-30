import { CustomersClient } from "./CustomersClient";

export default async function CommerceCustomersPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  return <CustomersClient templateId={templateId} />;
}
