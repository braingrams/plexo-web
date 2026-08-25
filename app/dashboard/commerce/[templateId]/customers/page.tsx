import { prisma } from "@/server/prisma";
import { CustomersClient } from "./CustomersClient";

export default async function CommerceCustomersPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const settings = await prisma.commerceSettings.findUnique({ where: { templateId }, select: { paystackSecretKeyEncrypted: true } });

  return <CustomersClient templateId={templateId} paystackConfigured={!!settings?.paystackSecretKeyEncrypted} />;
}
