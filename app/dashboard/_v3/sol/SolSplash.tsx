import { SolGlyph } from "./SolGlyph";
import "./sol.css";

/**
 * The "SOL is opening" screen: the lime SOL icon, centred, on the page's own background (light in
 * light mode, dark in dark mode), with a gentle pulse. It fades in after a beat, so a quick load
 * never flashes it. Pure markup (no hooks) so route loading.tsx files can render it; reuse it for
 * any SOL sub-route that is still loading.
 */
export function SolSplash({ label = "Opening SOL" }: { label?: string }) {
  return (
    <div className="sol3-splash" role="status" aria-live="polite">
      <span className="sol3-splash__mark" aria-hidden>
        <SolGlyph size={42} />
      </span>
      <span className="plx-sr-only">{label}</span>
    </div>
  );
}
