import { samplePicture, type SectionField } from "./model";
import { STARTER_SECTION_TYPES } from "./starters";

// "How should it look?" choices on the New section screen. Each one is a complete, working design the owner can then
// change; picking one means the section works before they've written a line. Client-safe (no server imports).

export type SectionLayoutPreset = {
  id: string;
  label: string;
  blurb: string;
  fields: SectionField[];
  html: string;
  /** Rows shown in the preview and used when the section is first added. */
  defaults?: Record<string, unknown>;
};

const H = "margin:0;font-family:var(--font-family-heading);font-size:var(--font-size-3xl);line-height:1.15;color:{{tone.heading}}";
const LEAD = "margin:0;font-size:var(--font-size-lg);line-height:1.55;color:{{tone.body}};max-width:40rem";

const heading: SectionField[] = [
  { key: "heading", label: "Heading", type: "text", placeholder: "e.g. Meet the team" },
  { key: "text", label: "Intro text", type: "longtext", hint: "Optional, one friendly line under the heading." },
];

const faq = STARTER_SECTION_TYPES.find((s) => s.starter === "faq")!;

export const LAYOUT_PRESETS: SectionLayoutPreset[] = [
  {
    id: "cards",
    label: "Cards in a grid",
    blurb: "A picture, a title and a few words in each card. Good for team members, services or features.",
    fields: [
      ...heading,
      {
        key: "items",
        label: "Cards",
        type: "list",
        itemName: "card",
        min: 1,
        limit: 24,
        item: [
          { key: "photo", label: "Picture", type: "image", hint: "Pick one from your pictures or upload a new one." },
          { key: "title", label: "Title", type: "text", placeholder: "e.g. Ada Lovelace" },
          { key: "description", label: "Description", type: "richtext", hint: "You can make words bold, add links or a short list." },
          { key: "link", label: "Button", type: "button", hint: "Optional. Leave the button text empty to hide it." },
        ],
      },
    ],
    html:
      `<div style="display:flex;flex-direction:column;gap:var(--semantic-space-xl);text-align:{{align}}">` +
      `{{#heading}}<h2 style="${H}">{{heading}}</h2>{{/heading}}` +
      `{{#text}}<p style="${LEAD}">{{text}}</p>{{/text}}` +
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:var(--semantic-space-lg);text-align:left">` +
      `{{#items}}<div style="display:flex;flex-direction:column;gap:var(--semantic-space-sm);padding:var(--semantic-space-md);background:{{tone.card}};border:1px solid {{tone.line}};border-radius:var(--radius-xl)">` +
      `{{#photo}}<img src="{{photo}}" alt="{{title}}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius-lg)">{{/photo}}` +
      `<h3 style="margin:0;font-size:var(--font-size-xl);color:{{tone.heading}}">{{title}}</h3>` +
      `{{#description}}<div style="line-height:1.55;color:{{tone.body}}">{{description}}</div>{{/description}}` +
      `{{#link.label}}<a href="{{link.href}}" style="font-weight:600;color:{{tone.accent}}">{{link.label}}</a>{{/link.label}}` +
      `</div>{{/items}}</div></div>`,
    defaults: {
      heading: "Meet the team",
      text: "The people behind it all.",
      items: [
        { photo: samplePicture(0), title: "First person", description: "<p>A sentence about them. Add <strong>bold</strong> words or a link.</p>", link: { label: "Say hello", href: "#" } },
        { photo: samplePicture(1), title: "Second person", description: "<p>What they do and why they love it.</p>", link: { label: "", href: "" } },
        { photo: samplePicture(2), title: "Third person", description: "<p>Something friendly to remember them by.</p>", link: { label: "", href: "" } },
      ],
    },
  },
  {
    id: "list",
    label: "Simple list",
    blurb: "A title and a line of text for each row. Good for opening hours, menu items or a short list of facts.",
    fields: [
      ...heading,
      {
        key: "items",
        label: "Rows",
        type: "list",
        itemName: "row",
        min: 1,
        limit: 40,
        item: [
          { key: "title", label: "Title", type: "text", placeholder: "e.g. Monday to Friday" },
          { key: "description", label: "Details", type: "richtext", placeholder: "e.g. 9am to 5pm" },
        ],
      },
    ],
    html:
      `<div style="display:flex;flex-direction:column;gap:var(--semantic-space-lg);text-align:{{align}}">` +
      `{{#heading}}<h2 style="${H}">{{heading}}</h2>{{/heading}}` +
      `{{#text}}<p style="${LEAD}">{{text}}</p>{{/text}}` +
      `<div style="display:flex;flex-direction:column;max-width:48rem;width:100%;text-align:left">` +
      `{{#items}}<div style="padding:var(--semantic-space-md) 0;border-top:1px solid {{tone.line}}"><strong style="color:{{tone.heading}}">{{title}}</strong>` +
      `{{#description}}<div style="margin:var(--semantic-space-xs) 0 0;line-height:1.55;color:{{tone.body}}">{{description}}</div>{{/description}}</div>{{/items}}` +
      `</div></div>`,
    defaults: {
      heading: "Opening hours",
      text: "",
      items: [
        { title: "Monday to Friday", description: "<p>9am to 5pm</p>" },
        { title: "Saturday", description: "<p>10am to 2pm</p>" },
        { title: "Sunday", description: "<p>Closed</p>" },
      ],
    },
  },
  {
    id: "questions",
    label: "Questions that open",
    blurb: "A question people tap to read the answer. Good for FAQs and policies.",
    fields: faq.fields,
    html: faq.html,
    defaults: faq.defaults,
  },
];
