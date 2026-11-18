"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { advancedHref, type AdvancedSection, type AdvancedSectionId } from "@/lib/dashboardV3/hubAdvanced";
import { TabBar } from "../HubFrame";
import { LinkPending } from "../../ui/LinkPending";

/** The Advanced tab: a list of sections on the left (a scrolling row on a phone) and the chosen one on the right. */
export function AdvancedFrame({ siteId, sections, current, children, danger }: { siteId: string; sections: AdvancedSection[]; current: AdvancedSectionId; children: React.ReactNode; danger?: React.ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  // On a phone the list scrolls sideways: keep the chosen section in view.
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>("[aria-current]");
    if (el && nav.current && nav.current.scrollWidth > nav.current.clientWidth) nav.current.scrollTo({ left: el.offsetLeft - 16, behavior: "auto" });
  }, [current]);
  // Delete is never one of the tabs: it sits at the very end of the page, on its own.
  const tabs = sections.filter((s) => s.id !== "danger");
  const now = tabs.find((s) => s.id === current) ?? null;
  return (
    <>
      <TabBar title="Advanced" sub="Everything the full toolkit gives you, right here." />
      <div className="plx-hs plx-adv" data-tour="hub-advanced">
        <nav ref={nav} className="plx-hs__nav plx-adv__nav" aria-label="Advanced sections">
          {tabs.map((s) => (
            <Link key={s.id} href={advancedHref(siteId, s.id)} scroll={false} aria-current={s.id === current ? "page" : undefined}>
              {s.label}
              <LinkPending />
            </Link>
          ))}
          {danger ? <a className="plx-adv__nav-del" href="#adv-delete">Delete</a> : null}
        </nav>
        <div className="plx-hs__body plx-adv__body">
          {now ? (
            <>
              <header className="plx-adv__head">
                <h3 className="plx-h3">{now.label}</h3>
                <p className="plx-hub__sub">{now.help}</p>
              </header>
              {children}
            </>
          ) : null}
          {danger ? (
            <section id="adv-delete" className="plx-hs__sec plx-adv__danger">
              <h3 className="plx-hs__h">Delete</h3>
              {danger}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
