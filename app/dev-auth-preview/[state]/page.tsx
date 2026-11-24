import { PLAN } from "@/lib/plan/plans";
import { notFound } from "next/navigation";
import { MailX, Users } from "lucide-react";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { SigningIn } from "@/app/auth/_kit/SigningIn";
import { ConnectErrorView, ConnectKeyView } from "@/app/mcp/login/views";
import { SignupClient } from "@/app/learn/[templateId]/SignupClient";
import { PageHead } from "@/app/auth/_kit/ui";
import { TrialOffer } from "@/app/welcome/trial-offer";
import { ConfirmView } from "@/app/auth/confirm/ConfirmClient";
import { ChooseOrgClient } from "@/app/choose-org/choose-org-client";
import { AcceptInviteClient } from "@/app/accept-invite/[id]/accept-invite-client";
import { CompleteSubscriptionClient } from "@/app/auth/complete-subscription/complete-subscription-client";

// Development-only stand-ins for the sign-in screens that normally need a signed-in account and data
// (invite, choose workspace, finish subscription, the invite error). Not reachable in production.
export default async function Preview({ params }: { params: Promise<{ state: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { state } = await params;

  if (state === "confirm") return <AuthShell><ConfirmView /></AuthShell>;
  if (state === "choose-org")
    return (
      <AuthShell layout="center">
        <PageHead title="Choose a workspace">You’re a member of more than one. Pick the one you want to open.</PageHead>
        <ChooseOrgClient organizations={[{ id: "1", name: "Brightside Bakery", role: "owner" }, { id: "2", name: "Okoli Studio", role: "editor" }, { id: "3", name: "Harbour Café", role: "viewer" }]} />
      </AuthShell>
    );
  if (state === "invite")
    return (
      <AuthShell layout="center">
        <div className="ax-card ax-center-text">
          <div className="ax-badge-icon"><Users size={30} aria-hidden="true" /></div>
          <PageHead title="Join Brightside Bakery">sam@brightside.com invited you to collaborate as</PageHead>
          <p style={{ marginBottom: 24 }}><span className="ax-pill-role">Editor</span></p>
          <AcceptInviteClient invitationId="demo" />
        </div>
      </AuthShell>
    );
  if (state === "invite-expired")
    return (
      <AuthShell layout="center">
        <div className="ax-center-text">
          <div className="ax-badge-icon ax-warn"><MailX size={30} aria-hidden="true" /></div>
          <PageHead title="This invitation is no longer active">It&apos;s already been accepted, declined, or canceled. Ask whoever invited you to send a new one if you still need access.</PageHead>
        </div>
      </AuthShell>
    );
  if (state === "signing-in") return <SigningIn />;
  if (state === "signing-in-error") return <SigningIn error="We couldn’t finish signing you in. Check your connection and try again." />;
  if (state === "mcp-key") return <ConnectKeyView email="alex@example.com" rawKey="plexo_mcp_3f9a1c27b84e5d60a2c9e1f7048b6d35c1a7e92f" />;
  if (state === "mcp-error") return <ConnectErrorView message="We don’t recognise this app. Remove it from your AI tool and add it again." />;
  if (state === "learn") return <SignupClient templateId="demo" funnelName="Baking Basics" errorMessage={null} paidReturn={false} />;
  if (state === "learn-error") return <SignupClient templateId="demo" funnelName="Baking Basics" errorMessage="That sign-up link has expired. Sign up again to get a new one." paidReturn={false} />;
  if (state === "learn-paid") return <SignupClient templateId="demo" funnelName="Baking Basics" errorMessage={null} paidReturn />;
  if (state === "trial") return <TrialOffer firstName="Alex" highlighted={PLAN.PRO} trialDays={14} />;
  if (state === "subscription") return <CompleteSubscriptionClient plan={PLAN.PRO} canTrial trialDays={14} />;
  if (state === "subscription-pay") return <CompleteSubscriptionClient plan={PLAN.PRO} canTrial={false} trialDays={14} />;
  notFound();
}
