"use client";

import { PaymentsSettingsClient } from "@/app/dashboard/commerce/[templateId]/settings/payments/PaymentsSettingsClient";
import { NewFunnelLauncher } from "@/app/dashboard/funnels/_components/NewFunnelLauncher";
import { NewCourseDialog } from "@/app/dashboard/_v3/learners/NewCourseDialog";
import { SolOutOfCredits } from "@/app/dashboard/_components/sol/SolTopUp";
import { DevelopersSection } from "@/app/dashboard/_v3/settings/DevelopersSection";
import { UpgradePrompt } from "@/app/dashboard/_components/UpgradePrompt";

const payments = {
  paymentProvider: "PLATFORM_PAYSTACK" as const,
  paystackMode: "TEST" as const,
  paystackTestPublicKey: "",
  paystackLivePublicKey: "",
  paystackTestSecretKeyMasked: null,
  paystackLiveSecretKeyMasked: null,
  stripeMode: "TEST" as const,
  stripeTestPublishableKey: "",
  stripeLivePublishableKey: "",
  stripeTestSecretKeyMasked: null,
  stripeLiveSecretKeyMasked: null,
  stripeTestWebhookSecretMasked: null,
  stripeLiveWebhookSecretMasked: null,
  bankTransferEnabled: false,
  bankTransferBankName: "",
  bankTransferAccountName: "",
  bankTransferAccountNumber: "",
  bankTransferInstructions: "",
};

export function UpgradeScenes({ scene }: { scene: string }) {
  return (
    <div style={{ padding: "1.5rem", maxWidth: 1100 }}>
      {scene === "payments" && (
        <div style={{ background: "#14101c", padding: "1.5rem", borderRadius: 16, ["--plx-text" as string]: "#f0f2ff" }}>
          <PaymentsSettingsClient templateId="demo" initial={payments} />
        </div>
      )}
      {scene === "funnel" && <NewFunnelLauncher initialFunnelBuilderLevel="INTERMEDIATE" />}
      {scene === "course" && <NewCourseDialog open onClose={() => undefined} />}
      {scene === "sol" && <div style={{ maxWidth: 460, background: "#14101c", padding: "1rem", borderRadius: 16, color: "#f0f2ff", ["--plx-text" as string]: "#f0f2ff" }}><SolOutOfCredits onDismiss={() => undefined} /></div>}
      {scene === "locked" && <DevelopersSection mock keys={[{ id: "k1", name: "Key", maskedKey: "plexo_sk_••••a1b0", createdAt: "2026-11-01T00:00:00Z" }]} maxKeys={1} canPublishViaApi={false} publishViaApi={false} canCompile={false} />}
      {scene === "publish" && (
        <div style={{ maxWidth: 440, padding: "1.25rem", borderRadius: 16, background: "var(--plx-surface, #fff)", border: "1px solid var(--plx-border, #ddd)" }}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>Publish your site</h2>
          <p style={{ margin: "0 0 0.9rem", fontSize: "0.85rem" }}>Your address: ellarose.plexopages.io</p>
          <UpgradePrompt message="The Free plan keeps one site live at a time, and “Ella Rose Bakery” is live now. Upgrade to put another site online, or save this one as a draft." requiredPlan="PRO" returnTo="/dashboard/templates/demo?resume=publish" />
        </div>
      )}
    </div>
  );
}
