/**
 * Viewport modes for previewing templates, marketplace designs, onboarding looks, and uploaded HTML.
 * Persists the owner's choice across views so their preferred viewport is retained.
 */
export type ViewportMode = "desktop" | "tablet" | "mobile";

export const VIEWPORT_STORAGE_KEY = "plexo:preview:viewport";

export const VIEWPORT_WIDTHS: Record<ViewportMode, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

export const VIEWPORT_OPTIONS: { id: ViewportMode; label: string; widthPx: number }[] = [
  { id: "desktop", label: "Desktop", widthPx: 1200 },
  { id: "tablet", label: "Tab", widthPx: 768 },
  { id: "mobile", label: "Mobile", widthPx: 375 },
];

export function getStoredViewport(): ViewportMode {
  if (typeof window === "undefined") return "desktop";
  try {
    const v = localStorage.getItem(VIEWPORT_STORAGE_KEY);
    if (v === "desktop" || v === "tablet" || v === "mobile") return v;
  } catch {
    // Ignore localStorage errors (private browsing, etc.)
  }
  return "desktop";
}

export function setStoredViewport(mode: ViewportMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VIEWPORT_STORAGE_KEY, mode);
  } catch {
    // Ignore localStorage errors
  }
}
