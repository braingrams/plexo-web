"use client";

import "@/app/dashboard/_v3/hub/hub.css";
import { PageCodeCard } from "@/app/dashboard/_v3/hub/advanced/PageCodeCard";

/** DEV ONLY: the code-for-one-page card of a site's Advanced area, on its own, wrapped the way the real area wraps it. Playwright mocks the /api/v1/templates/... calls. */
export default function Page() {
  return (
    <div className="plx-page">
      <div className="plx-hs plx-adv">
        <nav className="plx-hs__nav plx-adv__nav" aria-label="Advanced sections">
          {["Search", "Code", "Features", "Layout", "Forms", "Redirects", "Versions"].map((n, i) => <a key={n} href="#" aria-current={i === 0 ? "page" : undefined}>{n}</a>)}
        </nav>
        <div className="plx-hs__body plx-adv__body">
          <PageCodeCard siteId="s1" pages={[{ id: "p1", name: "Home", parentId: null, slug: null, sourceType: "BUILDER" }, { id: "p2", name: "Spring sale", parentId: "p1", slug: "spring-sale", sourceType: "BUILDER" }]} />
        </div>
      </div>
    </div>
  );
}
