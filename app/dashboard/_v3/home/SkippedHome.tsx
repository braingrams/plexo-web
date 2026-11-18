"use client";

import { ArrowRight, BookOpen, Compass, LayoutTemplate } from "lucide-react";
import { Button, ButtonLink, Card } from "../ui";
import { useOptionalTour } from "../tour/TourProvider";

const IDEAS = [
  { icon: LayoutTemplate, title: "See what a site can look like", body: "Browse ready-made designs for shops, blogs, courses and more.", href: "/dashboard/marketplace", cta: "Browse designs" },
  { icon: Compass, title: "Take a quick tour", body: "A one-minute look at where everything lives.", href: "", cta: "Show me around" },
  { icon: BookOpen, title: "Ask SOL anything", body: "Not sure where to start? Tell SOL your idea in plain words.", href: "/dashboard/sol", cta: "Ask SOL" },
];

/** For someone who chose "Continue later": a friendly way back in, plus three easy things to try. */
export function SkippedHome({ setupHref }: { setupHref: string }) {
  const tour = useOptionalTour();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }} data-tour="home-main">
      <Card tone="tint" padding="lg" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 520 }}>
          <span className="plx-h2">Set up your first site</span>
          <span className="plx-body">Answer a few questions and we&apos;ll make a site with your name, colours and words. It takes about a minute.</span>
        </div>
        <ButtonLink href={setupHref} size="lg" rightIcon={<ArrowRight size={18} aria-hidden />}>
          Start setting up
        </ButtonLink>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        {IDEAS.map(({ icon: Icon, title, body, href, cta }) => (
          <Card key={title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Icon size={24} aria-hidden style={{ color: "var(--plx-deep)" }} />
            <span className="plx-h3">{title}</span>
            <span className="plx-body">{body}</span>
            <div style={{ marginTop: "auto", paddingTop: 6 }}>
              {href ? (
                <ButtonLink href={href} variant="secondary" size="sm">
                  {cta}
                </ButtonLink>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => tour?.openOffer()}>
                  {cta}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
