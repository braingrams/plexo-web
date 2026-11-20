"use client";

import { InBannerStack } from "../ui/BannerStack";
import { callIt, homeTitle } from "@/lib/dashboardV3/homeTitle";
import { useEffect, useState } from "react";
import { ArrowRight, LayoutGrid, PartyPopper } from "lucide-react";
import { ALL_SITES_PATH } from "@/lib/dashboardV3/allSites";
import type { HomeProps } from "./homeTypes";
import { Button, ButtonLink, Card, HelpVideoLink } from "../ui";
import { GuidedChecklist } from "./GuidedChecklist";
import { ActivityCard, StatGrid, VisitsCard } from "./LiveDashboard";
import { AllSites } from "./AllSites";
import { AskSolCard, CopyLinkButton, OtherActionsCard, ShopActionsCard, SitePreviewCard } from "./SideCards";
import { SkippedHome } from "./SkippedHome";
import { AddMoreCards } from "../hub/AddMore";
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
  const { mode, site, all, brand, experience, firstName, baseDomain, newSiteHref, demo, tuneHref, siteCount = 0 } = props;
  // The colourful all-sites screen is for the simple view; pros already see everything together.
  const allSitesCta = siteCount > 0 && experience !== "pro";
  const [celebrate, setCelebrate] = useState(false);
  // Finishing happens at the bottom of the steps; bring the "Copy link" and "Go to my dashboard" buttons into view.
  const celebrating = celebrate && !!site?.progress.allDone;
  useEffect(() => {
    if (celebrating) scrollHomeToTop();
  }, [celebrating]);

  // "all" lists every site and deliberately carries no single `site`, so it must be decided BEFORE the "no site" check
  // (checking `!site` first showed "Set up your first site" to people with many sites).
  if (mode === "all") {
    return (
      <Page allSitesCta={allSitesCta} tuneHref={tuneHref} eyebrow={`${greeting()}, ${firstName}`} title={experience === "pro" ? "Everything you're building" : "Your websites"}>
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
  const addMoreHref = `/dashboard/sites/${site.site.id}?tab=settings#addmore`;
  const addMore = site.addMore ? (
    <Card padding="none" style={{ overflow: "hidden", border: "1px solid var(--plx-border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "18px 24px", flexWrap: "wrap" }}>
        <div>
          <b style={{ fontSize: 16, display: "block" }}>Do more with your site</b>
          <span className="plx-small" style={{ color: "var(--plx-muted)" }}>
            Turn on a shop, bookings, blog, course, or email sign-up whenever you&apos;re ready.
          </span>
        </div>
        <ButtonLink href={addMoreHref} variant="secondary" rightIcon={<ArrowRight size={16} aria-hidden />}>
          Add more to your site
        </ButtonLink>
      </div>
    </Card>
  ) : null;
  const showGuide = !progress.allDone || celebrate;

  if (showGuide) {
    const title = homeTitle({ name: site.site.name, kind: site.site.kind, allDone: progress.allDone });
    return (
      <Page allSitesCta={allSitesCta} tuneHref={tuneHref} experience={experience} demo={demo} eyebrow={`${greeting()}, ${firstName}`} title={title}>
        <div className="plx-page__grid">
          <section data-tour="home-main" style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            {celebrate && progress.allDone ? (
              <Card tone="tint" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 16, borderColor: "var(--plx-brand)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <PartyPopper size={28} aria-hidden style={{ color: "var(--plx-deep)", flexShrink: 0 }} />
                  <span className="plx-h2">You&apos;re live! {callIt(site.site.name, site.site.kind)} is on the internet.</span>
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
            {progress.variant === "store" ? <ShopActionsCard siteId={site.site.id} /> : null}
            <OtherActionsCard siteId={site.site.id} solPrompt={SOL_IDEAS[progress.variant]} newSiteHref={newSiteHref} />
          </aside>
        </div>
        {addMore}
      </Page>
    );
  }

  // Live: this site's dashboard. Stats across the top, then activity and visits on the left with a slim rail on the right.
  const stats = site.stats;
  return (
    <Page allSitesCta={allSitesCta} tuneHref={tuneHref} experience={experience} demo={demo} eyebrow={`${greeting()}, ${firstName}`} title={site.site.name}>
      {stats ? <StatGrid stats={stats.stats} /> : null}
      <div className="plx-home__body">
        <section data-tour="home-main" className="plx-home__main">
          {stats ? <ActivityCard stats={stats} site={site.site} experience={experience} /> : null}
          {stats ? <VisitsCard days={stats.visitsByDay ?? new Array(7).fill(0)} /> : null}
        </section>
        <aside className="plx-home__rail">
          <SitePreviewCard site={site.site} brand={brand} />
          {progress.variant === "store" ? <ShopActionsCard siteId={site.site.id} /> : null}
          <OtherActionsCard siteId={site.site.id} solPrompt={SOL_IDEAS[progress.variant]} newSiteHref={newSiteHref} />
        </aside>
      </div>
      {addMore}
    </Page>
  );
}

function Page({ eyebrow, title, tuneHref, experience, demo, allSitesCta, children }: { eyebrow: string; title: string; allSitesCta?: boolean; tuneHref?: string; experience?: HomeProps["experience"]; demo?: boolean; children: React.ReactNode }) {
  return (
    <div className="plx-page" data-tour-ready="" data-home-top="">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="plx-eyebrow">{eyebrow}</p>
          <h1 className="plx-h1">{title}</h1>
        </div>
        {allSitesCta ? (
          <ButtonLink href={ALL_SITES_PATH} variant="secondary" leftIcon={<LayoutGrid size={18} aria-hidden />} data-tour="home-all-sites">
            All websites
          </ButtonLink>
        ) : null}
      </div>
      {/* These join the page's one banner stack (the plan notice, what's new…): one shows, the rest fold behind "more". */}
      <InBannerStack>
        {tuneHref ? <CustomizeCard href={tuneHref} /> : null}
        {experience ? <ProViewNudge experience={experience} demo={demo} /> : null}
      </InBannerStack>
      {children}
    </div>
  );
}

/** For people who already have sites: a short setup so Plexo shows what suits how they work. Not about SOL, about the whole experience. */
function CustomizeCard({ href }: { href: string }) {
  return (
    <Card tone="tint" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 560 }}>
        <span className="plx-h3">Customize your experience</span>
        <span className="plx-body">Answer two quick questions and Plexo sets itself up for how you work: the tools you see first and the help you get.</span>
      </div>
      <ButtonLink href={href} rightIcon={<ArrowRight size={18} aria-hidden />}>Customize Plexo</ButtonLink>
    </Card>
  );
}

/** Scroll whatever holds the page (the window or the dashboard's own scroll area) back to the top of Home. */
export function scrollHomeToTop() {
  if (typeof document === "undefined") return;
  const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const top = document.querySelector("[data-home-top]");
  if (top && typeof top.scrollIntoView === "function") top.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  else window.scrollTo?.({ top: 0, behavior: smooth ? "smooth" : "auto" });
}
