import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "next-themes";

import "./globals.css";

// geist's variable names (--font-geist-sans/--font-geist-mono) are fixed by the package
// itself, unlike next/font/google's `variable` option — globals.css bridges these to the
// existing --font-heading/--font-body contract so nothing downstream needs to change names.

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Plexo — Visual Template Builder",
  description:
    "Design stunning email campaigns and landing pages with Plexo's drag-and-drop visual builder. AI-powered, export-ready, and beautifully crafted.",
  keywords: ["email builder", "landing page", "template builder", "drag and drop", "no code"],
  openGraph: {
    title: "Plexo — Visual Template Builder",
    description: "Design stunning email campaigns and landing pages with Plexo.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
