"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { advancedHref, type AdvancedSection, type AdvancedSectionId } from "@/lib/dashboardV3/hubAdvanced";
import { TabBar } from "../HubFrame";

/** The Advanced tab: a list of sections on the left (a scrolling row on a phone) and the chosen one on the right. */
export function AdvancedFrame({ siteId, sections, current, children }: { siteId: string; sections: AdvancedSection[]; current: AdvancedSectionId; children: React.ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  // On a phone the list scrolls sideways: keep the chosen section in view.
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>("[aria-current]");
    if (el && nav.current && nav.current.scrollWidth > nav.current.clientWidth) nav.current.scrollTo({ left: el.offsetLeft - 16, behavior: "auto" });
  }, [current]);
  const now = sections.find((s) => s.id === current) ?? sections[0];
  return (
    <>
      <TabBar title="Advanced" sub="Everything the full toolkit gives you, right here." />
      <div className="plx-hs plx-adv" data-tour="hub-advanced">
        <nav ref={nav} className="plx-hs__nav plx-adv__nav" aria-label="Advanced sections">
          {sections.map((s) => (
            <Link key={s.id} href={advancedHref(siteId, s.id)} scroll={false} aria-current={s.id === current ? "page" : undefined} className={s.id === "danger" ? "plx-adv__nav--danger" : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="plx-hs__body plx-adv__body">
          <header className="plx-adv__head">
            <h3 className="plx-h3">{now.label}</h3>
            <p className="plx-hub__sub">{now.help}</p>
          </header>
          {children}
        </div>
      </div>
    </>
  );
}
