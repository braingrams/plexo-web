import type { Metadata } from "next";
import { BentoNav } from "./bento-nav";
import { Hero } from "./hero";
import { IntegrationsSection } from "./integrations";
import { FeatureGrid } from "./feature-grid";
import { DarkSdkSection } from "./dark-sdk";
import { MoreThanBuilderSection } from "./more-than-builder";
import { PreFooterCta, BentoFooter } from "./footer-section";
import { ScrollFxProvider } from "../scroll-fx";

export const metadata: Metadata = {
  title: "Plexo — Build and publish, exactly how you imagine it",
  description:
    "A drag-and-drop web and email template builder with an SDK, MCP, and AI publish capabilities. Multi-page sites, custom domains, and a generous free tier forever.",
  // Visual exploration of the homepage kept live for comparison, not the canonical
  // marketing URL — keep it out of search results so it doesn't compete with "/".
  robots: { index: false, follow: true },
};

/**
 * Bento-grid visual exploration of the marketing homepage, kept at its own route so it can
 * be compared against the live `app/page.tsx` before anything replaces it. Reuses the same
 * GSAP/Lenis scroll infra, theme tokens, and brand mark as the rest of the site.
 */
export default function BentoLandingPage() {
  return (
    <>
      <BentoNav />
      <ScrollFxProvider>
        <main>
          <Hero />
          <IntegrationsSection />
          <FeatureGrid />
          <DarkSdkSection />
          <MoreThanBuilderSection />
          <PreFooterCta />
        </main>
      </ScrollFxProvider>
      <BentoFooter />
    </>
  );
}
