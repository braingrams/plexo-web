import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "next-themes";

import "./globals.css";
import { themeCss } from "@/lib/theme";

// Figtree is the site's typeface (headings and body); Geist Mono stays for code. globals.css
// maps --font-figtree/--font-geist-mono onto the --font-heading/--font-body/--font-mono
// contract, so nothing downstream needs to change names.
const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap", variable: "--font-figtree" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Without this, iOS in standalone/PWA mode (see app/manifest.ts's display:"standalone")
  // leaves the notch/status-bar and home-indicator areas outside the page's own viewport,
  // so it paints them with its own black background instead of ours — showing as a margin
  // around fixed-position chrome like the dashboard sidebar. "cover" extends our viewport
  // (and its background) under those areas; safe-area-inset padding below keeps content
  // clear of them without losing the edge-to-edge background.
  viewportFit: "cover",
};

// plexo.charisol.io is the product/dashboard app only — all public marketing and
// SEO lives on www.plexopages.com. The root metadata is therefore deliberately
// minimal and noindex: no canonical, OpenGraph, keywords, verification, or
// Organization/WebSite/SoftwareApplication JSON-LD that would compete with the
// marketing site for search presence. (Previous SEO config: git history / _archive.)
export const metadata: Metadata = {
  title: {
    default: "Plexo",
    template: "%s | Plexo",
  },
  description: "Plexo — visual builder dashboard.",
  applicationName: "Plexo",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables live on <html> so :root's --font-heading/--font-body (globals.css)
    // can resolve them — set on <body> they were invisible to :root, and every page fell back
    // to the system font.
    <html lang="en" suppressHydrationWarning className={`${figtree.variable} ${GeistMono.variable}`}>
      <head>
        {/* Every colour variable the site uses, generated from lib/theme.ts: change the theme there and it changes everywhere. */}
        <style id="plexo-theme" dangerouslySetInnerHTML={{ __html: themeCss() }} />
        {/* Microsoft Clarity (For the app) */}
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "zawu6g4f6x");`,
          }}
        />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
