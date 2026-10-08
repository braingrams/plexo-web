// Files a plugin's JavaScript fetches on demand at runtime, which therefore never appear in
// any page's HTML or CSS. Missing one doesn't show up until a visitor scrolls to the widget
// that needs it — a counter that never counts, a lightbox that never opens — and by then
// the WordPress server it used to load from may be gone. Found the hard way: Elementor 4.x
// loads every widget handler ("counter", "text-editor", "video", "lightbox-lightbox", ...)
// as `<assets>/js/chunks/<name>.min.js`, plus conditional CSS and libraries, only when a
// page uses them — the offline replica of the case-study site 404'd on all of them.
//
// Each harvester looks at one stored plugin file and returns paths worth fetching. They're
// speculative by nature (a name in a registry doesn't mean the file ships in this version),
// so the caller treats a miss as "not used by this site", never as an error.

interface Harvester {
  /** Matches the site-relative path of the file that reveals the lazy assets. */
  match: RegExp;
  harvest(path: string, text: string): string[];
}

const ELEMENTOR_FIXED = [
  "css/conditionals/lightbox.min.css",
  "css/conditionals/dialog.min.css",
  "css/conditionals/e-swiper.min.css",
  "css/conditionals/apple-webkit.min.css",
  "css/conditionals/shapes.min.css",
  "lib/dialog/dialog.min.js",
  "lib/share-link/share-link.min.js",
  "lib/swiper/v8/swiper.min.js",
  "lib/swiper/v8/css/swiper.min.css",
  "lib/swiper/swiper.min.js",
  "lib/swiper/css/swiper.min.css",
  "lib/waypoints/waypoints.min.js",
  "lib/e-gallery/js/e-gallery.min.js",
  "lib/e-gallery/css/e-gallery.min.css",
  "lib/jquery-numerator/jquery-numerator.min.js",
  "lib/flatpickr/flatpickr.min.js",
  "lib/flatpickr/flatpickr.min.css",
  "lib/animations/styles/e-animation-grow.min.css",
];

const KEBAB_TOKEN_RE = /[`'"]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)[`'"]/g;
const MAX_CHUNK_CANDIDATES = 160;

const HARVESTERS: Harvester[] = [
  {
    // Elementor and Elementor Pro: the frontend bundle holds the chunk-name registry.
    match: /\/plugins\/(elementor|elementor-pro)\/assets\/js\/(frontend|elements-handlers)(\.min)?\.js$/,
    harvest(path, text) {
      const assetsBase = path.slice(0, path.indexOf("/assets/") + "/assets/".length);
      const names = new Set<string>();
      for (const m of text.matchAll(KEBAB_TOKEN_RE)) {
        if (names.size >= MAX_CHUNK_CANDIDATES) break;
        const name = m[1];
        // Chunk names are descriptive multi-character identifiers; skip one-letter and
        // obviously-not-a-widget tokens to keep the speculative fetch list honest.
        if (name.length >= 4 && !/^(function|object|string|number|symbol|undefined|default|prototype|constructor|length|return|click|change|resize|scroll)$/.test(name)) {
          names.add(name);
        }
      }
      const out = Array.from(names).map((n) => `${assetsBase}js/chunks/${n}.min.js`);
      if (/\/plugins\/elementor\//.test(path)) out.push(...ELEMENTOR_FIXED.map((f) => `${assetsBase}${f}`));
      return out;
    },
  },
];

/** Speculative lazy-loaded asset paths revealed by a stored file (site-relative, no leading slash). */
export function harvestLazyAssets(path: string, text: string): string[][] {
  const out: string[][] = [];
  for (const h of HARVESTERS) {
    if (!h.match.test(`/${path}`)) continue;
    for (const p of h.harvest(path, text)) out.push(p.split("/").filter(Boolean));
  }
  return out;
}
