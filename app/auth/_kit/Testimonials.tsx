"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

export type Testimonial = { quote: string; name: string; role?: string; initials: string; /** A picture in /public (their logo or photo). Falls back to the initials tile. */ avatar?: string };

/** What owners say about Plexo. Two or more entries show the next / previous arrows. */
export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "Being able to publish HTML straight from Claude has transformed our workflow. We can launch faster, test and iterate without slowing down",
    name: "Ebitimi Jumbo",
    role: "Founder, MeerHQ",
    initials: "EJ",
    avatar: "/brand/testimonials/meerhq.png",
  },
  {
    // PLACEHOLDER QUOTE: written for the design, not something this organisation said. Replace it with their real words before launch.
    quote: "We moved our donation page and event sign-ups onto Plexo over a weekend. Our team updates everything ourselves now, and supporters finally find what they need without calling us.",
    name: "Yeshua Helimax Foundation",
    role: "CEO",
    initials: "YH",
    avatar: "/brand/testimonials/yeshua-helimax.png",
  },
];

/** The quote at the bottom of the brand panel: who said it, and arrows to read the next one. */
export function Testimonials({ items = TESTIMONIALS }: { items?: Testimonial[] }) {
  const [i, setI] = useState(0);
  const t = items[i] ?? items[0];
  if (!t) return null;
  const many = items.length > 1;
  const step = (d: number) => setI((n) => (n + d + items.length) % items.length);
  return (
    <figure className="ax-quote">
      <blockquote key={i}>{t.quote}</blockquote>
      <figcaption>
        <span className="ax-quote-who">
          {t.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ax-quote-tile ax-quote-img" src={t.avatar} alt="" width={34} height={34} />
          ) : (
            <span className="ax-quote-tile" aria-hidden="true">{t.initials}</span>
          )}
          <span>
            <span className="ax-quote-name">{t.name}</span>
            {t.role ? <span className="ax-quote-role">{t.role}</span> : null}
          </span>
        </span>
        {many ? (
          <span className="ax-quote-nav">
            <button type="button" onClick={() => step(-1)} aria-label="Previous quote"><ArrowLeft size={14} aria-hidden="true" /></button>
            <button type="button" onClick={() => step(1)} aria-label="Next quote"><ArrowRight size={14} aria-hidden="true" /></button>
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
