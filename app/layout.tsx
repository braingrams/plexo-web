import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "next-themes";

import "./globals.css";

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

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL
  : "https://plexo.charisol.io";

const TITLE = "Plexo — Visual Template Builder for Email & Landing Pages";
const DESCRIPTION =
  "Plexo is a drag-and-drop visual builder for email campaigns and landing pages. AI-powered generation, an embeddable SDK, MCP support for Claude/ChatGPT, custom domains, and export-ready HTML — free to start.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s | Plexo",
  },
  description: DESCRIPTION,
  applicationName: "Plexo",
  keywords: [
    "Plexo",
    "email builder",
    "landing page builder",
    "template builder",
    "drag and drop email editor",
    "MJML editor",
    "no code website builder",
    "email template SDK",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // Fill in once verified in Google Search Console / Bing Webmaster Tools.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "Plexo",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Site-wide Organization + SoftwareApplication graph — read by Google's rich-result
// parser and by AI answer engines that ground responses in schema.org markup, so it
// lives once in the root layout rather than being re-declared per page.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Plexo",
      url: SITE_URL,
      logo: `${SITE_URL}/icon`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Plexo",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: "Plexo",
      url: SITE_URL,
      applicationCategory: "DesignApplication",
      operatingSystem: "Web",
      description: DESCRIPTION,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
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
      <body>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
