import { describe, expect, it } from "vitest";
import { harvestLazyAssets } from "@/lib/wpMigration/lazyAssets";

describe("files a webpack-built plugin loads on demand", () => {
  // Trimmed from playmuzingo.com's real wp-content/plugins/elementor/assets/js/webpack.runtime.min.js (Elementor 3.x).
  const runtime = `__webpack_require__.u=e=>786===e?"397f2d183c19202777d6.bundle.min.js":216===e?"lightbox.570c05c5a283cfb6b223.bundle.min.js":915===e?"nested-accordion.294d40984397351fd0f5.bundle.min.js":557===e?"shared-frontend-handlers.03caa53373b56d3bab67.bundle.min.js":void 0`;

  it("are found from the runtime's chunk list and fetched from its folder", () => {
    const paths = harvestLazyAssets("wp-content/plugins/elementor/assets/js/webpack.runtime.min.js", runtime).map((p) => p.join("/"));
    expect(paths).toEqual(expect.arrayContaining([
      "wp-content/plugins/elementor/assets/js/397f2d183c19202777d6.bundle.min.js",
      "wp-content/plugins/elementor/assets/js/lightbox.570c05c5a283cfb6b223.bundle.min.js",
      "wp-content/plugins/elementor/assets/js/nested-accordion.294d40984397351fd0f5.bundle.min.js",
      "wp-content/plugins/elementor/assets/js/shared-frontend-handlers.03caa53373b56d3bab67.bundle.min.js",
    ]));
  });

  it("finds nothing in an ordinary script", () => {
    expect(harvestLazyAssets("wp-content/themes/x/main.js", `console.log("hello.min.js")`)).toEqual([]);
  });
});
