import { Globe } from "lucide-react";

/** The right-hand panel on wide screens: one calm line and a quiet miniature of a finished site. */
export function BrandPanel() {
  return (
    <aside className="ax-aside" aria-hidden="true">
      <h2 className="ax-aside-title">Your website, made simple.</h2>

      <div className="ax-stage">
        <div className="ax-site">
          <div className="ax-site-bar">
            <span className="ax-dot" /><span className="ax-dot" /><span className="ax-dot" />
            <span className="ax-url"><Globe size={13} />yourbusiness.com<span className="ax-live">Live</span></span>
          </div>
          <div className="ax-site-hero">
            <span className="ax-line ax-line-h" style={{ width: "58%" }} />
            <span className="ax-line" style={{ width: "86%" }} />
            <span className="ax-line" style={{ width: "62%" }} />
            <span className="ax-site-cta" />
          </div>
          <div className="ax-site-grid"><span className="ax-thumb" /><span className="ax-thumb" /><span className="ax-thumb" /></div>
        </div>
      </div>
    </aside>
  );
}
