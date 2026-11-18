"use client";

import { useState } from "react";
import { ArrowRight, PartyPopper } from "lucide-react";
import type { HomeProps } from "./homeTypes";
import { Button, ButtonLink, Card, HelpVideoLink } from "../ui";
import { GuidedChecklist } from "./GuidedChecklist";
import { ActivityCard, StatGrid, VisitsCard } from "./LiveDashboard";
import { AllSites } from "./AllSites";
import { AskSolCard, CopyLinkButton, OtherActionsCard, SitePreviewCard } from "./SideCards";
import { SkippedHome } from "./SkippedHome";
import { ProViewNudge } from "./ProViewNudge";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const SOL_IDEAS: Record<string, string> = {
  store: "Add a delivery page and a pricing page in my colours.",
  business: "Add an About page with my story and a photo gallery.",
  blog: "Write my first post about how I got started.",
  course: "Add a welcome lesson that says what students will learn.",
  link: "Add buttons for my Instagram, WhatsApp and bookings.",
  app: "Add a page where people can see their past orders.",
};

/** Home: picks the right view for what the person is doing. Stays mounted across refreshes so "You're live" can finish its moment. */
export function HomeView(props: HomeProps) {
  const { mode, site, all, brand, experience, firstName, baseDomain, newSiteHref, demo, tuneHref } = props;
  const [celebrate, setCelebrate] = useState(false);

  // "all" lists every site and deliberately carries no single `site`, so it must be decided BEFORE the "no site" check
  // (checking `!site` first showed "Set up your first site" to people with many sites).
  if (mode === "all") {
    return (
      <Page tuneHref={tuneHref} eyebrow={`${greeting()}, ${firstName}`} title={experience === "pro" ? "Everything you're building" : "Your websites"}>
        <AllSites rows={all} dense={experience === "pro"} newSiteHref={newSiteHref} />
      </Page>
    );
  }

  if (mode === "none" || !site) {
    return (
      <Page eyebrow="Welcome to Plexo" title="Look around. Your site is ready when you are.">
        <SkippedHome setupHref={newSiteHref} />
      </Page>
    );
  }

  const { progress } = site;
  const showGuide = !progress.allDone || celebrate;

  if (showGuide) {
    const title = progress.allDone ? `${site.site.name} is online` : `Let's get ${site.site.name} online`;
    return (
      <Page tuneHref={tuneHref} experience={experience} demo={demo} eyebrow={`${greeting()}, ${firstName}`} title={title}>
        <div className="plx-page__grid">
          <section data-tour="home-main" style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            {celebrate && progress.allDone ? (
              <Card tone="tint" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 16, borderColor: "var(--plx-brand)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <PartyPopper size={28} aria-hidden style={{ color: "var(--plx-deep)", flexShrink: 0 }} />
                  <span className="plx-h2">You&apos;re live! {site.site.name} is on the internet.</span>
                </div>
                <span className="plx-body" style={{ overflowWrap: "anywhere" }}>
                  Share it with your customers: <strong>{site.site.address}</strong>
                </span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <CopyLinkButton address={site.site.address} variant="strong" />
                  <Button onClick={() => setCelebrate(false)} rightIcon={<ArrowRight size={18} aria-hidden />}>
                    Go to my dashboard
                  </Button>
                </div>
              </Card>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className="plx-body">Do these one at a time. Each one finishes right here.</span>
                <HelpVideoLink title="How these steps work" />
              </div>
            )}
            <GuidedChecklist
              site={site.site}
              progress={progress}
              commerceEnabled={site.commerceEnabled}
              baseDomain={baseDomain}
              demo={demo}
              onLive={() => setCelebrate(true)}
            />
          </section>
          <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <SitePreviewCard site={site.site} brand={brand} />
            <AskSolCard prompt={SOL_IDEAS[progress.variant]} />
          </aside>
        </div>
      </Page>
    );
  }

  // Live: this site's dashboard. Stats across the top, then activity and visits on the left with a slim rail on the right.
  const stats = site.stats;
  return (
    <Page tuneHref={tuneHref} experience={experience} demo={demo} eyebrow={`${greeting()}, ${firstName}`} title={site.site.name}>
      {stats ? <StatGrid stats={stats.stats} /> : null}
      <div className="plx-home__body">
        <section data-tour="home-main" className="plx-home__main">
          {stats ? <ActivityCard stats={stats} site={site.site} /> : null}
          {stats ? <VisitsCard days={stats.visitsByDay ?? new Array(7).fill(0)} /> : null}
        </section>
        <aside className="plx-home__rail">
          <SitePreviewCard site={site.site} brand={brand} />
          <OtherActionsCard solPrompt={SOL_IDEAS[progress.variant]} newSiteHref={newSiteHref} />
        </aside>
      </div>
    </Page>
  );
}

function Page({ eyebrow, title, tuneHref, experience, demo, children }: { eyebrow: string; title: string; tuneHref?: string; experience?: HomeProps["experience"]; demo?: boolean; children: React.ReactNode }) {
  return (
    <div className="plx-page">
      <div>
        <p className="plx-eyebrow">{eyebrow}</p>
        <h1 className="plx-h1">{title}</h1>
      </div>
      {tuneHref ? <FineTuneCard href={tuneHref} /> : null}
      {experience ? <ProViewNudge experience={experience} demo={demo} /> : null}
      {children}
    </div>
  );
}

/** For people who already have sites: a quick way to tell Plexo (and SOL) how they work, then start on a site. */
function FineTuneCard({ href }: { href: string }) {
  return (
    <Card tone="tint" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 560 }}>
        <span className="plx-h3">Fine-tune with SOL</span>
        <span className="plx-body">Two quick questions, then SOL can start on any of your sites: a fresh look, better words or a new page.</span>
      </div>
      <ButtonLink href={href} rightIcon={<ArrowRight size={18} aria-hidden />}>Tune Plexo to me</ButtonLink>
    </Card>
  );
}
