import type { SectionField } from "./model";

// The section types every site starts with, so "make a section once and reuse it" works the first
// time the owner opens the picker — no design decision required. Each is a normal section type: the
// owner can rename it, change its fields or design, or remove it. They mirror the built-in
// Testimonials and Questions sections but with content that belongs to each place they're used.
//
// Designs use only Plexo's own colour/spacing tokens (and `{{tone.*}}`, which follows whichever
// background the section sits on), so they take on the site's brand and stay readable on dark or
// coloured backgrounds. See render/markup.ts in the SDK for what the HTML may contain.

export type StarterSectionType = {
  starter: "testimonials" | "faq";
  name: string;
  description: string;
  fields: SectionField[];
  html: string;
  defaults: Record<string, unknown>;
};

const H = "margin:0;font-family:var(--font-family-heading);font-size:var(--font-size-3xl);line-height:1.15;color:{{tone.heading}}";
const LEAD = "margin:0;font-size:var(--font-size-lg);line-height:1.55;color:{{tone.body}};max-width:40rem";

const TESTIMONIALS: StarterSectionType = {
  starter: "testimonials",
  name: "Testimonials",
  description: "Kind words from the people you've helped.",
  fields: [
    { key: "heading", label: "Heading", type: "text" },
    { key: "text", label: "Intro text", type: "longtext", hint: "Optional, one friendly line under the heading." },
    {
      key: "items",
      label: "Testimonials",
      type: "list",
      itemName: "testimonial",
      min: 1,
      limit: 24,
      item: [
        { key: "quote", label: "What they said", type: "longtext" },
        { key: "name", label: "Name", type: "text" },
        { key: "role", label: "Role or company", type: "text" },
        { key: "photo", label: "Photo", type: "image" },
      ],
    },
  ],
  html:
    `<div style="display:flex;flex-direction:column;gap:var(--semantic-space-xl);text-align:{{align}}">` +
    `{{#heading}}<h2 style="${H}">{{heading}}</h2>{{/heading}}` +
    `{{#text}}<p style="${LEAD}">{{text}}</p>{{/text}}` +
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:var(--semantic-space-lg);text-align:left">` +
    `{{#items}}<figure style="margin:0;display:flex;flex-direction:column;justify-content:space-between;gap:var(--semantic-space-lg);padding:var(--semantic-space-lg);background:{{tone.card}};border:1px solid {{tone.line}};border-radius:var(--radius-xl)">` +
    `<blockquote style="margin:0;font-size:var(--font-size-lg);line-height:1.55;color:{{tone.body}}">“{{quote}}”</blockquote>` +
    `<figcaption style="display:flex;align-items:center;gap:var(--semantic-space-sm)">` +
    `{{#photo}}<img src="{{photo}}" alt="{{name}}" style="width:3rem;height:3rem;border-radius:999px;object-fit:cover">{{/photo}}` +
    `<span style="display:flex;flex-direction:column"><strong style="color:{{tone.heading}}">{{name}}</strong>` +
    `{{#role}}<span style="font-size:var(--font-size-sm);color:{{tone.muted}}">{{role}}</span>{{/role}}</span></figcaption></figure>{{/items}}` +
    `</div></div>`,
  defaults: {
    heading: "What people say about us",
    text: "A few words from the people we've worked with.",
    items: [
      { quote: "They made everything simple. We were up and running in a week, and our customers noticed straight away.", name: "Amara O.", role: "Founder, Bright Studio", photo: "" },
      { quote: "Friendly, quick to reply, and the result looks better than we imagined. We recommend them to everyone.", name: "Daniel K.", role: "Owner, Kora Foods", photo: "" },
      { quote: "I stopped worrying about the website because it just works. That alone was worth it.", name: "Tola A.", role: "Coach", photo: "" },
    ],
  },
};

const FAQ: StarterSectionType = {
  starter: "faq",
  name: "FAQ",
  description: "Answers to the questions people ask most, tucked away until tapped.",
  fields: [
    { key: "heading", label: "Heading", type: "text" },
    { key: "text", label: "Intro text", type: "longtext", hint: "Optional, one friendly line under the heading." },
    {
      key: "items",
      label: "Questions",
      type: "list",
      itemName: "question",
      min: 1,
      limit: 30,
      item: [
        { key: "question", label: "Question", type: "text" },
        { key: "answer", label: "Answer", type: "longtext" },
      ],
    },
  ],
  html:
    `<div style="display:flex;flex-direction:column;gap:var(--semantic-space-xl);text-align:{{align}}">` +
    `{{#heading}}<h2 style="${H}">{{heading}}</h2>{{/heading}}` +
    `{{#text}}<p style="${LEAD}">{{text}}</p>{{/text}}` +
    `<div style="display:flex;flex-direction:column;gap:var(--semantic-space-sm);max-width:48rem;width:100%;text-align:left">` +
    `{{#items}}<details style="padding:var(--semantic-space-md) var(--semantic-space-lg);background:{{tone.card}};border:1px solid {{tone.line}};border-radius:var(--radius-lg)">` +
    `<summary style="cursor:pointer;font-weight:600;color:{{tone.heading}}">{{question}}</summary>` +
    `<p style="margin:var(--semantic-space-sm) 0 0;line-height:1.6;color:{{tone.body}}">{{answer}}</p></details>{{/items}}` +
    `</div></div>`,
  defaults: {
    heading: "Questions, answered",
    text: "The things people ask us most.",
    items: [
      { question: "How do I get started?", answer: "Get in touch with a few details and we'll reply within one working day with next steps." },
      { question: "How much does it cost?", answer: "We give a clear price up front, so you always know the total before we begin." },
      { question: "Can I change my mind?", answer: "Yes. You can pause or cancel at any time." },
    ],
  },
};

export const STARTER_SECTION_TYPES: StarterSectionType[] = [TESTIMONIALS, FAQ];

/** The same id every time, so two screens opening at once can't create the starter twice. */
export const starterIdFor = (starter: string): string => `starter-${starter}`;
