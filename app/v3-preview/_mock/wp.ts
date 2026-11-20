// Made-up WordPress move history for the previews (Settings > WordPress moves, and a moved site's own panel).
const ago = (d: number, h = 0) => new Date(Date.now() - d * 86400000 - h * 3600000).toISOString();

const runs = [
  { id: "r3", number: 3, startedAt: ago(1, 3), finishedAt: ago(1, 3 - 0.2), scope: "POSTS", outcome: "completed", counts: { postsDone: 52, posts: 52 } },
  { id: "r2", number: 2, startedAt: ago(6), finishedAt: ago(6, -0.1), scope: "PAGES", outcome: "paused", counts: { pagesDone: 17, pages: 24, pagesFailed: 7 }, error: "Seven pages were hidden behind a password on WordPress, so we couldn't read them." },
  { id: "r1", number: 1, startedAt: ago(12), finishedAt: ago(12, -0.4), scope: "all", outcome: "completed", counts: { pagesDone: 24, pages: 24, postsDone: 52, posts: 52, assetsDone: 318, assets: 318 }, redirects: 76, forms: 2 },
];

export const WP_HISTORY = {
  sites: [
    { templateId: "s1", siteName: "Lineage Care Foundation", sourceUrl: "https://lineagecarefoundation.org", runs, active: false, latestJobId: "j1", steps: ["PAGES", "POSTS", "ASSETS"], canRerun: true },
    { templateId: "s2", siteName: "Muzingo Online Music Bingo", sourceUrl: "https://muzingo.com/", runs: [{ ...runs[2], id: "m1", number: 1 }], active: false, latestJobId: "j2", steps: ["PAGES", "POSTS", "ASSETS", "PRODUCTS"], canRerun: true },
  ],
};

export const WP_RERUN_PREVIEW = {
  preview: {
    scope: "POSTS",
    title: "Copy the blog posts again",
    willDo: "Reads your 52 blog posts from lineagecarefoundation.org again.",
    willReplace: "Posts you've changed on Plexo go back to how they are on WordPress. New posts on WordPress come across too.",
    keeps: "Your address, redirects and anything you've added that didn't come from WordPress stay as they are.",
    steps: ["POSTS"],
  },
};
