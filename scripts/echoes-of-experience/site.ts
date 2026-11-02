/** Turns the page specs into stored V2 designs (brand + search/share details). Pure. */
import { applyCommands, createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { V2_FORMAT, type V2Design } from "../../lib/v2/design";
import {
  C, SCRIPT, SERIF, blogListingSpec, blogPostSpec, contactPage, happeningsPage, homePage, privacyPage, storiesPage, toPageDefinition, videosPage,
  type BlogCard, type PageSpec, type SiteImages,
} from "./design";

export const SITE_NAME = "Echoes of Experience by Tolu";

export const BLOG_POSTS = [
  {
    slug: "the-power-of-listening",
    title: "The Power of Listening",
    date: "2026-10-10T09:00:00.000Z",
    excerpt: "Before the lessons come the pauses. What I have learned from sitting still while someone remarkable tells their story.",
    metaDescription: "What a year of unhurried conversations with remarkable seniors has taught Tolu about listening — and why the pauses matter most.",
    imageKey: "listening" as const,
    imageAlt: "An open book with a fountain pen resting on its pages, beside stacked old books, reading glasses and a lamp",
    html: [
      "<p>Most of what I know about listening, I learned by being quiet while someone else was talking.</p>",
      "<p>When we sit down with a senior for an Echoes conversation, the first few minutes are small talk. The real story starts later, usually after a pause. A pause that most of us rush to fill. The trick is to let it stay.</p>",
      "<h2>Pauses are part of the story</h2>",
      "<p>Mr. James once went silent for almost half a minute while thinking about his father. When he began again, he said what he had never told anyone. I am grateful I kept my mouth shut.</p>",
      "<h2>What listening gives back</h2>",
      "<p>People are rarely asked about their lives with real interest. When they are, they remember details they had forgotten and give advice they did not know they had. Listening is a gift to the speaker — and, more often than not, to the listener too.</p>",
      "<p><em>Know someone whose story deserves to be heard? Share it with us.</em></p>",
    ].join(""),
  },
  {
    slug: "wisdom-in-the-everyday",
    title: "Wisdom in the Everyday",
    date: "2026-10-03T09:00:00.000Z",
    excerpt: "The best advice rarely arrives in a speech. It comes over tea, in the middle of a story about something ordinary.",
    metaDescription: "The best life advice rarely sounds like advice. Notes on finding wisdom in ordinary moments, from conversations with remarkable seniors.",
    imageKey: "everyday" as const,
    imageAlt: "A white teacup with a blue floral pattern resting on a matching saucer, with a silver spoon, on a linen cloth",
    html: [
      "<p>Nobody has ever started a conversation by saying, \"Here is my wisdom.\" It slips in sideways.</p>",
      "<h2>It comes with the kettle</h2>",
      "<p>Mrs. Adeyemi told us how to forgive someone while she was making tea. Mr. Okafor explained patience by describing how he fixed his neighbour's fence. Neither of them thought they were teaching anything.</p>",
      "<h2>Listen for the ordinary</h2>",
      "<p>When you listen to older people, listen for the ordinary parts: the routines, the small kindnesses, the habits that kept a family together for sixty years. That is where the wisdom lives.</p>",
    ].join(""),
  },
  {
    slug: "a-life-of-resilience",
    title: "A Life of Resilience",
    date: "2026-09-26T09:00:00.000Z",
    excerpt: "Resilience is not a single brave moment. Our guests describe it as showing up again, quietly, for decades.",
    metaDescription: "Resilience, in the words of the seniors we've met: not one brave moment, but showing up again and again for decades.",
    imageKey: "resilience" as const,
    imageAlt: "An older man in a hat sitting on a wooden bench, looking out over a calm lake at sunset",
    html: [
      "<p>Ask a young person what resilience looks like and you may hear about a dramatic comeback. Ask someone who has lived eighty years and you will hear about Tuesdays.</p>",
      "<h2>Showing up</h2>",
      "<p>Again and again, the seniors we meet describe resilience as ordinary persistence — going to work after a bad week, praying after a loss, cooking for the family when there was little to cook with.</p>",
      "<h2>What it leaves behind</h2>",
      "<p>A life built that way leaves something solid for the people who come after. That is a legacy worth recording, and it is why we do this.</p>",
    ].join(""),
  },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function blogCards(img: SiteImages): BlogCard[] {
  return BLOG_POSTS.map((p) => ({ title: p.title, date: fmtDate(p.date), href: `/blog/${p.slug}`, image: img.blog[p.imageKey], alt: p.imageAlt }));
}

/** The brand, applied through the editor's own command so colours and fonts are editable in one place. */
function withBrand(design: V2Design, img: SiteImages): V2Design {
  const applied = applyCommands(design.pages, design.designSystem ?? createDefaultDesignSystem(), [
    { op: "setBrand", tokens: { primaryColor: C.olive, secondaryColor: C.rust, headingFont: SERIF, bodyFont: SERIF, neutrals: "warm", roundness: "soft" } },
  ] as never);
  const fonts = [{ family: SCRIPT, variants: [{ weight: 400, style: "normal" as const, url: img.scriptFont, format: "woff2" as const }] }];
  return { ...design, pages: applied.pages as V2Design["pages"], designSystem: { ...applied.designSystem, fonts } as V2Design["designSystem"] };
}

export function designFor(spec: PageSpec, img: SiteImages): V2Design {
  return withBrand({
    format: V2_FORMAT,
    pages: [toPageDefinition(spec)],
    meta: { htmlTitle: spec.title, metaDescription: spec.description, favicon: img.favicon, ogImageUrl: img.og },
  }, img);
}

/** Home first; the rest are pages of the site. */
export function sitePages(img: SiteImages, opts: { contentBlock?: boolean } = { contentBlock: true }): PageSpec[] {
  return [homePage(img, blogCards(img)), storiesPage(img), videosPage(img), happeningsPage(img), contactPage(img), privacyPage(img)].filter((p) => opts.contentBlock !== false || !p.usesContentBlock);
}

export const blogLayouts = (img: SiteImages) => ({ listing: blogListingSpec(img), post: blogPostSpec(img) });

// ---------------------------------------------------------------- sample content (clearly placeholders — the owner replaces them)

export const SAMPLE_VIDEOS = (thumb: string, img: SiteImages) => [
  { title: "A Life Well Lived", description: "Mr. James shares lessons from a lifetime of hard work, faith, family, and resilience.", video: "https://www.youtube.com/watch?v=jNQXAC9IVRw", image: thumb },
  { title: "What My Mother Taught Me", description: "Mrs. Adeyemi remembers the kitchen-table lessons that shaped four generations of her family.", video: "https://www.youtube.com/watch?v=jNQXAC9IVRw", image: img.blog.everyday },
  { title: "Fifty Years of Marriage", description: "Mr. and Mrs. Okafor on patience, laughter and choosing each other every day.", video: "https://www.youtube.com/watch?v=jNQXAC9IVRw", image: img.blog.listening },
];

export const SAMPLE_STORIES = (img: SiteImages) => [
  { title: "Mr. James and the Long Road Home", description: "From a village schoolroom to a lifetime of service — one man's journey in his own words.", body: "Mr. James was eleven when he walked to school for the first time without his brother.\n\nHe remembers the dust on the road and the quiet pride of carrying his own slate. Seventy years later he still keeps it on a shelf.\n\nIn this conversation he talks about hard work, faith, and the people who carried him when he could not carry himself.", image: img.blog.resilience, video: "", author: "Mr. James" },
  { title: "Mrs. Adeyemi's Kitchen Table", description: "Four generations, one table, and the lessons that were served alongside every meal.", body: "Every Sunday, Mrs. Adeyemi's table seated twelve.\n\nShe says the food was the invitation, but the conversation was the point: who was struggling, who needed encouragement, who had good news to share.\n\nShe reflects on forgiveness, patience, and why she never let anyone leave hungry.", image: img.blog.everyday, video: "", author: "Mrs. Adeyemi" },
  { title: "The Letters in the Drawer", description: "A bundle of letters, sixty years old, and the love story they tell.", body: "Mr. Okafor keeps a drawer of letters tied with a blue ribbon.\n\nThey were written across two countries and three years of waiting. He reads a few aloud, and laughs at his own handwriting.\n\nThis is a story about patience, distance and the kind of love that writes back.", image: img.blog.listening, video: "", author: "Mr. Okafor" },
];

const inDays = (d: number, hh: number) => {
  const t = new Date(Date.UTC(2026, 10, 1 + d, hh, 0));
  return t.toISOString().slice(0, 16);
};
export const SAMPLE_EVENTS = (img: SiteImages) => [
  { title: "Echoes Live: An Evening of Stories", description: "Join us for an unhurried evening of short films and live conversation with the seniors you've met here.", date: "2026-12-12T17:00", location: "Community Hall, Lagos", image: img.videoThumb, link: "" },
  { title: "Storytelling Workshop for Families", description: "Learn simple ways to record and keep your own family's stories — bring a parent or grandparent.", date: "2027-01-23T11:00", location: "Online (link sent after you register)", image: "", link: "" },
  { title: "Echoes Anniversary Screening", description: "A celebration of our first year, with a premiere of a brand-new conversation.", date: "2027-03-06T16:00", location: "To be announced", image: "", link: "" },
];
void inDays;
