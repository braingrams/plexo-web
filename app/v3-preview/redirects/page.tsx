"use client";

import "@/app/dashboard/_v3/hub/hub.css";
import { RedirectsSection } from "@/app/dashboard/_v3/hub/advanced/RedirectsSection";

/** DEV ONLY: the Redirects section of a site's Advanced area, on its own, wrapped the way the real area wraps it. Playwright mocks the /api/v1/templates/... calls. */
export default function Page() {
  return (
    <div className="plx-page">
      <div className="plx-hs plx-adv">
        <nav className="plx-hs__nav plx-adv__nav" aria-label="Advanced sections">
          {["Search", "Code", "Features", "Layout", "Forms", "Redirects", "Versions"].map((n, i) => <a key={n} href="#" aria-current={i === 0 ? "page" : undefined}>{n}</a>)}
        </nav>
        <div className="plx-hs__body plx-adv__body">
          <RedirectsSection siteId="s1" initial={[{ fromPath: "/old-menu", toPath: "/menu", createdAt: "2026-11-01T10:00:00Z", permanent: true }, { fromPath: "/summer-sale", toPath: "https://example.com/sale", createdAt: "2026-11-10T10:00:00Z", permanent: false }]} />
        </div>
      </div>
    </div>
  );
}
