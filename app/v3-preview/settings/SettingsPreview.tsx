"use client";

import { useSearchParams } from "next/navigation";
import { SettingsFrame } from "@/app/dashboard/_v3/settings/SettingsFrame";
import { ProfileSection } from "@/app/dashboard/_v3/settings/ProfileSection";
import { PlanSection } from "@/app/dashboard/_v3/settings/PlanSection";
import { TeamSection } from "@/app/dashboard/_v3/settings/TeamSection";
import { DomainsSection } from "@/app/dashboard/_v3/settings/DomainsSection";
import { NotificationsSection } from "@/app/dashboard/_v3/settings/NotificationsSection";
import { ConnectSection } from "@/app/dashboard/_v3/settings/ConnectSection";
import { DevelopersSection } from "@/app/dashboard/_v3/settings/DevelopersSection";
import { BrandingSection } from "@/app/dashboard/_v3/settings/BrandingSection";
import { MovingSection } from "@/app/dashboard/_v3/settings/MovingSection";
import { parseExperience } from "@/lib/dashboardV3/nav";
import type { SettingsSectionId } from "@/lib/dashboardV3/settingsNav";

const sites = [{ id: "s1", name: "Ama's Kitchen" }, { id: "s2", name: "Cooking with Ama" }, { id: "s3", name: "Kitchen notes" }];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/** DEV ONLY: every Settings section with fake data (nothing is sent anywhere). */
export function SettingsPreview({ section }: { section: SettingsSectionId }) {
  const params = useSearchParams();
  const experience = parseExperience(params.get("exp")) ?? "beginner";
  const planParam = params.get("plan") ?? "paid";
  const free = planParam === "free";
  const trial = planParam === "trial";
  const near = planParam === "near";
  const bigTeam = params.get("team") === "5";
  const pending = params.get("domain") === "pending";
  const manyKeys = params.get("keys") === "many";
  return (
    <SettingsFrame current={section} experience={experience} base="/v3-preview/settings">
      {section === "profile" ? <ProfileSection mock name="Ama Owusu" email="ama@amaskitchen.com" experience={experience} /> : null}
      {section === "plan" ? (
        <PlanSection
          mock
          prices={{ STARTER: "$9 a month", PRO: "$19 a month", ENTERPRISE: "from $99 a month" }}
          state={free ? { plan: "FREE", paying: false } : trial ? { plan: "STARTER", paying: true, basis: "TRIAL", daysLeft: 9 } : near ? { plan: "PRO", paying: true, basis: "SUBSCRIPTION", renewsAt: inDays(6) } : { plan: "STARTER", paying: true, basis: "SUBSCRIPTION", renewsAt: inDays(19) }}
          usage={free ? { sites: 1, products: 0, teammates: 0 } : near ? { sites: 4, products: 960, teammates: 4 } : { sites: 1, products: 12, teammates: 1 }}
          trialAvailable={free}
          allowanceBalance={near ? 60 : 1240}
          topupBalance={2500}
          allowanceResetAt={inDays(19)}
          activity={[
            { id: "a1", type: "AI_USAGE", amount: -42, description: "Wrote your About page", createdAt: daysAgo(1) },
            { id: "a2", type: "AI_USAGE", amount: -118, description: "Built your pricing page", createdAt: daysAgo(3) },
            { id: "a3", type: "MONTHLY_GRANT", amount: 2000, description: "Your monthly credits", createdAt: daysAgo(11) },
          ]}
          payments={[
            { id: "p1", paidAt: daysAgo(11), description: "Starter plan, monthly", detail: null, amountCents: 1200, refundedCents: 0, currency: "usd", status: "PAID", receiptNumber: "PX-1041", cardLast4: "4242", failureReason: null },
            { id: "p2", paidAt: daysAgo(41), description: "Starter plan, monthly", detail: null, amountCents: 1200, refundedCents: 0, currency: "usd", status: "PAID", receiptNumber: "PX-0988", cardLast4: "4242", failureReason: null },
            { id: "p3", paidAt: daysAgo(60), description: "2,500 AI credits", detail: null, amountCents: 500, refundedCents: 0, currency: "usd", status: "PAID", receiptNumber: "PX-0950", cardLast4: "4242", failureReason: null },
          ]}
          card={{ cardBrand: "visa", cardLast4: "4242", cardExpMonth: 8, cardExpYear: 2028 }}
        />
      ) : null}
      {section === "team" ? (
        <TeamSection
          mock
          currentUserId="u1"
          currentRole="owner"
          organizationName="Ama's Kitchen"
          seatLimit={bigTeam ? 5 : 2}
          members={[
            ...(bigTeam ? [{ id: "u3", userId: "u3", role: "admin", scopedTemplateIds: [], name: "Adwoa Boateng", email: "adwoa@amaskitchen.com" }, { id: "u4", userId: "u4", role: "blogger", scopedTemplateIds: [], name: "Yaw Asante", email: "yaw@amaskitchen.com" }, { id: "u5", userId: "u5", role: "viewer", scopedTemplateIds: [], name: "Efua Darko", email: "efua@amaskitchen.com" }] : []),
            { id: "u1", userId: "u1", role: "owner", scopedTemplateIds: [], name: "Ama Owusu", email: "ama@amaskitchen.com" },
            { id: "u2", userId: "u2", role: "editor", scopedTemplateIds: [], name: "Kofi Mensah", email: "kofi@amaskitchen.com" },
          ]}
          invitations={[{ id: "i1", email: "esi@example.com", role: "blogger", scopedTemplateIds: [], createdAt: daysAgo(2) }]}
        />
      ) : null}
      {section === "domains" ? (
        <DomainsSection
          mock
          sites={sites}
          canUseOwn
          addresses={[
            { id: "d1", domain: "amaskitchen.plexopages.com", type: "SUBDOMAIN", siteId: "s1", siteName: "Ama's Kitchen", online: true, pausedByPlan: false, bought: false },
            { id: "d2", domain: "learn.amaskitchen.com", type: "CUSTOM", siteId: "s2", siteName: "Cooking with Ama", online: true, pausedByPlan: false, bought: false },
            { id: "d3", domain: "www.amaskitchen.com", type: "CUSTOM", siteId: "s1", siteName: "Ama's Kitchen", online: pending ? false : false, pausedByPlan: false, bought: false },
          ]}
        />
      ) : null}
      {section === "notifications" ? <NotificationsSection mock accountEmail="ama@amaskitchen.com" initial={{ payments: true, formSubmissions: false, blogComments: true, commentMentions: true, notificationEmail: null }} /> : null}
      {section === "connect" ? <ConnectSection baseUrl="https://plexobuilder.com" apiKeyHint="plexo_sk_••••a1b2" /> : null}
      {section === "developers" ? <DevelopersSection mock keys={Array.from({ length: manyKeys ? 9 : 1 }, (_, i) => ({ id: `k${i}`, name: "Key", maskedKey: `plexo_sk_••••a1b${i}`, createdAt: daysAgo(9 + i * 7) }))} maxKeys={manyKeys ? 10 : 3} canPublishViaApi={false} publishViaApi={false} canCompile /> : null}
      {section === "brand" ? <BrandingSection mock organizationId="o1" canManage planAllowsWhiteLabel={params.get("wl") !== "no"} initial={{ name: "Ama's Kitchen", logo: "", color: "", mode: "BOTH", on: false }} /> : null}
      {section === "moving" ? (
        <MovingSection
          mock
          sites={sites}
          isOwner
          canImport
          incoming={[{ id: "t1", siteName: "Yaw's Tailoring", fromName: "Yaw Boateng", createdAt: daysAgo(1), expiresAt: inDays(6) }]}
          outgoing={[]}
        />
      ) : null}
    </SettingsFrame>
  );
}
