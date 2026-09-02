import { redirect, notFound } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { isValidUuid } from "@/server/slugDynamo";
import { findTransferById } from "@/lib/siteTransferDynamo";
import { Template } from "@/lib/db/contentEntities";
import { Organization, User } from "@/lib/db/coreEntities";
import { SettingsShell } from "../../_components/SettingsShell";
import { TransferDetailClient } from "./TransferDetailClient";

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const session = await auth();
  if (!session?.user?.id || !session.user.email) redirect(`/auth/login?redirectTo=${encodeURIComponent(`/dashboard/transfers/${id}`)}`);

  const transfer = await findTransferById(id);
  if (!transfer) notFound();

  const [{ data: template }, { data: fromOrganization }, { data: fromUser }] = await Promise.all([
    Template.get({ id: transfer.templateId }).go(),
    Organization.get({ id: transfer.fromOrganizationId }).go(),
    User.get({ id: transfer.fromUserId }).go(),
  ]);

  const isRecipient = transfer.toEmail === session.user.email.toLowerCase();

  return (
    <SettingsShell>
      <TransferDetailClient
        id={transfer.id}
        siteName={template?.name ?? "Untitled site"}
        fromName={fromUser?.name ?? "Unknown"}
        fromEmail={fromUser?.email ?? ""}
        fromOrgName={fromOrganization?.name ?? "Unknown organization"}
        toEmail={transfer.toEmail}
        status={transfer.status ?? "PENDING"}
        createdAt={transfer.createdAt ?? ""}
        expiresAt={transfer.expiresAt}
        isRecipient={isRecipient}
        sessionEmail={session.user.email}
        initialWarnings={(transfer.compatibilityWarnings as { title: string; detail: string }[] | null) ?? []}
      />
    </SettingsShell>
  );
}
