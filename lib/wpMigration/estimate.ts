// How long a WordPress migration has left, for the owner: "about 2 hours — you can close
// this tab, we'll email you". Pure, so the dashboard and the server share it.
//
// Starts from typical per-item costs (wall-clock seconds at the step concurrency the
// migration runs at), then — once there's enough progress to trust — scales them by how
// fast this particular site is actually going (a slow WordPress host is the usual reason).

export interface EstimateCounts {
  pages: number;
  pagesDone: number;
  pagesFailed: number;
  posts: number;
  postsDone: number;
  postsFailed: number;
  assets: number;
  assetsDone: number;
  assetsFailed: number;
  assetsSkipped: number;
  products?: number;
  productsDone?: number;
  productsSkipped?: number;
  productsFailed?: number;
}

const SECONDS_PER = { post: 1.2, page: 9, asset: 0.35, product: 1.5 };
/** Reading the site, checking every link, writing the report. */
const FIXED_SECONDS = 90;

function weighted(c: { posts: number; pages: number; assets: number; products: number }): number {
  return c.posts * SECONDS_PER.post + c.pages * SECONDS_PER.page + c.assets * SECONDS_PER.asset + c.products * SECONDS_PER.product;
}

/** Before starting, from the site's preview counts. */
export function estimateMigrationSeconds(preview: { pages: number; posts: number; media: number; products?: number }): number {
  // Each page also brings its theme files; media is the library itself.
  return FIXED_SECONDS + weighted({ posts: preview.posts, pages: preview.pages, assets: preview.media + preview.pages * 3, products: preview.products ?? 0 });
}

/** While running. null while the site is still being read (its size isn't known yet). */
export function estimateSecondsLeft(input: { phase: string; counts: EstimateCounts | null; startedAt?: string | null; now?: number }): number | null {
  const { phase, counts: c } = input;
  if (!c || phase === "PENDING" || phase === "PLANNING" || phase === "COMPLETED" || phase === "FAILED" || phase === "CANCELLED") return null;
  const left = {
    posts: Math.max(0, c.posts - c.postsDone - c.postsFailed),
    pages: Math.max(0, c.pages - c.pagesDone - c.pagesFailed),
    assets: Math.max(0, c.assets - c.assetsDone - c.assetsFailed - c.assetsSkipped),
    products: Math.max(0, (c.products ?? 0) - (c.productsDone ?? 0) - (c.productsSkipped ?? 0) - (c.productsFailed ?? 0)),
  };
  const done = {
    posts: c.postsDone + c.postsFailed,
    pages: c.pagesDone + c.pagesFailed,
    assets: c.assetsDone + c.assetsFailed + c.assetsSkipped,
    products: (c.productsDone ?? 0) + (c.productsSkipped ?? 0) + (c.productsFailed ?? 0),
  };
  let seconds = weighted(left);
  const elapsed = input.startedAt ? ((input.now ?? Date.now()) - Date.parse(input.startedAt)) / 1000 : 0;
  const doneSeconds = weighted(done);
  if (elapsed > 120 && doneSeconds > 60) {
    // This site's real pace, kept within reason so one slow minute doesn't say "3 days".
    seconds *= Math.min(4, Math.max(0.3, elapsed / (doneSeconds + FIXED_SECONDS / 2)));
  }
  return Math.round(seconds + FIXED_SECONDS / 2);
}

/** "about 2 hours", "about 25 minutes", "about a minute". */
export function formatDuration(seconds: number): string {
  if (seconds < 90) return "about a minute";
  const minutes = seconds / 60;
  if (minutes < 10) return `about ${Math.round(minutes)} minutes`;
  if (minutes < 55) return `about ${Math.round(minutes / 5) * 5} minutes`;
  const hours = minutes / 60;
  if (hours < 1.25) return "about an hour";
  if (hours < 10) {
    const half = Math.round(hours * 2) / 2;
    return `about ${Number.isInteger(half) ? half : `${Math.floor(half)}½`} hours`;
  }
  if (hours < 36) return `about ${Math.round(hours)} hours`;
  return `about ${Math.round(hours / 24)} days`;
}

/** How far along a migration is, 0–1, for a progress bar (weighted by how long each kind of item takes). */
export function migrationProgress(phase: string, counts: EstimateCounts | null): number {
  if (phase === "COMPLETED") return 1;
  if (!counts || phase === "PENDING" || phase === "PLANNING") return 0.02;
  if (phase === "FINALIZING") return 0.97;
  const total = weighted({ posts: counts.posts, pages: counts.pages, assets: counts.assets, products: counts.products ?? 0 });
  const done = weighted({
    posts: counts.postsDone + counts.postsFailed,
    pages: counts.pagesDone + counts.pagesFailed,
    assets: counts.assetsDone + counts.assetsFailed + counts.assetsSkipped,
    products: (counts.productsDone ?? 0) + (counts.productsSkipped ?? 0) + (counts.productsFailed ?? 0),
  });
  return total > 0 ? Math.min(0.96, Math.max(0.03, done / total)) : 0.03;
}

/** What's happening right now, in a few words: "312 of 542 blog posts". */
export function migrationActivity(phase: string, counts: EstimateCounts | null): string {
  const c = counts;
  const of = (done: number, total: number, what: string) => `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${what}`;
  if (phase === "PENDING" || phase === "PLANNING" || !c) return "Reading your WordPress site";
  if (phase === "POSTS") return of(c.postsDone + c.postsFailed, c.posts, "blog posts");
  if (phase === "PRODUCTS") return of((c.productsDone ?? 0) + (c.productsSkipped ?? 0) + (c.productsFailed ?? 0), c.products ?? 0, "products");
  if (phase === "PAGES") return of(c.pagesDone + c.pagesFailed, c.pages, "pages");
  if (phase === "ASSETS") return of(c.assetsDone + c.assetsFailed + c.assetsSkipped, c.assets, "images and files");
  if (phase === "FINALIZING") return "Checking every link and SEO tag";
  return "";
}
