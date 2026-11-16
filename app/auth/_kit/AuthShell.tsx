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
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <main className={layout === "split" ? "ax-split" : undefined}>
        <div className="ax-col">
          <ThemeToggle />
          <div className="ax-col-header">
            <Link href="/" className="ax-logo-link" aria-label="Plexo home">
              {/* logo-dark.svg has dark letters (for light backgrounds); logo-light.svg has light letters (for dark) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="ax-logo ax-logo-on-light" src="/brand/logo-dark.svg" alt="Plexo" width={124} height={32} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="ax-logo ax-logo-on-dark" src="/brand/logo-light.svg" alt="" aria-hidden="true" width={124} height={32} />
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
