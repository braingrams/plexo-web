/**
 * The new dashboard is drawn at 90% on a desktop (see --plx-zoom in v3.css): it reads as one notch calmer, like a browser zoomed to 90%.
 * Measurements from the browser (getBoundingClientRect, window.innerWidth) are in what you SEE, but positions we set on an element
 * inside the dashboard are in its own, un-zoomed units, so the two differ by this factor. Anything that places a floating
 * element from a measurement divides by it.
 */
export function pageZoom(from?: Element | null): number {
  if (typeof window === "undefined" || typeof CSS === "undefined" || !CSS.supports?.("zoom", "1")) return 1;
  const root = (from ?? document.body).closest("[data-plexo-v3]") ?? document.querySelector("[data-plexo-v3]");
  if (!root) return 1;
  const z = parseFloat(getComputedStyle(root).getPropertyValue("--plx-zoom"));
  return Number.isFinite(z) && z > 0 && z <= 2 ? z : 1;
}
