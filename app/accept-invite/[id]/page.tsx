import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { getInvitation } from "@/server/orgDynamo";
import Link from "next/link";
import { MailX, Users } from "lucide-react";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { PageHead } from "@/app/auth/_kit/ui";
import { AcceptInviteClient } from "./accept-invite-client";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  commenter: "Reviewer",
  viewer: "Viewer",
  blogger: "Writer",
  guest: "Access to selected sites",
};

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <AuthShell layout="center">
      <div className="ax-center-text">
        <div className="ax-badge-icon ax-warn"><MailX size={30} aria-hidden="true" /></div>
        <PageHead title={title}>{message}</PageHead>
        <Link href="/dashboard" className="ax-btn ax-btn-secondary">Go to my dashboard</Link>
      </div>
    </AuthShell>
  );
}

export default async function AcceptInvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/auth/login?redirectTo=${encodeURIComponent(`/accept-invite/${id}`)}`);
  }

  const invitation = await getInvitation(id);

  if (!invitation || invitation.status !== "pending") {
    return (
      <ErrorCard
        title="This invitation is no longer active"
        message="It's already been accepted, declined, or canceled. Ask whoever invited you to send a new one if you still need access."
      />
    );
  }

  if (invitation.email.toLowerCase() !== (session.user.email ?? "").toLowerCase()) {
    return (
      <ErrorCard
        title="Wrong account"
        message={`This invitation was sent to ${invitation.email}, but you're signed in as ${session.user.email}. Sign out and back in with the invited email to accept it.`}
      />
    );
  }

  return (
    <AuthShell layout="center">
      <div className="ax-card ax-center-text">
        <div className="ax-badge-icon"><Users size={30} aria-hidden="true" /></div>
        <PageHead title={`Join ${invitation.organizationName}`}>
          {invitation.inviterEmail} invited you to collaborate as
        </PageHead>
        <p style={{ marginBottom: 24 }}><span className="ax-pill-role">{ROLE_LABELS[invitation.role] ?? invitation.role}</span></p>
        <AcceptInviteClient invitationId={id} />
      </div>
    </AuthShell>
  );
}
