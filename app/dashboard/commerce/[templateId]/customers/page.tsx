import { prisma } from "@/server/prisma";
import { resolveActivePaystackKeys } from "@/lib/commerce/paystack";
import { CustomersClient } from "./CustomersClient";

export default async function CommerceCustomersPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const settings = await prisma.commerceSettings.findUnique({
    where: { templateId },
    select: {
      paystackMode: true,
      paystackTestPublicKey: true,
      paystackTestSecretKeyEncrypted: true,
      paystackLivePublicKey: true,
      paystackLiveSecretKeyEncrypted: true,
    },
  });
  const paystackConfigured = settings ? Boolean(resolveActivePaystackKeys(settings).secretKeyEncrypted) : false;

  return <CustomersClient templateId={templateId} paystackConfigured={paystackConfigured} />;
}
