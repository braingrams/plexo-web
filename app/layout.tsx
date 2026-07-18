import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";

import "./globals.css";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["400", "500", "600", "700"],
});

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

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
    <html lang="en" className="dark">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        {children}
      </body>
    </html>
  );
}
