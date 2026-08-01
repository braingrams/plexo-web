import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { PlexoLogo } from "@/app/plexo-logo";
import { AcceptInviteClient } from "./accept-invite-client";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen bg-[#0b0f19] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-8">
          <PlexoLogo size={32} textStyle={{ color: "#ffffff" }} />
        </div>
        <div className="bg-[#0d0f1a] border border-white/10 rounded-2xl p-8">
          <h1 className="text-lg font-bold mb-2">{title}</h1>
          <p className="text-sm text-slate-400">{message}</p>
        </div>
      </div>
    </main>
  );
}

export default async function AcceptInvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect(`/auth/login?redirectTo=${encodeURIComponent(`/accept-invite/${id}`)}`);
  }

  let invitation;
  try {
    invitation = await auth.api.getInvitation({ query: { id }, headers: requestHeaders });
  } catch {
    return (
      <ErrorCard
        title="Invitation not found"
        message="This invite link is invalid, expired, or has already been used. Ask whoever invited you to send a new one."
      />
    );
  }

  if (!invitation || invitation.status !== "pending") {
    return (
      <ErrorCard
        title="This invitation is no longer active"
        message="It's already been accepted, declined, or canceled. Ask whoever invited you to send a new one if you still need access."
      />
    );
  }

  if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
    return (
      <ErrorCard
        title="Wrong account"
        message={`This invitation was sent to ${invitation.email}, but you're signed in as ${session.user.email}. Sign out and back in with the invited email to accept it.`}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#0b0f19] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <PlexoLogo size={32} textStyle={{ color: "#ffffff" }} />
        </div>
        <div className="bg-[#0d0f1a] border border-white/10 rounded-2xl p-8 text-center">
          <h1 className="text-xl font-bold mb-2">Join {invitation.organizationName}</h1>
          <p className="text-sm text-slate-400 mb-4">
            {invitation.inviterEmail} invited you to collaborate as
          </p>
          <span className="inline-block bg-purple-500/15 text-purple-400 text-xs font-bold px-3 py-1.5 rounded-full mb-6">
            {ROLE_LABELS[invitation.role] ?? invitation.role}
          </span>
          <AcceptInviteClient invitationId={id} />
        </div>
      </div>
    </main>
  );
}
