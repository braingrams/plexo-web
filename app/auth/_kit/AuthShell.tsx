import Link from "next/link";
import type { ReactNode } from "react";
import { jakarta } from "./font";
import { BrandPanel } from "./BrandPanel";
import { ThemeToggle, themeInitScript } from "./ThemeToggle";
import "./auth-tokens.css";
import "./auth-kit.css";

type Props = {
  children: ReactNode;
  /** "split": form on the left, brand panel on the right (wide screens). "center": one centred column, for in-between steps. */
  layout?: "split" | "center";
  /** A slightly wider column (for cards). */
  wide?: boolean;
  /** A much wider column (side-by-side cards). */
  xl?: boolean;
};

/** Shared frame for every sign-in screen: centred logo, calm form column, light/dark/system theme. */
export function AuthShell({ children, layout = "split", wide = false, xl = false }: Props) {
  return (
    <div className={`ax-root ${jakarta.variable} ${layout === "center" ? "ax-center" : ""}`} suppressHydrationWarning>
      {/* The live Plexo colours/font from Strata, as a render-blocking sheet (no flash); auth-tokens.css stays the fallback. */}
      <link rel="stylesheet" href="/api/brand/auth-css" precedence="default" />
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <main className={layout === "split" ? "ax-split" : undefined}>
        <div className="ax-col">
          <ThemeToggle />
          <div className="ax-col-header">
            <Link href="/" className="ax-logo-link" aria-label="Plexo home">
              {/* The live Plexo logo from Strata through our own URL (bundled files if Strata is unreachable): wordmark-on-light has dark letters, wordmark-on-dark light letters. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="ax-logo ax-logo-on-light" src="/api/brand/logo/wordmark-on-light" alt="Plexo" width={124} height={32} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="ax-logo ax-logo-on-dark" src="/api/brand/logo/wordmark-on-dark" alt="" aria-hidden="true" width={124} height={32} />
            </Link>
          </div>
          <div className="ax-col-body">
            <div className={`ax-col-inner${wide ? " ax-wide" : ""}${xl ? " ax-xl" : ""}`}>{children}</div>
          </div>
        </div>
        {layout === "split" ? <BrandPanel /> : null}
      </main>
    </div>
  );
}
