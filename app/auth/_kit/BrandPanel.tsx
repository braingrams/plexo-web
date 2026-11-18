import { MARKETING_URL } from "./marketing";
import { Testimonials } from "./Testimonials";

/** The left panel on wide screens: the Plexo mark, one promise, and what owners say. Dark green in light and dark. */
export function BrandPanel() {
  return (
    <aside className="ax-aside" aria-label="About Plexo">
      <div className="ax-aside-art" aria-hidden="true" />
      <div className="ax-aside-top">
        <a href={MARKETING_URL} className="ax-aside-logolink" aria-label="Plexo website">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ax-aside-logo" src="/api/brand/logo/wordmark-on-dark" alt="Plexo" width={132} height={34} />
        </a>
        <h2 className="ax-aside-title">Everything you need to put your business online, without the hassle</h2>
      </div>
      <Testimonials />
    </aside>
  );
}
