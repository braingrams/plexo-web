"use client";

import { useEffect } from "react";
import type { ResolvedBrand } from "@/lib/brand/brandModel";
import { TONES, voiceSummary } from "@/lib/brand/brandVoice";
import { cssFamily, findFont } from "@/lib/fonts/catalogue";
import { loadFontFamily } from "@/lib/fonts/loadClient";

/**
 * Your brand at a glance, small enough to sit inside the "Your brand is saved" card: the logo (or the name as a wordmark), the tagline,
 * the colours, the two fonts written in their own faces, and how you sound in one line. The full editor stays folded away until the
 * owner presses "Edit brand", so a brand that is already set up (or that arrived from Strata) is simply shown, not a form.
 */
export function BrandSummary({ brand }: { brand: ResolvedBrand }) {
  const heading = brand.fonts.heading;
  const body = brand.fonts.body;
  useEffect(() => {
    if (heading && findFont(heading)) loadFontFamily(heading, [brand.fontWeights?.heading ?? 700, 400, 700]);
    if (body && findFont(body)) loadFontFamily(body, [brand.fontWeights?.body ?? 400, 400, 700]);
  }, [heading, body, brand.fontWeights?.heading, brand.fontWeights?.body]);

  const title = brand.project?.name ?? brand.name ?? "Your brand";
  const voice = brand.words ? [brand.words.tones?.map((id) => TONES.find((t) => t.id === id)?.label).filter(Boolean).join(", "), brand.words.formality, brand.words.audience ? `for ${brand.words.audience}` : ""].filter(Boolean).join(" · ") || voiceSummary(brand.words) : brand.voice ?? "";

  return (
    <div className="plx-bible plx-bible--compact" data-testid="brand-summary">
      <div className="plx-bible__lead">
        {brand.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img className="plx-bible__logo" src={brand.logoUrl} alt={`${title} logo`} /> : <span className="plx-bible__wordmark" style={heading ? { fontFamily: cssFamily(heading), fontWeight: brand.fontWeights?.heading ?? 700 } : undefined}>{brand.name ?? title}</span>}
        {brand.tagline ? <p className="plx-bible__tagline" style={heading ? { fontFamily: cssFamily(heading) } : undefined}>{brand.tagline}</p> : null}
      </div>
      <div className="plx-bible__row">
        {brand.colours.length ? (
          <ul className="plx-bible__dots" aria-label="Your colours">
            {brand.colours.map((c) => <li key={`${c.role}-${c.value}`} title={`${c.label.replace(/ \(.*\)$/, "")} ${c.value.toUpperCase()}`}><i aria-hidden style={{ background: c.value }} /><span className="plx-sr-only">{c.label.replace(/ \(.*\)$/, "")} {c.value.toUpperCase()}</span></li>)}
          </ul>
        ) : null}
        {heading || body ? (
          <p className="plx-bible__fontline" aria-label="Your fonts">
            {heading ? <b style={{ fontFamily: cssFamily(heading), fontWeight: brand.fontWeights?.heading ?? 700 }}>{heading}</b> : null}
            {heading && body ? <span className="plx-small"> with </span> : null}
            {body ? <span style={{ fontFamily: cssFamily(body), fontWeight: brand.fontWeights?.body ?? 400 }}>{body}</span> : null}
          </p>
        ) : null}
      </div>
      {voice ? <p className="plx-small" style={{ margin: 0 }}><b>How you sound:</b> {voice}</p> : <p className="plx-small" style={{ margin: 0 }}>No tagline or voice yet. Press Edit brand to add them.</p>}
    </div>
  );
}
