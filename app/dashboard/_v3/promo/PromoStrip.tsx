"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowRightLeft, CalendarCheck, CodeXml, GraduationCap, Megaphone, MessageCircle, PenLine, ShoppingBag, X } from "lucide-react";
import { isExternalHref, promoClasses, promoFeature, promoHiddenOn, type PromoFeature, type PromoRecord } from "@/lib/promos/promos";

const ICONS: Record<PromoFeature["icon"], React.ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>> = {
  ArrowRightLeft, CalendarCheck, ShoppingBag, PenLine, GraduationCap, MessageCircle, Megaphone, CodeXml,
};

export type PromoView = Pick<PromoRecord, "id" | "version" | "feature" | "audience" | "headline" | "body" | "buttonLabel" | "href" | "imageUrl" | "tone">;

/**
 * The markup of the strip, with no behaviour. plexo-admin's live preview renders this same
 * structure with the same class names (docs: lib/promos/promos.ts, tests/promos.test.ts keeps them in sync).
 */
export function PromoStripView({ promo, onDismiss, onClick }: { promo: PromoView; onDismiss?: () => void; onClick?: () => void }) {
  const Icon = ICONS[promoFeature(promo.feature).icon];
  const external = isExternalHref(promo.href);
  const button = external ? (
    <a href={promo.href} target="_blank" rel="noopener noreferrer" className="plx-btn plx-btn--sm plx-promo__btn" onClick={onClick}>
      {promo.buttonLabel}
    </a>
  ) : (
    <Link href={promo.href} className="plx-btn plx-btn--sm plx-promo__btn" onClick={onClick}>
      {promo.buttonLabel}
    </Link>
  );
  return (
    <aside className={promoClasses(promo.tone, !!promo.imageUrl)} aria-label="What's new" style={promo.imageUrl ? ({ "--plx-promo-img": `url("${promo.imageUrl.replace(/["\\()]/g, "")}")` } as React.CSSProperties) : undefined}>
      <span className="plx-promo__icon" aria-hidden>
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <div className="plx-promo__text">
        {promo.audience === "developers" ? <span className="plx-promo__tag">For developers</span> : null}
        <strong className="plx-promo__title">{promo.headline}</strong>
        {promo.body ? <span className="plx-promo__line">{promo.body}</span> : null}
      </div>
      {button}
      {onDismiss ? (
        <button type="button" className="plx-promo__close" onClick={onDismiss} aria-label="Hide this message">
          <X size={16} aria-hidden />
        </button>
      ) : null}
    </aside>
  );
}

/** The live strip: hides itself in editors / SOL / checkout, remembers the close on the account. */
export function PromoStrip({ promo }: { promo: PromoView }) {
  const pathname = usePathname() ?? "/dashboard";
  const [hidden, setHidden] = useState(false);
  if (hidden || promoHiddenOn(pathname, promo.href)) return null;
  const send = (url: string) => {
    try {
      void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: promo.id, version: promo.version }), keepalive: true }).catch(() => {});
    } catch {
      // best effort
    }
  };
  return (
    <PromoStripView
      promo={promo}
      onClick={() => send("/api/promos/click")}
      onDismiss={() => {
        setHidden(true);
        send("/api/promos/dismiss");
      }}
    />
  );
}
