"use client";

import "../editor-theme.css";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { appBackHref, editorBackHref, editorColorsFromTokens, sitesListHref, type EditorColors } from "@/lib/dashboardV3/editorChrome";
import { useV3ThemeOptional } from "../_v3/theme/ThemeContext";

const Ctx = createContext<{ v3: boolean; beginner: boolean }>({ v3: false, beginner: false });

/**
 * Wraps every site editor. For people on the new dashboard it switches the editors to Plexo's own
 * brand (colours, font) through the tokens in editor-theme.css, and makes "back" go to the site's
 * hub. Everyone else keeps the old look and the old links. It adds no box of its own.
 */
export function EditorFrame({ v3, beginner = false, children }: { v3: boolean; /** The owner chose "beginner" on the new dashboard: page editors open the simple screen. Never true on the old dashboard. */ beginner?: boolean; children: ReactNode }) {
  return (
    <Ctx.Provider value={{ v3, beginner: v3 && beginner }}>
      <div data-editor-theme="" data-editor-v3={v3 ? "" : undefined} style={{ display: "contents" }}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function useEditorV3(): boolean {
  return useContext(Ctx).v3;
}

/** Whether the page editor should show the simple screen made for people who have never built a site. */
export function useEditorBeginner(): boolean {
  return useContext(Ctx).beginner;
}

/** Where "back" goes from a site's editor. */
export function useEditorBackHref(siteId: string): string {
  return editorBackHref(useEditorV3(), siteId);
}

export function useSitesListHref(): string {
  return sitesListHref(useEditorV3());
}

export function useAppBackHref(appId?: string | null): string {
  return appBackHref(useEditorV3(), appId);
}

/** A "back to your site" link that goes to the right place for either dashboard. */
export function SiteBackLink({ siteId, style, children }: { siteId: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <Link href={useEditorBackHref(siteId)} style={style}>
      {children}
    </Link>
  );
}

/**
 * Plexo's colours as the plain hex values the page editor needs (it mixes its own shades from them), read from the
 * live brand tokens and re-read when the person switches between light and dark. Null for the old dashboard, and
 * until the page has drawn once; the editor then keeps its default look.
 */
export function useEditorColors(): EditorColors | null {
  const v3 = useEditorV3();
  const theme = useV3ThemeOptional();
  const resolved = theme?.resolved ?? null;
  const [colors, setColors] = useState<EditorColors | null>(null);
  useEffect(() => {
    if (!v3) return;
    const root = document.querySelector("[data-plexo-v3]");
    if (!root) return;
    const read = () => {
      const cs = getComputedStyle(root);
      const get = (name: string) => cs.getPropertyValue(name);
      setColors(editorColorsFromTokens({ brand: get("--plx-brand"), onBrand: get("--plx-on-brand"), bg: get("--plx-bg"), text: get("--plx-text"), surface: get("--plx-surface") }));
    };
    // The theme attribute flips in the same tick the context changes; read on the next frame so the new values are in place.
    const frame = requestAnimationFrame(read);
    return () => cancelAnimationFrame(frame);
  }, [v3, resolved]);
  return v3 ? colors : null;
}

/** The code editor's light or dark look: follows the new dashboard's theme, always dark in the old one. */
export function useMonacoTheme(): "vs" | "vs-dark" {
  const theme = useV3ThemeOptional();
  return theme?.resolved === "light" ? "vs" : "vs-dark";
}
