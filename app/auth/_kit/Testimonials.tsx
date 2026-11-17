"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

export type Testimonial = { quote: string; name: string; role: string; initials: string };

/** What owners say about Plexo. Add more entries and the arrows appear. */
export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "Being able to publish HTML straight from Claude has transformed our workflow. We can launch faster, test and iterate without slowing down",
    name: "Ebitimi Jumbo",
    role: "Founder, MeetHQ",
    initials: "EJ",
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
          <span className="ax-quote-tile" aria-hidden="true">{t.initials}</span>
          <span>
            <span className="ax-quote-name">{t.name}</span>
            <span className="ax-quote-role">{t.role}</span>
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
