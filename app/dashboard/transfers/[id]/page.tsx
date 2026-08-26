import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { isValidUuid } from "@/server/slug";
import { SettingsShell } from "../../_components/SettingsShell";
import { TransferDetailClient } from "./TransferDetailClient";

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) redirect(`/auth/login?redirectTo=${encodeURIComponent(`/dashboard/transfers/${id}`)}`);

  const transfer = await prisma.siteTransferRequest.findUnique({
    where: { id },
    include: { template: { select: { name: true } }, fromOrganization: { select: { name: true } }, fromUser: { select: { name: true, email: true } } },
  });
  if (!transfer) notFound();

  const isRecipient = transfer.toEmail === session.user.email.toLowerCase();

  return (
    <SettingsShell>
      <TransferDetailClient
        id={transfer.id}
        siteName={transfer.template.name}
        fromName={transfer.fromUser.name}
        fromEmail={transfer.fromUser.email}
        fromOrgName={transfer.fromOrganization.name}
        toEmail={transfer.toEmail}
        status={transfer.status}
        createdAt={transfer.createdAt.toISOString()}
        expiresAt={transfer.expiresAt.toISOString()}
        isRecipient={isRecipient}
        sessionEmail={session.user.email}
        initialWarnings={(transfer.compatibilityWarnings as { title: string; detail: string }[] | null) ?? []}
      />
    </SettingsShell>
  );
}
