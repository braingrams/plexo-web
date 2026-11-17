"use client";

import { PromoStripView, type PromoView } from "@/app/dashboard/_v3/promo/PromoStrip";

// A busy, high-contrast picture to prove the overlay keeps text readable.
const IMG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="120"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ffd23f"/><stop offset=".5" stop-color="#ee4266"/><stop offset="1" stop-color="#0b132b"/></linearGradient></defs><rect width="1200" height="120" fill="url(#g)"/><circle cx="300" cy="60" r="70" fill="#fff"/><circle cx="800" cy="30" r="90" fill="#000"/></svg>`,
)}`;

const base: PromoView = { id: "x", version: 1, feature: "move", headline: "Already have a website elsewhere?", body: "Move it from WordPress or another editor in a few minutes. We do the heavy lifting.", buttonLabel: "Move my website", href: "/dashboard/settings/moving", tone: "brand" };
const noop = () => {};

const ROWS: { label: string; promo: PromoView }[] = [
  { label: "Brand", promo: base },
  { label: "Light", promo: { ...base, feature: "blog", tone: "light", headline: "Share news with a blog", body: "Write posts that bring visitors back. No setup needed.", buttonLabel: "Start a blog" } },
  { label: "Dark", promo: { ...base, feature: "sell", tone: "dark", headline: "Start selling on your website", body: "Add products, take payments and track orders in one place.", buttonLabel: "Start selling" } },
  { label: "Image + light", promo: { ...base, tone: "light", imageUrl: IMG } },
  { label: "Image + dark", promo: { ...base, tone: "dark", imageUrl: IMG } },
  { label: "Image + brand", promo: { ...base, tone: "brand", imageUrl: IMG } },
  { label: "For developers", promo: { ...base, feature: "developers", audience: "developers", tone: "light", headline: "Did you know you can use the Plexo Editor in your own apps?", body: "Drop the Plexo page editor into your own app with the SDK.", buttonLabel: "See how", href: "/dashboard/settings/developers" } },
  { label: "Headline only", promo: { ...base, body: "", headline: "Meet SOL, your website assistant", feature: "sol", buttonLabel: "Ask SOL", tone: "light" } },
  { label: "Very long text", promo: { ...base, headline: "Already have a website on WordPress, Wix or Squarespace somewhere else?", body: "Move all your pages, posts, pictures and forms across in a few minutes and we do all of the heavy lifting for you, free of charge." } },
];

/** DEV ONLY: the promo strip in every state. ?w=390 is not needed: shrink the window to see the phone layout. */
export default function V3PreviewPromoPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {ROWS.map((r) => (
        <div key={r.label}>
          <p className="plx-small" style={{ margin: "0 0 4px" }}>{r.label}</p>
          <PromoStripView promo={r.promo} onDismiss={noop} />
        </div>
      ))}
      <p className="plx-small" style={{ margin: "8px 0 4px" }}>Yields: a notice above hides the strip</p>
      <div className="plx-notice plx-notice--info" style={{ margin: 0 }}><div className="plx-notice__body"><p className="plx-notice__title">Your trial ends in 3 days</p></div></div>
      <PromoStripView promo={base} onDismiss={noop} />
      <p className="plx-small">(the strip above this line should be hidden)</p>
    </div>
  );
}
